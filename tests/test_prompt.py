import unittest

from dont_starve_ai_mod.ai_client import build_system_prompt


class PromptTests(unittest.TestCase):
    def test_prompt_contains_role_language_and_context(self) -> None:
        prompt = build_system_prompt({"chester": {"present": True}}, "Chinese")
        self.assertIn("You are Chester", prompt)
        self.assertIn("Reply in Chinese", prompt)
        self.assertIn('"present":true', prompt)


if __name__ == "__main__":
    unittest.main()
