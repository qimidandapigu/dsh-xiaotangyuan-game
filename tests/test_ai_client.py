import unittest
from types import SimpleNamespace

from dont_starve_ai_mod.ai_client import AiClient, clean_reply


class FakeResponse:
    ok = True

    @staticmethod
    def json() -> dict:
        return {"choices": [{"message": {"content": "ok"}}]}


class FakeSession:
    def __init__(self) -> None:
        self.payload = None

    def post(self, _url, **kwargs):
        self.payload = kwargs["json"]
        return FakeResponse()


class AiClientTests(unittest.TestCase):
    def test_removes_chester_speaker_prefix(self) -> None:
        self.assertEqual(clean_reply("切斯特：你好，主人！"), "你好，主人！")
        self.assertEqual(clean_reply("Chester: Hello!"), "Hello!")

    def test_disables_thinking_for_glm_45_vision(self) -> None:
        settings = SimpleNamespace(
            api_key="test",
            chat_url="https://example.test/chat",
            chat_model="glm-4.5v",
            reply_language="Chinese",
            request_timeout_seconds=30,
            vision_thinking=False,
        )
        client = AiClient(settings)
        session = FakeSession()
        client.session = session

        self.assertEqual(client.chat("hello", b"png", {}), "ok")
        self.assertEqual(session.payload["thinking"], {"type": "disabled"})


if __name__ == "__main__":
    unittest.main()
