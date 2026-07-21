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
            "已截取 %sx%s 游戏画面；Lua 状态可用=%s",
            capture.window["capture_size"]["width"],
            capture.window["capture_size"]["height"],
            game_state.get("available"),
        )
        return capture.png, context

    def process_audio(self, wav: bytes) -> None:
        if not wav:
            LOGGER.warning("没有录到麦克风声音")
            return
        with self._busy:
            screenshot, context = self.capture_context()
            LOGGER.info("正在识别 %.1f KiB 的麦克风录音", len(wav) / 1024)
            text = self.ai.transcribe(wav)
            if not text:
                LOGGER.warning("没有识别出语音内容")
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

    def _safe_process_audio(self, wav: bytes) -> None:
        try:
            self.process_audio(wav)
        except requests.Timeout:
            message = "AI 接口响应超时了，请再按 V 重试一次。"
            LOGGER.error("%s 当前对话已经结束，程序没有死机。", message)
            write_reply(self.settings.reply_file, message)
        except Exception:
            LOGGER.exception("本次切斯特对话处理失败")
