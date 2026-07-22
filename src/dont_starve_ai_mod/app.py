from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path

import requests

from .ai_client import AiClient
from .audio import VoiceRecorder, play_wav
from .config import Settings
from .game_state import build_context, read_game_state, save_context
from .screen_capture import capture_game_window, is_game_foreground


LOGGER = logging.getLogger("chester")


def write_reply(path: Path | None, text: str) -> None:
    if path is None:
        LOGGER.warning("回复文件路径不可用，已跳过游戏内气泡显示")
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
        self._seen_request_ids: set[str] = set()
        self._last_bridge_heartbeat = 0.0

    def capture_context(
        self,
        request_state: dict[str, object] | None = None,
    ) -> tuple[bytes, dict[str, object]]:
        capture = capture_game_window(
            self.settings.game_window_title,
            self.settings.screenshot_max_width,
        )
        game_state = (
            {
                "available": True,
                "age_seconds": 0.0,
                "stale": False,
                "source": "mod_request",
                "data": request_state,
            }
            if request_state is not None
            else read_game_state(self.settings.state_file)
        )
        context = build_context(game_state, capture.window)
        self.settings.latest_screenshot.write_bytes(capture.png)
        save_context(self.settings.latest_context, context)
        LOGGER.info(
            "已截取 %sx%s 游戏画面；Lua 状态可用=%s",
            capture.window["capture_size"]["width"],
            capture.window["capture_size"]["height"],
            game_state.get("available"),
        )
        return capture.png, context

    def process_audio(
        self,
        wav: bytes,
        request_state: dict[str, object] | None = None,
    ) -> None:
        if not wav:
            message = "我没有听到声音，请按住 V 再说一次。"
            LOGGER.warning(message)
            write_reply(self.settings.reply_file, message)
            return
        with self._busy:
            screenshot, context = self.capture_context(request_state)
            LOGGER.info("正在识别 %.1f KiB 的麦克风录音", len(wav) / 1024)
            text = self.ai.transcribe(wav)
            if not text:
                message = "我没有听清楚，请按住 V 再说一次。"
                LOGGER.warning(message)
                write_reply(self.settings.reply_file, message)
                return
            self._answer(text, screenshot, context)

    def process_text(self, text: str) -> str:
        with self._busy:
            screenshot, context = self.capture_context()
            return self._answer(text, screenshot, context)

    def _answer(self, text: str, screenshot: bytes, context: dict[str, object]) -> str:
        LOGGER.info("玩家：%s", text)
        LOGGER.info(
            "正在等待 AI 回答（思考模式=%s，最长等待 %.0f 秒）……",
            "开启" if self.settings.vision_thinking else "关闭",
            self.settings.request_timeout_seconds,
        )
        reply = self.ai.chat(text, screenshot, context)
        LOGGER.info("切斯特：%s", reply)
        write_reply(self.settings.reply_file, reply)
        wav = self.ai.synthesize(reply)
        play_wav(wav)
        return reply

    def run_mod_request_loop(self, poll_interval: float = 0.05) -> None:
        path = self.settings.request_file
        if path is None:
            raise RuntimeError("无法确定 Mod 请求文件路径")
        path.parent.mkdir(parents=True, exist_ok=True)
        LOGGER.info("Mod 桥接启动：request_file=%s", path)
        LOGGER.info("状态文件=%s；回复文件=%s", self.settings.state_file, self.settings.reply_file)
        self._ignore_existing_mod_requests(path)
        while True:
            self._log_bridge_heartbeat(path)
            for request in self._read_mod_requests(path):
                LOGGER.info(
                    "收到 Mod 事件：action=%s id=%s state=%s",
                    request.get("action"),
                    request.get("id"),
                    "有" if isinstance(request.get("state"), dict) else "无",
                )
                self._handle_mod_request(request)
            time.sleep(poll_interval)

    def _log_bridge_heartbeat(self, path: Path) -> None:
        now = time.monotonic()
        if now - self._last_bridge_heartbeat < 5:
            return
        self._last_bridge_heartbeat = now
        try:
            size: int | str = path.stat().st_size
        except OSError as exc:
            size = f"不可用（{exc}）"
        LOGGER.info(
            "Mod 桥接心跳：size=%s seen_events=%s recording=%s busy=%s",
            size,
            len(self._seen_request_ids),
            self.recorder.is_recording,
            self._busy.locked(),
        )

    def _ignore_existing_mod_requests(self, path: Path) -> None:
        existing = self._load_mod_request_events(path)
        self._seen_request_ids.update(self._request_id(event) for event in existing)
        if existing:
            LOGGER.info("忽略启动前已有的 Mod 请求：%s 个事件", len(existing))
        else:
            LOGGER.info("请求文件尚未生成或没有事件，等待 Mod 首次按键事件")

    @staticmethod
    def _request_id(request: dict[str, object]) -> str:
        request_id = request.get("id")
        if isinstance(request_id, str) and request_id:
            return request_id
        return json.dumps(request, ensure_ascii=False, sort_keys=True)

    def _load_mod_request_events(self, path: Path) -> list[dict[str, object]]:
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        except OSError:
            LOGGER.exception("读取 Mod 请求文件失败")
            return []
        if not raw.strip():
            return []

        try:
            document = json.loads(raw)
        except json.JSONDecodeError:
            LOGGER.warning("Mod 请求 JSON 暂未写完整，将在下一轮重试")
            return []

        if isinstance(document, dict) and isinstance(document.get("events"), list):
            values = document["events"]
        elif isinstance(document, dict) and isinstance(document.get("action"), str):
            values = [document]
        else:
            LOGGER.warning("Mod 请求 JSON 结构无效：需要 events 数组")
            return []
        return [value for value in values if isinstance(value, dict)]

    def _read_mod_requests(self, path: Path) -> list[dict[str, object]]:
        found: list[dict[str, object]] = []
        for request in self._load_mod_request_events(path):
            request_id = self._request_id(request)
            if request_id in self._seen_request_ids:
                continue
            self._seen_request_ids.add(request_id)
            found.append(request)
        if found:
            LOGGER.info("从 Mod 请求 JSON 读取到 %s 个新事件", len(found))
        return found

    def _handle_mod_request(self, request: dict[str, object]) -> None:
        action = request.get("action")
        LOGGER.info(
            "处理 Mod 事件：action=%s recording=%s busy=%s",
            action,
            self.recorder.is_recording,
            self._busy.locked(),
        )
        if action == "start_recording":
            if self._busy.locked() or self.recorder.is_recording:
                LOGGER.warning("忽略开始录音事件：录音或上一轮处理仍在进行")
                return
            try:
                self.recorder.start()
                LOGGER.info("录音已开始")
            except Exception:
                LOGGER.exception("录音启动失败")
            return

        if action != "stop_recording":
            LOGGER.warning("忽略未知 Mod 事件：%s", action)
            return
        if not self.recorder.is_recording:
            LOGGER.warning("忽略停止录音事件：录音机当前没有录音")
            return
        try:
            wav = self.recorder.stop()
            state = request.get("state")
            LOGGER.info("录音已停止：wav_bytes=%s state=%s", len(wav), isinstance(state, dict))
            threading.Thread(
                target=self._safe_process_audio,
                args=(wav, state if isinstance(state, dict) else None),
                daemon=True,
                name="chester-turn",
            ).start()
        except Exception:
            LOGGER.exception("录音停止失败")

    def run_hotkey_loop(self) -> None:
        try:
            from pynput import keyboard
        except ImportError as exc:
            raise RuntimeError("缺少按键监听组件 pynput") from exc

        key_name = self.settings.voice_key
        LOGGER.info("准备就绪。在游戏中按住 %s 键和切斯特说话；按 Ctrl+C 退出。", key_name.upper())

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
                LOGGER.info("正在听……")
            except Exception:
                LOGGER.exception("无法开始录音")

        def on_release(key: object) -> None:
            if not is_voice_key(key) or not self.recorder.is_recording:
                return
            try:
                wav = self.recorder.stop()
                LOGGER.info("说话键已松开，正在处理……")
                threading.Thread(
                    target=self._safe_process_audio,
                    args=(wav,),
                    daemon=True,
                    name="chester-turn",
                ).start()
            except Exception:
                LOGGER.exception("无法停止录音")

        with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
            listener.join()

    def _safe_process_audio(
        self,
        wav: bytes,
        request_state: dict[str, object] | None = None,
    ) -> None:
        try:
            self.process_audio(wav, request_state)
        except requests.Timeout:
            message = "AI 接口响应超时了，请再按 V 重试一次。"
            LOGGER.error("%s 当前对话已经结束，程序没有死机。", message)
            write_reply(self.settings.reply_file, message)
        except Exception:
            message = "我刚才走神了，请按住 V 再问一次。"
            LOGGER.exception("本次切斯特对话处理失败")
            write_reply(self.settings.reply_file, message)
