import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from dont_starve_ai_mod.app import ChesterApp, write_reply


class ModRequestTests(unittest.TestCase):
    def make_app(self, request_file: Path) -> ChesterApp:
        settings = SimpleNamespace(request_file=request_file)
        with patch("dont_starve_ai_mod.app.AiClient"):
            app = ChesterApp(settings)
        app.recorder = Mock()
        app.recorder.is_recording = False
        return app

    def test_reads_new_json_events_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.json"
            app = self.make_app(path)
            document = {
                "schema_version": 1,
                "events": [{"id": "1", "action": "start_recording"}],
            }
            path.write_text(json.dumps(document), encoding="utf-8")

            self.assertEqual(len(app._read_mod_requests(path)), 1)
            self.assertEqual(app._read_mod_requests(path), [])

            document["events"].append({"id": "2", "action": "stop_recording"})
            path.write_text(json.dumps(document), encoding="utf-8")
            requests = app._read_mod_requests(path)
            self.assertEqual(requests[0]["action"], "stop_recording")

    def test_reads_multiple_json_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.json"
            app = self.make_app(path)
            path.write_text(
                json.dumps(
                    {
                        "events": [
                            {"id": "1", "action": "start_recording"},
                            {"id": "2", "action": "stop_recording"},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            requests = app._read_mod_requests(path)

            self.assertEqual(
                [value["action"] for value in requests],
                ["start_recording", "stop_recording"],
            )

    def test_can_ignore_requests_left_by_a_previous_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.json"
            path.write_text(
                json.dumps({"events": [{"id": "1", "action": "start_recording"}]}),
                encoding="utf-8",
            )
            app = self.make_app(path)

            app._ignore_existing_mod_requests(path)

            self.assertEqual(app._read_mod_requests(path), [])

    def test_accepts_single_event_json_for_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.json"
            app = self.make_app(path)
            path.write_text(
                json.dumps({"id": "1", "action": "start_recording"}),
                encoding="utf-8",
            )

            self.assertEqual(app._read_mod_requests(path)[0]["action"], "start_recording")

    def test_start_request_starts_recorder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory) / "requests.json")
            app._handle_mod_request({"id": "1", "action": "start_recording"})
            app.recorder.start.assert_called_once_with()

    def test_stop_request_processes_recording(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory) / "requests.json")
            app.recorder.is_recording = True
            app.recorder.stop.return_value = b"wav"
            app._safe_process_audio = Mock()
            state = {"player": {"prefab": "wilson"}}

            with patch("dont_starve_ai_mod.app.threading.Thread") as thread:
                app._handle_mod_request(
                    {"id": "2", "action": "stop_recording", "state": state}
                )

            app.recorder.stop.assert_called_once_with()
            self.assertEqual(
                thread.call_args.kwargs["args"],
                (b"wav", state, None),
            )
            thread.return_value.start.assert_called_once_with()

    def test_writes_reply_recipient_userid_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reply.json"

            write_reply(path, "Hello", "KU_example")

            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["text"], "Hello")
            self.assertEqual(payload["recipient_userid"], "KU_example")

    def test_writes_bridge_status_for_the_game_panel(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = self.make_app(root / "requests.json")
            app.settings.bridge_status_file = root / "bridge_status.json"
            app.settings.reply_file = root / "reply.json"
            app.settings.chat_model = "test-model"
            app._last_request_at_unix = 123.0
            app._last_request_action = "stop_recording"

            app._write_bridge_status(force=True)

            payload = json.loads(app.settings.bridge_status_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["chat_model"], "test-model")
            self.assertEqual(payload["last_request_at_unix"], 123.0)
            self.assertEqual(payload["last_request_action"], "stop_recording")
            self.assertIn("heartbeat_at_unix", payload)

    def test_persists_the_latest_conversation_turns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = SimpleNamespace(
                request_file=root / "requests.json",
                conversation_history_file=root / "conversation_history.json",
            )
            with patch("dont_starve_ai_mod.app.AiClient"):
                app = ChesterApp(settings)

            for index in range(12):
                app._record_conversation_turn(f"question {index}", f"answer {index}")

            payload = json.loads(settings.conversation_history_file.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["turns"]), 10)
            self.assertEqual(payload["turns"][0]["user"], "question 2")
            self.assertEqual(app._last_question, "question 11")

    def test_retry_request_starts_a_background_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory) / "requests.json")
            app._last_question = "What should I do?"
            app._safe_retry_last_question = Mock()
            state = {"player": {"prefab": "wilson"}}

            with patch("dont_starve_ai_mod.app.threading.Thread") as thread:
                app._handle_mod_request({"id": "3", "action": "retry_last", "state": state})

            self.assertEqual(thread.call_args.kwargs["args"], (state, None))
            self.assertEqual(thread.call_args.kwargs["name"], "chester-retry")
            thread.return_value.start.assert_called_once_with()

    def test_request_recipient_is_forwarded_to_processing_thread(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory) / "requests.json")
            app.recorder.is_recording = True
            app.recorder.stop.return_value = b"wav"

            with patch("dont_starve_ai_mod.app.threading.Thread") as thread:
                app._handle_mod_request(
                    {
                        "id": "4",
                        "action": "stop_recording",
                        "recipient_userid": "KU_example",
                    }
                )

            self.assertEqual(thread.call_args.kwargs["args"], (b"wav", None, "KU_example"))

    def test_game_reminder_starts_an_ephemeral_ai_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory) / "requests.json")

            with patch("dont_starve_ai_mod.app.threading.Thread") as thread:
                app._handle_mod_request(
                    {
                        "id": "5",
                        "action": "game_reminder",
                        "recipient_userid": "KU_example",
                        "reminder": {"kind": "night", "message": "天黑了。"},
                    }
                )

            self.assertEqual(
                thread.call_args.kwargs["args"],
                ("night", "天黑了。", None, "KU_example"),
            )
            self.assertEqual(thread.call_args.kwargs["name"], "chester-game-reminder")


if __name__ == "__main__":
    unittest.main()
