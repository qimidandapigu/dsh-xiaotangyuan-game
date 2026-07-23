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
HISTORY_LIMIT = 10


def write_reply(
    path: Path | None,
    text: str,
    recipient_userid: str | None = None,
) -> None:
    if path is None:
        LOGGER.warning("回复文件路径不可用，已跳过游戏内气泡显示")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": str(uuid.uuid4()),
        "text": text,
        "created_at_unix": time.time(),
    }
    if recipient_userid:
        payload["recipient_userid"] = recipient_userid
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
        self._last_bridge_status_write = 0.0
        self._last_request_at_unix: float | None = None
        self._last_request_action: str | None = None
        self._conversation_history_file = getattr(settings, "conversation_history_file", None)
        self._conversation_history = self._load_conversation_history()
        self._last_question = self._latest_question()
        self._restore_ai_history()

    def _load_conversation_history(self) -> list[dict[str, object]]:
        path = self._conversation_history_file
        if not isinstance(path, Path):
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, json.JSONDecodeError):
            LOGGER.warning("Unable to read conversation history; starting empty", exc_info=True)
            return []
        turns = payload.get("turns") if isinstance(payload, dict) else None
        if not isinstance(turns, list):
            return []
        return [
            turn
            for turn in turns[-HISTORY_LIMIT:]
            if isinstance(turn, dict)
            and isinstance(turn.get("user"), str)
            and isinstance(turn.get("assistant"), str)
        ]

    def _latest_question(self) -> str | None:
        if not self._conversation_history:
            return None
        question = self._conversation_history[-1].get("user")
        return question if isinstance(question, str) and question.strip() else None

    def _restore_ai_history(self) -> None:
        history = getattr(self.ai, "history", None)
        if history is None:
            return
        for turn in self._conversation_history[-6:]:
            history.append(("user", turn["user"]))
            history.append(("assistant", turn["assistant"]))

    def _record_conversation_turn(self, question: str, reply: str) -> None:
        self._last_question = question
        self._conversation_history.append(
            {"user": question, "assistant": reply, "created_at_unix": time.time()}
        )
        self._conversation_history = self._conversation_history[-HISTORY_LIMIT:]
        path = self._conversation_history_file
        if not isinstance(path, Path):
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"schema_version": 1, "turns": self._conversation_history}
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        except OSError:
            LOGGER.warning("Unable to save conversation history", exc_info=True)

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
        recipient_userid: str | None = None,
    ) -> None:
        if not wav:
            message = "我没有听到声音，请按住 V 再说一次。"
            LOGGER.warning(message)
            write_reply(self.settings.reply_file, message, recipient_userid)
            return
        with self._busy:
            screenshot, context = self.capture_context(request_state)
            LOGGER.info("正在识别 %.1f KiB 的麦克风录音", len(wav) / 1024)
            text = self.ai.transcribe(wav)
            if not text:
                message = "我没有听清楚，请按住 V 再说一次。"
                LOGGER.warning(message)
                write_reply(self.settings.reply_file, message, recipient_userid)
                return
            self._answer(text, screenshot, context, recipient_userid)

    def process_text(self, text: str) -> str:
        with self._busy:
            screenshot, context = self.capture_context()
            return self._answer(text, screenshot, context)

    def _answer(
        self,
        text: str,
        screenshot: bytes,
        context: dict[str, object],
        recipient_userid: str | None = None,
    ) -> str:
        LOGGER.info("玩家：%s", text)
        LOGGER.info(
            "正在等待 AI 回答（思考模式=%s，最长等待 %.0f 秒）……",
            "开启" if self.settings.vision_thinking else "关闭",
            self.settings.request_timeout_seconds,
        )
        reply = self.ai.chat(text, screenshot, context)
        self._record_conversation_turn(text, reply)
        LOGGER.info("切斯特：%s", reply)
        write_reply(self.settings.reply_file, reply, recipient_userid)
        wav = self.ai.synthesize(reply)
        play_wav(wav)
        return reply

    def retry_last_question(
        self,
        request_state: dict[str, object] | None = None,
        recipient_userid: str | None = None,
    ) -> None:
        question = self._last_question
        if not question:
            write_reply(
                self.settings.reply_file,
                "我还没有听到上一句话，先按住 V 和我说话吧。",
                recipient_userid,
            )
            return
        with self._busy:
            screenshot, context = self.capture_context(request_state)
            LOGGER.info("正在重试上一条问题：%s", question)
            self._answer(question, screenshot, context, recipient_userid)

    def process_game_reminder(
        self,
        kind: str,
        fallback_message: str,
        request_state: dict[str, object] | None = None,
        recipient_userid: str | None = None,
    ) -> None:
        """Ask AI for a short situational reminder without altering chat history."""
        with self._busy:
            screenshot, context = self.capture_context(request_state)
            prompt = (
                "这是一条游戏内自动提醒，不是玩家提问。"
                f"提醒类型：{kind}。基础提醒：{fallback_message}\n"
                "请以切斯特的口吻改写成一句自然、实用的中文提醒，不超过 30 个汉字。"
                "不要使用角色前缀、Markdown、解释或反问。"
            )
            reply = self.ai.chat(
                prompt,
                screenshot,
                context,
                include_history=False,
                remember=False,
            )
            write_reply(self.settings.reply_file, reply or fallback_message, recipient_userid)

    def run_mod_request_loop(self, poll_interval: float = 0.05) -> None:
        path = self.settings.request_file
        if path is None:
            raise RuntimeError("无法确定 Mod 请求文件路径")
        path.parent.mkdir(parents=True, exist_ok=True)
        LOGGER.info("Mod 桥接启动：request_file=%s", path)
        LOGGER.info("状态文件=%s；回复文件=%s", self.settings.state_file, self.settings.reply_file)
        self._ignore_existing_mod_requests(path)
        while True:
            self._write_bridge_status()
            self._log_bridge_heartbeat(path)
            for request in self._read_mod_requests(path):
                self._last_request_at_unix = time.time()
                action = request.get("action")
                self._last_request_action = action if isinstance(action, str) else None
                self._write_bridge_status(force=True)
                LOGGER.info(
                    "收到 Mod 事件：action=%s id=%s state=%s",
                    request.get("action"),
                    request.get("id"),
                    "有" if isinstance(request.get("state"), dict) else "无",
                )
                self._handle_mod_request(request)
            time.sleep(poll_interval)

    def _write_bridge_status(self, force: bool = False) -> None:
        """Publish lightweight, secret-free bridge health for the in-game HUD."""
        path = getattr(self.settings, "bridge_status_file", None)
        if not isinstance(path, Path):
            return
        now_monotonic = time.monotonic()
        if not force and now_monotonic - self._last_bridge_status_write < 1.0:
            return
        self._last_bridge_status_write = now_monotonic

        last_reply_at_unix: float | None = None
        reply_file = getattr(self.settings, "reply_file", None)
        if isinstance(reply_file, Path):
            try:
                last_reply_at_unix = reply_file.stat().st_mtime
            except OSError:
                pass
        payload = {
            "schema_version": 1,
            "heartbeat_at_unix": time.time(),
            "last_request_at_unix": self._last_request_at_unix,
            "last_request_action": self._last_request_action,
            "last_reply_at_unix": last_reply_at_unix,
            "chat_model": getattr(self.settings, "chat_model", "") or "unknown",
            "busy": self._busy.locked(),
            "recording": self.recorder.is_recording,
        }
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        except OSError:
            LOGGER.warning("Unable to write bridge status", exc_info=True)

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

    @staticmethod
    def _recipient_userid(request: dict[str, object]) -> str | None:
        userid = request.get("recipient_userid")
        return userid if isinstance(userid, str) and userid else None

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

        if action == "game_reminder":
            reminder = request.get("reminder")
            kind = reminder.get("kind") if isinstance(reminder, dict) else None
            message = reminder.get("message") if isinstance(reminder, dict) else None
            if not isinstance(kind, str) or not isinstance(message, str) or not message:
                LOGGER.warning("Ignoring malformed game reminder event")
                return
            if self._busy.locked() or self.recorder.is_recording:
                LOGGER.info("Skipping AI game reminder while voice processing is active: %s", kind)
                return
            state = request.get("state")
            threading.Thread(
                target=self._safe_process_game_reminder,
                args=(
                    kind,
                    message,
                    state if isinstance(state, dict) else None,
                    self._recipient_userid(request),
                ),
                daemon=True,
                name="chester-game-reminder",
            ).start()
            return

        if action == "retry_last":
            recipient_userid = self._recipient_userid(request)
            if self._busy.locked() or self.recorder.is_recording:
                write_reply(
                    self.settings.reply_file,
                    "我还在处理上一句话，请稍等一下。",
                    recipient_userid,
                )
                return
            state = request.get("state")
            threading.Thread(
                target=self._safe_retry_last_question,
                args=(state if isinstance(state, dict) else None, recipient_userid),
                daemon=True,
                name="chester-retry",
            ).start()
            return

        if action != "stop_recording":
            LOGGER.warning("忽略未知 Mod 事件：%s", action)
            write_reply(
                self.settings.reply_file,
                "我没有认出这个指令，请重启切斯特 AI 后再试一次。",
                self._recipient_userid(request),
            )
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
                args=(
                    wav,
                    state if isinstance(state, dict) else None,
                    self._recipient_userid(request),
                ),
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
        recipient_userid: str | None = None,
    ) -> None:
        try:
            self.process_audio(wav, request_state, recipient_userid)
        except requests.Timeout:
            message = "AI 接口响应超时了，请再按 V 重试一次。"
            LOGGER.error("%s 当前对话已经结束，程序没有死机。", message)
            write_reply(self.settings.reply_file, message, recipient_userid)
        except Exception:
            message = "我刚才走神了，请按住 V 再问一次。"
            LOGGER.exception("本次切斯特对话处理失败")
            write_reply(self.settings.reply_file, message, recipient_userid)

    def _safe_process_game_reminder(
        self,
        kind: str,
        fallback_message: str,
        request_state: dict[str, object] | None = None,
        recipient_userid: str | None = None,
    ) -> None:
        try:
            self.process_game_reminder(kind, fallback_message, request_state, recipient_userid)
        except requests.Timeout:
            LOGGER.warning("AI game reminder timed out; using fixed text: %s", kind)
            write_reply(self.settings.reply_file, fallback_message, recipient_userid)
        except Exception:
            LOGGER.exception("AI game reminder failed; using fixed text: %s", kind)
            write_reply(self.settings.reply_file, fallback_message, recipient_userid)

    def _safe_retry_last_question(
        self,
        request_state: dict[str, object] | None = None,
        recipient_userid: str | None = None,
    ) -> None:
        try:
            self.retry_last_question(request_state, recipient_userid)
        except requests.Timeout:
            message = "重新提问超时了，请稍后按 Shift+V 再试一次。"
            LOGGER.error("%s", message)
            write_reply(self.settings.reply_file, message, recipient_userid)
        except Exception:
            message = "我没能重新回答上一句话，请稍后按 Shift+V 再试一次。"
            LOGGER.exception("重试上一条问题失败")
            write_reply(self.settings.reply_file, message, recipient_userid)
