from __future__ import annotations

from dataclasses import dataclass


class GameWindowNotFound(RuntimeError):
    pass


@dataclass(frozen=True)
class Capture:
    png: bytes
    window: dict[str, object]


def is_game_foreground(title_fragment: str) -> bool:
    """Return true only while the player is actively using the DST window."""
    try:
        import win32gui
    except ImportError:
        return False
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return False
    title = win32gui.GetWindowText(hwnd)
    return title_fragment.casefold() in title.casefold()


def _find_window(title_fragment: str) -> tuple[int, str]:
    try:
        import win32gui
    except ImportError as exc:
        raise RuntimeError("pywin32 is required for game-window capture") from exc

    matches: list[tuple[int, str]] = []

    def visit(hwnd: int, _extra: object) -> None:
        if not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if title_fragment.casefold() in title.casefold():
            matches.append((hwnd, title))

    win32gui.EnumWindows(visit, None)
    if not matches:
        raise GameWindowNotFound(
            f'No visible, non-minimized window contains "{title_fragment}" in its title'
        )
    return matches[0]


def capture_game_window(title_fragment: str, max_width: int = 1280) -> Capture:
    try:
        import mss
        import mss.tools
        import numpy as np
        import win32gui
    except ImportError as exc:
        raise RuntimeError(f"Capture dependency is missing: {exc.name}") from exc

    hwnd, title = _find_window(title_fragment)
    left_top = win32gui.ClientToScreen(hwnd, (0, 0))
    client_right, client_bottom = win32gui.GetClientRect(hwnd)[2:]
    width = int(client_right)
    height = int(client_bottom)
    if width <= 0 or height <= 0:
        raise GameWindowNotFound(f'Window "{title}" has an empty client area')

    monitor = {
        "left": int(left_top[0]),
        "top": int(left_top[1]),
        "width": width,
        "height": height,
    }
    with mss.mss() as grabber:
        shot = grabber.grab(monitor)

    rgb = np.frombuffer(shot.rgb, dtype=np.uint8).reshape(height, width, 3)
    output_width = width
    output_height = height
    if width > max_width:
        scale = max_width / width
        output_width = max_width
        output_height = max(1, round(height * scale))
        y_index = np.linspace(0, height - 1, output_height).astype(np.intp)
        x_index = np.linspace(0, width - 1, output_width).astype(np.intp)
        rgb = rgb[y_index][:, x_index]

    png = mss.tools.to_png(rgb.tobytes(), (output_width, output_height))
    return Capture(
        png=png,
        window={
            "title": title,
            "handle": hwnd,
            "screen_rect": monitor,
            "capture_size": {"width": output_width, "height": output_height},
        },
    )
