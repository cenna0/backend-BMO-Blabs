import io
import wave


def make_wav(
    *,
    sample_rate: int = 16_000,
    channels: int = 1,
    sample_width: int = 2,
    frames: int = 3_200,
) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(sample_width)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00" * frames * channels * sample_width)
    return buffer.getvalue()
