from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import threading
from pathlib import Path

from .app import ChesterApp
from .config import Settings, load_settings
from .game_state import read_game_state
from .mod_installer import LAUNCH_OPTION_FILENAME, ensure_game_mod, install_player_launcher
from .screen_capture import capture_game_window


def _configure_logging(settings: Settings) -> None:
    logging.addLevelName(logging.INFO, "信息")
    logging.addLevelName(logging.WARNING, "警告")
    logging.addLevelName(logging.ERROR, "错误")
    logging.addLevelName(logging.CRITICAL, "严重错误")
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
    print(f"游戏目录：{settings.game_dir or '未找到'}")
    print(f"状态文件：{settings.state_file or '未找到'}")
    state = read_game_state(settings.state_file)
    print(f"Lua 状态：{'可用' if state.get('available') else state.get('reason')}")
    print(f"回复文件：{settings.reply_file or '未找到'}")
    print(f"Mod 请求文件：{settings.request_file or '未找到'}")
    lua_log = settings.request_file.parent / "dont_starve_ai_mod_lua.txt" if settings.request_file else None
    print(f"Lua 诊断日志：{lua_log or '未找到'}")
    print(f"Python 日志：{settings.log_file}")
    print(f"API Key：{'已配置' if settings.api_key else '缺失'}")
    print(f"聊天模型：{settings.chat_model}")
    print(f"语音服务：{settings.voice_provider}")
    print(f"说话按键：{settings.voice_key.upper()}")

    try:
        import sounddevice as sd

        default_input = sd.query_devices(kind="input")
        print(f"麦克风：{default_input['name']}")
    except Exception as exc:
        print(f"麦克风：不可用（{exc}）")

    try:
        capture = capture_game_window(settings.game_window_title, settings.screenshot_max_width)
        size = capture.window["capture_size"]
        print(f"游戏窗口：已找到（{size['width']}x{size['height']}）")
    except Exception as exc:
        print(f"游戏窗口：不可用（{exc}）")
    return 0 if not settings.api_errors() else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="通过语音和游戏画面与切斯特对话")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="检查本地配置和设备")
    group.add_argument("--capture-once", action="store_true", help="保存一次截图和游戏信息，不调用 API")
    group.add_argument("--text", metavar="消息", help="输入文字进行测试，不录制语音")
    group.add_argument(
        "--install",
        action="store_true",
        help="把切斯特 AI 安装到自动检测到的饥荒 Mod 目录",
    )
    group.add_argument("--install-gui", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--launch",
        action="store_true",
        help="安装 Lua Mod、启动 Steam 传入的游戏命令并运行语音服务",
    )
    parser.add_argument("game_command", nargs=argparse.REMAINDER, help=argparse.SUPPRESS)
    return parser


def _set_console_title() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW("切斯特 AI - 饥荒联机版")
    except Exception:
        pass


def _launch_game(app: ChesterApp, settings: Settings, command: list[str]) -> int:
    if not command:
        logging.getLogger("chester").error("Steam 没有传入原始游戏启动命令")
        return 2

    for action in ensure_game_mod(settings):
        logging.getLogger("chester").info("安装：%s", action)

    executable = Path(command[0]).resolve()
    logging.getLogger("chester").info("正在启动《饥荒联机版》：%s", executable)
    game = subprocess.Popen(command, cwd=executable.parent)
    voice_thread = threading.Thread(
        target=app.run_mod_request_loop,
        daemon=True,
        name="chester-voice-bridge",
    )
    voice_thread.start()
    logging.getLogger("chester").info("游戏已启动。在游戏中按住 V 键即可和切斯特说话。")
    exit_code = game.wait()
    logging.getLogger("chester").info("游戏已退出（代码 %s），切斯特 AI 正在关闭。", exit_code)
    return exit_code


def _show_message_box(message: str, *, error: bool = False) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        icon = 0x10 if error else 0x40
        ctypes.windll.user32.MessageBoxW(None, message, "切斯特 AI 安装程序", icon)
    except Exception:
        pass


