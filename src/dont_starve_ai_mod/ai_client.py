from __future__ import annotations

import base64
import io
import json
import re
import time
import uuid
import wave
from collections import deque
from typing import Any

import requests

from .config import Settings


def build_system_prompt(context: dict[str, Any], language: str) -> str:
    state_json = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    return f"""You are Chester, the loyal walking chest from Don't Starve Together.
You are physically present near the player and speak as a warm, curious companion.
Use the screenshot and structured context to understand the current situation.
Never claim you can see an object or game fact unless it is supported by the screenshot
or context. If context is unavailable or stale, acknowledge uncertainty naturally.
Keep the spoken answer concise: normally one to three sentences. Do not use markdown.
Reply in {language}.

CURRENT_CONTEXT_JSON:
{state_json}"""


class AiClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.session = requests.Session()
        self.history: deque[tuple[str, str]] = deque(maxlen=12)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.settings.api_key}"}

    def transcribe(self, wav: bytes) -> str:
        if self.settings.voice_provider == "volcengine":
            return self._transcribe_volcengine(wav)
        response = self.session.post(
            self.settings.transcription_url,
            headers=self._headers(),
            data={"model": self.settings.transcription_model},
            files={"file": ("speech.wav", wav, "audio/wav")},
            timeout=self.settings.request_timeout_seconds,
        )
        self._raise(response, "transcription")
        text = response.json().get("text", "")
        return str(text).strip()

    def chat(self, user_text: str, screenshot: bytes, context: dict[str, Any]) -> str:
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": build_system_prompt(context, self.settings.reply_language),
            }
        ]
        messages.extend({"role": role, "content": content} for role, content in self.history)
        image = base64.b64encode(screenshot).decode("ascii")
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image}"},
                    },
                ],
            }
        )
        response = self.session.post(
            self.settings.chat_url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json={"model": self.settings.chat_model, "messages": messages, "stream": False},
            timeout=self.settings.request_timeout_seconds,
        )
        self._raise(response, "vision chat")
        content = response.json()["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "")) for part in content if isinstance(part, dict)
            )
        reply = str(content).strip()
        self.history.append(("user", user_text))
        self.history.append(("assistant", reply))
        return reply

    def synthesize(self, text: str) -> bytes:
        if self.settings.voice_provider == "volcengine":
            return self._synthesize_volcengine(text)
        response = self.session.post(
            self.settings.tts_url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json={
                "model": self.settings.tts_model,
                "voice": self.settings.tts_voice,
                "input": text,
                "response_format": "wav",
            },
            timeout=self.settings.request_timeout_seconds,
        )
        self._raise(response, "speech synthesis")
        return response.content

    def _transcribe_volcengine(self, wav: bytes) -> str:
        request_id = str(uuid.uuid4())
        headers = {
            "x-api-key": self.settings.volcengine_api_key,
            "X-Api-Resource-Id": self.settings.volcengine_asr_resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
            "Content-Type": "application/json",
        }
        payload = {
            "user": {"uid": "dont-starve-ai-mod"},
            "audio": {
                "data": base64.b64encode(wav).decode("ascii"),
                "format": "wav",
                "codec": "raw",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": False,
            },
        }
        response = self.session.post(
            "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",
            headers=headers,
            json=payload,
            timeout=self.settings.request_timeout_seconds,
        )
        self._raise(response, "Volcengine transcription submit")

        query_headers = dict(headers)
        query_headers.pop("X-Api-Sequence", None)
        for _ in range(30):
            time.sleep(0.5)
            response = self.session.post(
                "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query",
                headers=query_headers,
                json={},
                timeout=self.settings.request_timeout_seconds,
            )
            self._raise(response, "Volcengine transcription query")
            status = response.headers.get("X-Api-Status-Code", "")
            if status == "20000000":
                return str(response.json().get("result", {}).get("text", "")).strip()
            if status not in {"", "20000001"}:
                raise RuntimeError(f"Volcengine transcription returned status {status}")
        raise RuntimeError("Volcengine transcription timed out after 15 seconds")

    def _synthesize_volcengine(self, text: str) -> bytes:
        headers = {
            "x-api-key": self.settings.volcengine_api_key,
            "X-Api-Resource-Id": self.settings.volcengine_tts_resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "Content-Type": "application/json",
        }
        payload = {
            "user": {"uid": "dont-starve-ai-mod"},
            "req_params": {
                "text": text,
                "speaker": self.settings.tts_voice,
                "audio_params": {"format": "pcm", "sample_rate": 24000},
            },
        }
        response = self.session.post(
            "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
            headers=headers,
            json=payload,
            timeout=self.settings.request_timeout_seconds,
        )
        self._raise(response, "Volcengine speech synthesis")

        pcm = bytearray()
        normalized = re.sub(r"}\s*{", "}\n{", response.text)
        for raw in normalized.splitlines():
            try:
                chunk = json.loads(raw)
            except json.JSONDecodeError:
                continue
            encoded = chunk.get("data", "")
            if encoded:
                pcm.extend(base64.b64decode(encoded))
        if not pcm:
            raise RuntimeError("Volcengine speech synthesis returned no audio")

        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(24000)
            wav_file.writeframes(pcm)
        return output.getvalue()

    @staticmethod
    def _raise(response: requests.Response, operation: str) -> None:
        if response.ok:
            return
        body = response.text.replace("\n", " ")[:400]
        raise RuntimeError(f"{operation} failed with HTTP {response.status_code}: {body}")
