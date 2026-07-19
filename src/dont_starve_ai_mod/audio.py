from __future__ import annotations

import io
import os
import tempfile
import threading
import wave


class VoiceRecorder:
    def __init__(self, sample_rate: int = 16_000) -> None:
        self.sample_rate = sample_rate
        self._stream = None
        self._chunks: list[bytes] = []
        self._lock = threading.Lock()

    @property
    def is_recording(self) -> bool:
        return self._stream is not None

    def start(self) -> None:
        if self.is_recording:
            return
        try:
            import sounddevice as sd
        except ImportError as exc:
            raise RuntimeError("sounddevice is required for microphone recording") from exc

        with self._lock:
            self._chunks = []

        def on_audio(indata: object, _frames: int, _time: object, status: object) -> None:
            if status:
                # A transient overflow should not throw from the audio callback.
                pass
            with self._lock:
                self._chunks.append(indata.copy().tobytes())

        stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            blocksize=800,
            callback=on_audio,
        )
        stream.start()
        self._stream = stream

    def stop(self) -> bytes:
        stream = self._stream
        if stream is None:
            return b""
        self._stream = None
        try:
            stream.stop()
        finally:
            stream.close()

        with self._lock:
            pcm = b"".join(self._chunks)
            self._chunks = []
        if not pcm:
            return b""

        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(self.sample_rate)
            wav.writeframes(pcm)
        return output.getvalue()


def play_wav(wav_bytes: bytes) -> None:
    if not wav_bytes:
        return
    try:
        import winsound
    except ImportError as exc:
        raise RuntimeError("WAV playback currently requires Windows") from exc

    path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            path = handle.name
            handle.write(wav_bytes)
        winsound.PlaySound(path, winsound.SND_FILENAME)
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