def _show_install_dialog(destination: Path, launch_option: str) -> None:
    try:
        import tkinter as tk
        from tkinter import ttk
    except ImportError:
        _copy_to_clipboard(launch_option)
        _show_message_box(
            "安装成功！\n\n"
            f"安装位置：\n{destination}\n\n"
            "Steam 启动项已复制到剪贴板。"
        )
        return

    root = tk.Tk()
    root.title("切斯特 AI 安装程序")
    root.geometry("720x360")
    root.minsize(620, 320)

    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="安装成功！", font=("Microsoft YaHei UI", 18, "bold")).pack(anchor="w")
    ttk.Label(frame, text="安装位置：", font=("Microsoft YaHei UI", 10)).pack(anchor="w", pady=(18, 4))
    ttk.Label(
        frame,
        text=str(destination),
        font=("Microsoft YaHei UI", 10),
        wraplength=660,
    ).pack(anchor="w")
    ttk.Label(
        frame,
        text="请把下面一整行粘贴到 Steam →《饥荒联机版》→ 属性 → 启动选项：",
        font=("Microsoft YaHei UI", 10),
    ).pack(anchor="w", pady=(20, 6))

    option_value = tk.StringVar(value=launch_option)
    option_entry = ttk.Entry(frame, textvariable=option_value, font=("Consolas", 10), state="readonly")
    option_entry.pack(fill="x")
    status_value = tk.StringVar(value="")
    status_label = ttk.Label(frame, textvariable=status_value, foreground="#137333")
    status_label.pack(anchor="w", pady=(8, 0))

    def copy_option() -> None:
        root.clipboard_clear()
        root.clipboard_append(launch_option)
        root.update()
        _copy_to_clipboard(launch_option)
        option_entry.focus_set()
        option_entry.selection_range(0, "end")
        status_value.set("✓ 已复制到剪贴板，现在可以直接去 Steam 粘贴。")

    buttons = ttk.Frame(frame)
    buttons.pack(fill="x", side="bottom", pady=(24, 0))
    ttk.Button(buttons, text="复制启动项", command=copy_option).pack(side="left")
    ttk.Button(buttons, text="关闭", command=root.destroy).pack(side="right")

    root.after(100, copy_option)
    root.mainloop()


def _copy_to_clipboard(text: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
        kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalLock.restype = ctypes.c_void_p
        kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalUnlock.restype = wintypes.BOOL
        kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalFree.restype = wintypes.HGLOBAL
        user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
        user32.SetClipboardData.restype = wintypes.HANDLE

        data = f"{text}\0".encode("utf-16-le")
        handle = kernel32.GlobalAlloc(0x0002, len(data))
        if not handle:
            return
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            kernel32.GlobalFree(handle)
            return
        ctypes.memmove(pointer, data, len(data))
        kernel32.GlobalUnlock(handle)

        if not user32.OpenClipboard(None):
            kernel32.GlobalFree(handle)
            return
        try:
            user32.EmptyClipboard()
            if user32.SetClipboardData(13, handle):
                handle = None
        finally:
            user32.CloseClipboard()
            if handle:
                kernel32.GlobalFree(handle)
    except Exception:
        pass


def _install(settings: Settings, *, show_dialog: bool = False) -> int:
    try:
        destination, launch_option, actions = install_player_launcher(settings)
    except Exception as exc:
        logging.getLogger("chester").error("安装失败：%s", exc)
        if show_dialog:
            _show_message_box(f"安装失败：\n\n{exc}", error=True)
        return 1
    for action in actions:
        logging.getLogger("chester").info("安装：%s", action)
    print(f"\n安装成功！安装位置：{destination}")
    print("\n请把下面一整行复制到 Steam 的《饥荒联机版》启动选项中：")
    print(launch_option)
    print(f"\n这行内容也保存在：{destination / LAUNCH_OPTION_FILENAME}")
    if show_dialog:
        _show_install_dialog(destination, launch_option)
    return 0


def main(argv: list[str] | None = None) -> int:
    raw_args = sys.argv[1:] if argv is None else argv
    args = build_parser().parse_args(raw_args)
    settings = load_settings()
    _configure_logging(settings)
    _set_console_title()

    if args.check:
        return _check(settings)

    if args.install:
        return _install(settings)

    if args.install_gui:
        return _install(settings, show_dialog=True)

    if getattr(sys, "frozen", False) and not raw_args:
        return _install(settings, show_dialog=True)

    app = ChesterApp(settings)
    if args.capture_once:
        try:
            app.capture_context()
        except Exception as exc:
            logging.getLogger("chester").error("截图失败：%s", exc)
            return 1
        print(f"截图：{settings.latest_screenshot}")
        print(f"游戏信息：{settings.latest_context}")
        return 0

    errors = settings.api_errors()
    if errors:
        for error in errors:
            logging.getLogger("chester").error(error)
        logging.getLogger("chester").error("请把 .env.example 复制为 .env，并配置 AI 服务")
        return 2

    try:
        if args.launch or args.game_command:
            return _launch_game(app, settings, args.game_command)
        if args.text:
            reply = app.process_text(args.text)
            print(f"切斯特：{reply}")
        else:
            app.run_mod_request_loop()
    except KeyboardInterrupt:
        print("\n已停止。")
    except Exception:
        logging.getLogger("chester").exception("发生严重错误")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
