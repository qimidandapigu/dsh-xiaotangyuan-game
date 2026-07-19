from __future__ import annotations

import argparse
import logging
import sys

from .app import ChesterApp
from .config import Settings, load_settings
from .game_state import read_game_state
from .screen_capture import capture_game_window


def _configure_logging(settings: Settings) -> None:
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root.addHandler(console)

    file_handler = logging.FileHandler(settings.log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)


def _check(settings: Settings) -> int:
    print(f"Game directory : {settings.game_dir or 'NOT FOUND'}")
    print(f"State file     : {settings.state_file or 'NOT FOUND'}")
    state = read_game_state(settings.state_file)
    print(f"Lua state      : {'available' if state.get('available') else state.get('reason')}")
    print(f"Reply file     : {settings.reply_file or 'NOT FOUND'}")
    print(f"API key        : {'configured' if settings.api_key else 'MISSING'}")
    print(f"Chat model     : {settings.chat_model}")
    print(f"Voice provider : {settings.voice_provider}")
    print(f"Voice key      : {settings.voice_key.upper()}")

    try:
        import sounddevice as sd

        default_input = sd.query_devices(kind="input")
        print(f"Microphone     : {default_input['name']}")
    except Exception as exc:
        print(f"Microphone     : unavailable ({exc})")

    try:
        capture = capture_game_window(settings.game_window_title, settings.screenshot_max_width)
        size = capture.window["capture_size"]
        print(f"Game window    : found ({size['width']}x{size['height']})")
    except Exception as exc:
        print(f"Game window    : unavailable ({exc})")
    return 0 if not settings.api_errors() else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Talk to Chester using voice and game vision")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="check local configuration and devices")
    group.add_argument("--capture-once", action="store_true", help="save one screenshot and context without API calls")
    group.add_argument("--text", metavar="MESSAGE", help="send a typed message instead of recording")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    _configure_logging(settings)

    if args.check:
        return _check(settings)

    app = ChesterApp(settings)
    if args.capture_once:
        try:
            app.capture_context()
        except Exception as exc:
            logging.getLogger("chester").error("Capture failed: %s", exc)
            return 1
        print(f"Screenshot: {settings.latest_screenshot}")
        print(f"Context   : {settings.latest_context}")
        return 0

    errors = settings.api_errors()
    if errors:
        for error in errors:
            logging.getLogger("chester").error(error)
        logging.getLogger("chester").error("Copy .env.example to .env and configure the provider")
        return 2

    try:
        if args.text:
            reply = app.process_text(args.text)
            print(f"Chester: {reply}")
        else:
            app.run_hotkey_loop()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception:
        logging.getLogger("chester").exception("Fatal error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
