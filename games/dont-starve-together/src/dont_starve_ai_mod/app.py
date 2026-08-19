from __future__ import annotations

import json
import hashlib
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import __version__
from .config import Settings
from .harness_client import HarnessClient


LOGGER = logging.getLogger("chester")
ADAPTER_ID = "qimidandapigu.dont-starve-ai-mod"
GAME_ID = "dont-starve-together"
ADAPTER_VERSION = __version__


def write_reply(
    path: Path | None,
    text: str,
    recipient_userid: str | None = None,
    display_duration_seconds: float | None = None,
) -> None:
    if path is None:
        LOGGER.warning("回复文件路径不可用，已跳过游戏内气泡显示")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "text": text,
        "created_at_unix": time.time(),
    }
    if recipient_userid:
        payload["recipient_userid"] = recipient_userid
    if display_duration_seconds is not None:
        payload["display_duration_seconds"] = display_duration_seconds
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def build_chat_context(state: dict[str, object] | None) -> dict[str, object]:
    context: dict[str, object] = {
        "roleInstructions": (
            "You are Chester, the player's warm and practical companion in Don't Starve Together. "
            "Answer in concise natural Chinese unless the player uses another language. "
            "Use the supplied game state as facts and never claim you performed a game action."
        )
    }
    if state is None:
        return context
    context["observation"] = state
    raw_save_id = state.get("save_id")
    if isinstance(raw_save_id, str) and raw_save_id.strip():
        context["saveId"] = hashlib.sha256(
            ("dst:" + raw_save_id.strip()).encode("utf-8")
        ).hexdigest()
    player = state.get("player")
    if isinstance(player, dict):
        name = player.get("name")
        if isinstance(name, str) and name.strip():
            context["playerName"] = name.strip()
    world = state.get("world")
    if isinstance(world, dict):
        cycles = world.get("cycles")
        season = world.get("season")
        date_parts: list[str] = []
        if isinstance(cycles, (int, float)):
            date_parts.append(f"Day {int(cycles) + 1}")
        if isinstance(season, str) and season:
            date_parts.append(season)
        if date_parts:
            context["date"] = ", ".join(date_parts)
        phase = world.get("phase")
        if isinstance(phase, str) and phase:
            context["time"] = phase
    nearby = state.get("nearby")
    if isinstance(nearby, list):
        names = [
            str(item.get("name") or item.get("prefab"))
            for item in nearby[:5]
            if isinstance(item, dict) and (item.get("name") or item.get("prefab"))
        ]
        if names:
            context["nearbyNpc"] = ", ".join(names)
    return context


