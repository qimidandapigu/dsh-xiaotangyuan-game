from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path

from .ai_client import AiClient
from .audio import VoiceRecorder, play_wav
from .config import Settings
from .game_state import build_context, read_game_state, save_context
from .screen_capture import capture_game_window, is_game_foreground


LOGGER = logging.getLogger("chester")


def write_reply(path: Path | None, text: str) -> None:
    if path is None:
        LOGGER.warning("Reply path is unavailable; skipping in-game speech bubble")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": str(uuid.uuid4()),
        "text": text,
        "created_at_unix": time.time(),
    }
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


class ChesterApp:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.recorder = VoiceRecorder()
        self.ai = AiClient(settings)
        self._busy = threading.Lock()

    def capture_context(self) -> tuple[bytes, dict[str, object]]:
        capture = capture_game_window(
            self.settings.game_window_title,
            self.settings.screenshot_max_width,
        )
        game_state = read_game_state(self.settings.state_file)
        context = build_context(game_state, capture.window)
        self.settings.latest_screenshot.write_bytes(capture.png)
        save_context(self.settings.latest_context, context)
        LOGGER.info(
            "Captured %sx%s game image; Lua state available=%s",
            capture.window["capture_size"]["width"],
            capture.window["capture_size"]["height"],
            game_state.get("available"),
        )
        return capture.png, context

    def process_audio(self, wav: bytes) -> None:
        if not wav:
            LOGGER.warning("No microphone audio was recorded")
            return
        with self._busy:
            screenshot, context = self.capture_context()
            LOGGER.info("Transcribing %.1f KiB of microphone audio", len(wav) / 1024)
            text = self.ai.transcribe(wav)
            if not text:
                LOGGER.warning("Transcription was empty")
                return
            self._answer(text, screenshot, context)

    def process_text(self, text: str) -> str:
        with self._busy:
            screenshot, context = self.capture_context()
            return self._answer(text, screenshot, context)

    def _answer(self, text: str, screenshot: bytes, context: dict[str, object]) -> str:
        LOGGER.info("Player: %s", text)
        reply = self.ai.chat(text, screenshot, context)
        LOGGER.info("Chester: %s", reply)
        write_reply(self.settings.reply_file, reply)
        wav = self.ai.synthesize(reply)
        play_wav(wav)
        return reply

    def run_hotkey_loop(self) -> None:
        try:
            from pynput import keyboard
        except ImportError as exc:
            raise RuntimeError("pynput is required for the hold-to-talk hotkey") from exc

        key_name = self.settings.voice_key
        LOGGER.info("Ready. Hold %s to talk to Chester; Ctrl+C exits.", key_name.upper())

        def is_voice_key(key: object) -> bool:
            return getattr(key, "char", "") is not None and getattr(key, "char", "").lower() == key_name

        def on_press(key: object) -> None:
            if (
                not is_voice_key(key)
                or self.recorder.is_recording
                or self._busy.locked()
                or not is_game_foreground(self.settings.game_window_title)
            ):
                return
            try:
                self.recorder.start()
                LOGGER.info("Listening...")
            except Exception:
                LOGGER.exception("Could not start microphone recording")

        def on_release(key: object) -> None:
            if not is_voice_key(key) or not self.recorder.is_recording:
                return
            try:
                wav = self.recorder.stop()
                LOGGER.info("Voice key released; processing")
                threading.Thread(
                    target=self._safe_process_audio,
                    args=(wav,),
                    daemon=True,
                    name="chester-turn",
                ).start()
            except Exception:
                LOGGER.exception("Could not stop microphone recording")

        with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
            listener.join()

    def _safe_process_audio(self, wav: bytes) -> None:
        try:
            self.process_audio(wav)
        except Exception:
            LOGGER.exception("Chester conversation turn failed")
