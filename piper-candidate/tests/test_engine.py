import wave
from pathlib import Path

import pytest

from bmo_piper.engine import PiperEngine, SynthesisError
from bmo_piper.shutdown import ShutdownRequested
from test_manifest import validate_fixture, write_manifest


class FakeConfig:
    sample_rate = 22050
    num_speakers = 4
    speaker_id_map = {"prudence": 0, "spike": 1, "obadiah": 2, "poppy": 3}


class FakeVoice:
    config = FakeConfig()

    def __init__(self):
        self.speaker_ids = []

    def synthesize_wav(self, text, wav_file, syn_config):
        self.speaker_ids.append(syn_config.speaker_id)
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x01\x00" * 2205)


def test_engine_loads_once_and_forces_prudence_zero(tmp_path):
    voice = FakeVoice()
    loads = []

    def factory(model_path, config_path):
        loads.append((model_path, config_path))
        return voice

    output_root = tmp_path / "output"
    output_root.mkdir()
    engine = PiperEngine(
        write_manifest(tmp_path / "assets"),
        output_root,
        factory,
        manifest_validator=validate_fixture,
    )
    first = output_root / "one.wav"
    second = output_root / "two.wav"

    engine.synthesize("Hello BMO.", first, "prudence", 0)
    engine.synthesize("BMO is ready.", second, "prudence", 0)

    assert len(loads) == 1
    assert engine.model_load_count == 1
    assert voice.speaker_ids == [0, 0]
    with wave.open(str(first), "rb") as wav_file:
        assert wav_file.getframerate() == 22050
    assert not list(output_root.glob("*.part"))


@pytest.mark.parametrize("text", ["", "   ", "hello\x00world"])
def test_engine_rejects_malformed_text(tmp_path, text):
    output_root = tmp_path / "output"
    output_root.mkdir()
    engine = PiperEngine(
        write_manifest(tmp_path / "assets"),
        output_root,
        lambda *_args: FakeVoice(),
        manifest_validator=validate_fixture,
    )

    with pytest.raises(SynthesisError):
        engine.synthesize(text, output_root / "bad.wav", "prudence", 0)


def test_engine_rejects_wrong_speaker_and_output_escape(tmp_path):
    output_root = tmp_path / "output"
    output_root.mkdir()
    engine = PiperEngine(
        write_manifest(tmp_path / "assets"),
        output_root,
        lambda *_args: FakeVoice(),
        manifest_validator=validate_fixture,
    )

    with pytest.raises(SynthesisError, match="speaker"):
        engine.synthesize("Hello.", output_root / "wrong.wav", "spike", 1)
    with pytest.raises(SynthesisError, match="output path"):
        engine.synthesize("Hello.", tmp_path / "escape.wav", "prudence", 0)


def test_interrupted_synthesis_removes_partial_output(tmp_path):
    class InterruptedVoice(FakeVoice):
        def synthesize_wav(self, text, wav_file, syn_config):
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(b"\x01\x00" * 100)
            raise ShutdownRequested()

    output_root = tmp_path / "output"
    output_root.mkdir()
    engine = PiperEngine(
        write_manifest(tmp_path / "assets"),
        output_root,
        lambda *_args: InterruptedVoice(),
        manifest_validator=validate_fixture,
    )

    with pytest.raises(ShutdownRequested):
        engine.synthesize("Hello.", output_root / "interrupted.wav", "prudence", 0)

    assert not list(output_root.iterdir())
