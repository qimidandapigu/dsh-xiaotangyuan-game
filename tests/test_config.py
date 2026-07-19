from pathlib import Path
from unittest.mock import patch
import unittest

from dont_starve_ai_mod.config import _env, parse_steam_library_paths


class SteamLibraryParsingTests(unittest.TestCase):
    def test_parses_and_deduplicates_paths(self) -> None:
        text = r'''
        "0" { "path" "E:\\steam" }
        "1" { "path" "D:\\SteamLibrary" }
        "2" { "path" "E:\\steam" }
        '''
        self.assertEqual(
            parse_steam_library_paths(text),
            [Path(r"E:\steam"), Path(r"D:\SteamLibrary")],
        )

    def test_blank_optional_url_uses_default(self) -> None:
        with patch.dict("os.environ", {"CHAT_URL": ""}):
            self.assertEqual(_env("CHAT_URL", "https://example.test/chat"), "https://example.test/chat")


if __name__ == "__main__":
    unittest.main()