class ChesterApp:
    """Thin DST Adapter: Lua files in, Harness JSON-RPC out, replies back to Lua."""

    def __init__(self, settings: Settings, gateway: HarnessClient | None = None) -> None:
        self.settings = settings
        self._gateway = gateway or HarnessClient(
            settings.gateway_url,
            adapter_id=ADAPTER_ID,
            game_id=GAME_ID,
            version=ADAPTER_VERSION,
            on_notification=self._on_harness_notification,
            connect_timeout=settings.connection_timeout_seconds,
        )
        self._busy = threading.Lock()
        self._seen_request_ids: set[str] = set()
        self._last_bridge_heartbeat = 0.0
        self._last_bridge_status_write = 0.0
        self._last_request_at_unix: float | None = None
        self._last_request_action: str | None = None
        self._last_error: str | None = None
        self._recording = False
        self._thinking = False
        self._active_recipient_userid: str | None = None
        self._last_present_monotonic = 0.0

    def start_gateway(self, process_id: int) -> None:
        self._gateway.start(process_id)

    def close(self) -> None:
        self._gateway.close()

    def process_text(self, text: str, state: dict[str, object] | None = None) -> str:
        with self._busy:
            result = self._gateway.call(
                "chat.send",
                {"text": text, "context": build_chat_context(state)},
                self.settings.request_timeout_seconds,
            )
        if not isinstance(result, dict) or not isinstance(result.get("reply"), str):
            raise RuntimeError("Harness 没有返回有效文字回复")
        return result["reply"]

    def _on_harness_notification(self, method: str, params: dict[str, Any]) -> None:
        if method == "assistant.status":
            status = params.get("status")
            self._recording = status == "recording"
            self._thinking = status == "thinking"
            self._write_bridge_status(force=True)
            return
        if method in {"assistant.delta", "assistant.text.delta"}:
            text = params.get("text")
            if isinstance(text, str) and text.strip():
                write_reply(
                    self.settings.reply_file,
                    text.strip(),
                    self._active_recipient_userid,
                    30.0,
                )
            return
        if method == "assistant.present":
            text = params.get("text")
            if isinstance(text, str) and text.strip():
                self._recording = False
                self._thinking = False
                self._last_present_monotonic = time.monotonic()
                write_reply(
                    self.settings.reply_file,
                    text.strip(),
                    self._active_recipient_userid,
                    30.0,
                )
                LOGGER.info("Harness 回复：%s", text.strip())
            return
        if method == "assistant.error":
            message = str(params.get("message") or "Harness 语音处理失败")
            self._last_error = message
            self._recording = False
            self._thinking = False
            LOGGER.error("Harness：%s", message)
            if time.monotonic() - self._last_present_monotonic > 2.0:
                write_reply(
                    self.settings.reply_file,
                    "我刚才没听清或没能回答，请按住 V 再试一次。",
                    self._active_recipient_userid,
                )
            self._write_bridge_status(force=True)

    def _publish_state(self, state: dict[str, object] | None) -> None:
        if state is not None:
            self._gateway.notify("state.update", {"observation": state})

    def _retry_last(
        self,
        state: dict[str, object] | None,
        recipient_userid: str | None,
    ) -> None:
        try:
            with self._busy:
                self._active_recipient_userid = recipient_userid
                self._gateway.call(
                    "chat.retry",
                    {"context": build_chat_context(state)},
                    self.settings.request_timeout_seconds,
                )
        except Exception:
            LOGGER.exception("Harness 重试上一条回复失败")
            write_reply(
                self.settings.reply_file,
                "我没能重新回答上一句话，请稍后按 Shift+V 再试一次。",
                recipient_userid,
            )

    def _compose_reminder(
        self,
        kind: str,
        fallback_message: str,
        state: dict[str, object] | None,
        recipient_userid: str | None,
    ) -> None:
        try:
            prompt = (
                "这是一条游戏内自动提醒，不是玩家提问。"
                f"提醒类型：{kind}。基础提醒：{fallback_message}\n"
                "请以切斯特的口吻改写成一句自然、实用的中文提醒，不超过30个汉字。"
                "不要使用角色前缀、Markdown、解释或反问。"
            )
            with self._busy:
                result = self._gateway.call(
                    "assistant.compose",
                    {"text": prompt, "context": build_chat_context(state)},
                    self.settings.request_timeout_seconds,
                )
            reply = result.get("reply") if isinstance(result, dict) else None
            write_reply(
                self.settings.reply_file,
                reply.strip() if isinstance(reply, str) and reply.strip() else fallback_message,
                recipient_userid,
            )
        except Exception:
            LOGGER.exception("Harness 游戏提醒生成失败，使用固定提醒：%s", kind)
            write_reply(self.settings.reply_file, fallback_message, recipient_userid)

    def run_mod_request_loop(self, poll_interval: float = 0.05) -> None:
        path = self.settings.request_file
        if path is None:
            raise RuntimeError("无法确定 Mod 请求文件路径")
        path.parent.mkdir(parents=True, exist_ok=True)
        LOGGER.info("DST Adapter 启动：request_file=%s", path)
        LOGGER.info("Gateway=%s；回复文件=%s", self.settings.gateway_url, self.settings.reply_file)
        self._ignore_existing_mod_requests(path)
        while True:
            self._write_bridge_status()
            self._log_bridge_heartbeat(path)
            for request in self._read_mod_requests(path):
                self._last_request_at_unix = time.time()
                action = request.get("action")
                self._last_request_action = action if isinstance(action, str) else None
                self._write_bridge_status(force=True)
                self._handle_mod_request(request)
            time.sleep(poll_interval)

    def _write_bridge_status(self, force: bool = False) -> None:
        path = self.settings.bridge_status_file
        if path is None:
            return
        now_monotonic = time.monotonic()
        if not force and now_monotonic - self._last_bridge_status_write < 1.0:
            return
        self._last_bridge_status_write = now_monotonic
        last_reply_at_unix: float | None = None
        if self.settings.reply_file is not None:
            try:
                last_reply_at_unix = self.settings.reply_file.stat().st_mtime
            except OSError:
                pass
        payload = {
            "schema_version": 2,
            "heartbeat_at_unix": time.time(),
            "last_request_at_unix": self._last_request_at_unix,
            "last_request_action": self._last_request_action,
            "last_reply_at_unix": last_reply_at_unix,
            "chat_model": "DeepSeek Harness",
            "gateway_connected": self._gateway.connected,
            "busy": self._busy.locked() or self._thinking,
            "recording": self._recording,
            "last_error": self._last_error,
        }
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        except OSError:
            LOGGER.warning("无法写入 Adapter 状态", exc_info=True)

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
            "DST Adapter 心跳：size=%s seen_events=%s harness=%s busy=%s",
            size,
            len(self._seen_request_ids),
            "已连接" if self._gateway.connected else "未连接",
            self._busy.locked(),
        )

    def _ignore_existing_mod_requests(self, path: Path) -> None:
        existing = self._load_mod_request_events(path)
        self._seen_request_ids.update(self._request_id(event) for event in existing)
        if existing:
            LOGGER.info("忽略启动前已有的 Mod 请求：%s 个事件", len(existing))

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
            return []
        if isinstance(document, dict) and isinstance(document.get("events"), list):
            values = document["events"]
        elif isinstance(document, dict) and isinstance(document.get("action"), str):
            values = [document]
        else:
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
        return found

    def _handle_mod_request(self, request: dict[str, object]) -> None:
        action = request.get("action")
        state = request.get("state")
        request_state = state if isinstance(state, dict) else None
        recipient = self._recipient_userid(request)
        if action == "start_recording":
            self._active_recipient_userid = recipient
            self._publish_state(request_state)
            self._gateway.call(
                "voice.start",
                {},
                self.settings.connection_timeout_seconds,
            )
            return
        if action == "stop_recording":
            self._active_recipient_userid = recipient
            self._publish_state(request_state)
            self._gateway.call(
                "voice.stop",
                {},
                self.settings.connection_timeout_seconds,
            )
            return
        if action == "retry_last":
            if self._busy.locked():
                write_reply(self.settings.reply_file, "我还在处理上一句话，请稍等一下。", recipient)
                return
            threading.Thread(
                target=self._retry_last,
                args=(request_state, recipient),
                daemon=True,
                name="chester-harness-retry",
            ).start()
            return
        if action == "game_reminder":
            reminder = request.get("reminder")
            kind = reminder.get("kind") if isinstance(reminder, dict) else None
            message = reminder.get("message") if isinstance(reminder, dict) else None
            if not isinstance(kind, str) or not isinstance(message, str) or not message:
                return
            if self._busy.locked() or self._recording:
                return
            threading.Thread(
                target=self._compose_reminder,
                args=(kind, message, request_state, recipient),
                daemon=True,
                name="chester-harness-reminder",
            ).start()
            return
        LOGGER.warning("忽略未知 Mod 事件：%s", action)
