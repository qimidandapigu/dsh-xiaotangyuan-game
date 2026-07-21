from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # Allows diagnostics to explain a partially installed environment.
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


GAME_FOLDER = "Don't Starve Together"
STATE_FILENAME = "dont_starve_ai_mod_state.json"
REPLY_FILENAME = "dont_starve_ai_mod_reply.json"


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip()


def _env_bool(name: str, default: bool = False) -> bool:
    value = _env(name, "true" if default else "false").lower()
    return value in {"1", "true", "yes", "on", "enabled"}


def parse_steam_library_paths(text: str) -> list[Path]:
    """Extract Steam library paths from libraryfolders.vdf without a VDF dependency."""
    paths: list[Path] = []
    for raw in re.findall(r'"path"\s+"([^"]+)"', text, flags=re.IGNORECASE):
        path = Path(raw.replace("\\\\", "\\"))
        if path not in paths:
            paths.append(path)
    return paths


def _steam_roots() -> list[Path]:
    roots: list[Path] = []
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            value, _ = winreg.QueryValueEx(key, "SteamPath")
            roots.append(Path(value))
    except (ImportError, OSError):
        pass

    roots.extend(
        Path(value)
        for value in (
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
            r"D:\SteamLibrary",
            r"E:\Steam",
            r"F:\SteamLibrary",
        )
    )
    unique: list[Path] = []
    for path in roots:
        if path not in unique:
            unique.append(path)
    return unique


def discover_dst_game_dir() -> Path | None:
    candidates: list[Path] = []
    for steam_root in _steam_roots():
        candidates.append(steam_root / "steamapps" / "common" / GAME_FOLDER)
        vdf = steam_root / "steamapps" / "libraryfolders.vdf"
        try:
            library_text = vdf.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for library in parse_steam_library_paths(library_text):
            candidates.append(library / "steamapps" / "common" / GAME_FOLDER)

    for candidate in candidates:
        if (candidate / "data" / "databundles" / "scripts.zip").is_file():
            return candidate.resolve()
    return None


@dataclass(frozen=True)
class Settings:
    api_key: str
    chat_url: str
    transcription_url: str
    tts_url: str
    chat_model: str
    transcription_model: str
    tts_model: str
    tts_voice: str
    voice_provider: str
    volcengine_api_key: str
    volcengine_asr_resource_id: str
    volcengine_tts_resource_id: str
    voice_key: str
    game_window_title: str
    screenshot_max_width: int
    vision_thinking: bool
    request_timeout_seconds: float
    reply_language: str
    game_dir: Path | None
    state_file: Path | None
    reply_file: Path | None
    runtime_dir: Path

    @property
    def latest_screenshot(self) -> Path:
        return self.runtime_dir / "latest_screenshot.png"

    @property
    def latest_context(self) -> Path:
        return self.runtime_dir / "latest_context.json"

    @property
    def log_file(self) -> Path:
        return self.runtime_dir / "chester.log"

    def api_errors(self) -> list[str]:
        errors: list[str] = []
        if not self.api_key:
            errors.append("缺少 AI_API_KEY")
        if not self.chat_model:
            errors.append("缺少 CHAT_MODEL")
        if self.voice_provider == "volcengine":
            if not self.volcengine_api_key:
                errors.append("缺少 VOLCENGINE_API_KEY")
        else:
            if not self.transcription_model:
                errors.append("缺少 TRANSCRIPTION_MODEL")
            if not self.tts_model:
                errors.append("缺少 TTS_MODEL")
        return errors


def load_settings(project_root: Path | None = None) -> Settings:
    if project_root is not None:
        root = project_root.resolve()
    elif getattr(sys, "frozen", False):
        root = Path(sys.executable).resolve().parent
    else:
        root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")

    base_url = _env("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    configured_game_dir = _env("DST_GAME_DIR")
    game_dir = Path(configured_game_dir).expanduser().resolve() if configured_game_dir else discover_dst_game_dir()

    default_unsafedata = game_dir / "data" / "unsafedata" if game_dir else None
    configured_state = _env("DST_STATE_FILE")
    configured_reply = _env("DST_REPLY_FILE")
    state_file = (
        Path(configured_state).expanduser().resolve()
        if configured_state
        else (default_unsafedata / STATE_FILENAME if default_unsafedata else None)
    )
    reply_file = (
        Path(configured_reply).expanduser().resolve()
        if configured_reply
        else (default_unsafedata / REPLY_FILENAME if default_unsafedata else None)
    )

    runtime_dir = root / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    return Settings(
        api_key=_env("AI_API_KEY"),
        chat_url=_env("CHAT_URL", f"{base_url}/chat/completions"),
        transcription_url=_env("TRANSCRIPTION_URL", f"{base_url}/audio/transcriptions"),
        tts_url=_env("TTS_URL", f"{base_url}/audio/speech"),
        chat_model=_env("CHAT_MODEL", "gpt-4o-mini"),
        transcription_model=_env("TRANSCRIPTION_MODEL", "whisper-1"),
        tts_model=_env("TTS_MODEL", "tts-1"),
        tts_voice=_env("TTS_VOICE", "alloy"),
        voice_provider=_env("VOICE_PROVIDER", "openai").lower(),
        volcengine_api_key=_env("VOLCENGINE_API_KEY"),
        volcengine_asr_resource_id=_env("VOLCENGINE_ASR_RESOURCE_ID", "volc.bigasr.auc"),
        volcengine_tts_resource_id=_env("VOLCENGINE_TTS_RESOURCE_ID", "seed-tts-1.0"),
        voice_key=_env("VOICE_KEY", "v").lower(),
        game_window_title=_env("GAME_WINDOW_TITLE", GAME_FOLDER),
        screenshot_max_width=max(320, int(_env("SCREENSHOT_MAX_WIDTH", "512"))),
        vision_thinking=_env_bool("VISION_THINKING", False),
        request_timeout_seconds=max(5.0, float(_env("REQUEST_TIMEOUT_SECONDS", "30"))),
        reply_language=_env("REPLY_LANGUAGE", "Chinese"),
        game_dir=game_dir,
        state_file=state_file,
        reply_file=reply_file,
        runtime_dir=runtime_dir,
    )
