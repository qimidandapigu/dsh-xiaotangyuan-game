import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from dont_starve_ai_mod.app import ChesterApp


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
            self.assertEqual(thread.call_args.kwargs["args"], (b"wav", state))
            thread.return_value.start.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
