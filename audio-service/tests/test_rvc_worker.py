from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from scripts import rvc_infer


def make_args(tmp_path: Path, *, index: bool = True) -> Namespace:
    input_wav = tmp_path / "input.wav"
    model = tmp_path / "model.pth"
    hubert = tmp_path / "hubert_base.pt"
    rmvpe = tmp_path / "rmvpe.pt"
    for path in (input_wav, model, hubert, rmvpe):
        path.write_bytes(b"asset")
    index_path = tmp_path / "model.index" if index else None
    if index_path is not None:
        index_path.write_bytes(b"index")
    return Namespace(
        model_path=model,
        input_wav=input_wav,
        output_wav=tmp_path / "output.wav",
        hubert_path=hubert,
        rmvpe_path=rmvpe,
        index_path=index_path,
        device="cpu",
        f0_up_key=0,
        f0_method="rmvpe",
        index_rate=0.75,
        protect=0.33,
        rms_mix_rate=0.25,
    )


class FakeSerialization:
    def __init__(self):
        self.allowed = None

    def add_safe_globals(self, allowed):
        self.allowed = allowed


def test_checkpoint_loading_forces_weights_only_and_allowlists_only_dictionary(monkeypatch):
    serialization = FakeSerialization()
    torch_module = SimpleNamespace(serialization=serialization)
    dictionary_type = type("Dictionary", (), {})
    monkeypatch.delenv("TORCH_FORCE_WEIGHTS_ONLY_LOAD", raising=False)

    rvc_infer.configure_checkpoint_safety(torch_module, dictionary_type)

    assert rvc_infer.os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] == "1"
    assert serialization.allowed == [dictionary_type]


def test_run_inference_uses_exact_cpu_baseline_and_optional_index(tmp_path):
    args = make_args(tmp_path)
    calls = {}

    class FakeVc:
        def get_vc(self, model_path):
            calls["model"] = model_path

        def vc_inference(self, speaker, input_path, **kwargs):
            calls["speaker"] = speaker
            calls["input"] = input_path
            calls["kwargs"] = kwargs
            return 40_000, np.zeros(40_000, dtype=np.int16), {"infer": 0.1}, None

    def writer(path, audio, sample_rate, **kwargs):
        calls["writer"] = (path, sample_rate, audio, kwargs)
        Path(path).write_bytes(b"wav")

    rvc_infer.run_inference(args, vc_factory=FakeVc, writer=writer)

    assert calls["model"] == str(args.model_path.resolve())
    assert calls["speaker"] == 0
    assert calls["input"] == str(args.input_wav.resolve())
    assert calls["kwargs"] == {
        "f0_up_key": 0,
        "f0_method": "rmvpe",
        "index_file": str(args.index_path.resolve()),
        "index_rate": 0.75,
        "filter_radius": 3,
        "resample_sr": 0,
        "rms_mix_rate": 0.25,
        "protect": 0.33,
        "hubert_path": str(args.hubert_path.resolve()),
    }
    assert calls["writer"][1] == 40_000
    assert calls["writer"][2].shape == (40_000,)
    assert calls["writer"][2].dtype == np.int16
    assert calls["writer"][3] == {"format": "WAV", "subtype": "PCM_16"}


def test_run_inference_accepts_missing_optional_index(tmp_path):
    args = make_args(tmp_path, index=False)

    class FakeVc:
        def get_vc(self, _model_path):
            pass

        def vc_inference(self, _speaker, _input_path, **kwargs):
            assert kwargs["index_file"] is None
            return 40_000, np.zeros(4_000, dtype=np.float32), {}, None

    rvc_infer.run_inference(
        args,
        vc_factory=FakeVc,
        writer=lambda path, *_args, **_kwargs: Path(path).write_bytes(b"wav"),
    )


def test_run_inference_passes_supported_tuning_parameters(tmp_path):
    args = make_args(tmp_path)
    args.index_rate = 1.0
    args.protect = 0.5
    args.rms_mix_rate = 0.75
    captured = {}

    class FakeVc:
        def get_vc(self, _model_path):
            pass

        def vc_inference(self, _speaker, _input_path, **kwargs):
            captured.update(kwargs)
            return 40_000, np.zeros(4_000, dtype=np.int16), {}, None

    rvc_infer.run_inference(
        args,
        vc_factory=FakeVc,
        writer=lambda path, *_args, **_kwargs: Path(path).write_bytes(b"wav"),
    )

    assert captured["index_rate"] == 1.0
    assert captured["protect"] == 0.5
    assert captured["rms_mix_rate"] == 0.75


@pytest.mark.parametrize("asset", ["model_path", "input_wav", "hubert_path", "rmvpe_path", "index_path"])
def test_run_inference_rejects_missing_or_nonregular_assets(tmp_path, asset):
    args = make_args(tmp_path)
    Path(getattr(args, asset)).unlink()

    with pytest.raises(ValueError, match="required RVC asset"):
        rvc_infer.run_inference(args, vc_factory=lambda: None, writer=lambda *_a, **_k: None)


def test_run_inference_rejects_output_outside_request_directory(tmp_path):
    args = make_args(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    args.output_wav = outside / "output.wav"

    with pytest.raises(ValueError, match="output path"):
        rvc_infer.run_inference(args, vc_factory=lambda: None, writer=lambda *_a, **_k: None)


@pytest.mark.parametrize(
    ("sample_rate", "audio", "error"),
    [
        (None, None, "traceback with /secret/path"),
        (40_000, np.array([np.nan], dtype=np.float32), None),
        (1, np.zeros(10, dtype=np.float32), None),
    ],
)
def test_run_inference_rejects_invalid_engine_results(tmp_path, sample_rate, audio, error):
    args = make_args(tmp_path)

    class FakeVc:
        def get_vc(self, _model_path):
            pass

        def vc_inference(self, *_args, **_kwargs):
            return sample_rate, audio, {}, error

    with pytest.raises(RuntimeError, match="RVC engine returned invalid output"):
        rvc_infer.run_inference(args, vc_factory=FakeVc, writer=lambda *_a, **_k: None)


def test_main_sanitizes_errors_and_removes_partial_output(tmp_path, monkeypatch, capsys):
    args = make_args(tmp_path)

    def fail(_args):
        args.output_wav.write_bytes(b"partial")
        raise RuntimeError("/secret/model.pth token=do-not-log")

    monkeypatch.setattr(rvc_infer, "run_inference", fail)
    argv = [
        "--model-path", str(args.model_path),
        "--input-wav", str(args.input_wav),
        "--output-wav", str(args.output_wav),
        "--hubert-path", str(args.hubert_path),
        "--rmvpe-path", str(args.rmvpe_path),
        "--device", "cpu",
        "--f0-up-key", "0",
        "--f0-method", "rmvpe",
        "--index-rate", "0.75",
        "--protect", "0.33",
        "--rms-mix-rate", "0.25",
    ]

    assert rvc_infer.main(argv) == 1
    captured = capsys.readouterr()
    assert captured.err.strip() == "RVC inference failed"
    assert "secret" not in captured.err
    assert not args.output_wav.exists()


def test_parser_rejects_non_cpu_or_unsupported_f0_method():
    parser = rvc_infer.build_parser()
    common = [
        "--model-path", "model.pth",
        "--input-wav", "input.wav",
        "--output-wav", "output.wav",
        "--hubert-path", "hubert.pt",
        "--rmvpe-path", "rmvpe.pt",
    ]

    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--device", "cuda:0"])
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--f0-method", "harvest"])


@pytest.mark.parametrize(
    ("flag", "value"),
    [
        ("--index-rate", "-0.1"),
        ("--index-rate", "1.1"),
        ("--protect", "-0.1"),
        ("--protect", "0.6"),
        ("--rms-mix-rate", "-0.1"),
        ("--rms-mix-rate", "1.1"),
    ],
)
def test_parser_rejects_out_of_range_tuning(flag, value):
    parser = rvc_infer.build_parser()
    common = [
        "--model-path", "model.pth",
        "--input-wav", "input.wav",
        "--output-wav", "output.wav",
        "--hubert-path", "hubert.pt",
        "--rmvpe-path", "rmvpe.pt",
    ]

    with pytest.raises(SystemExit):
        parser.parse_args([*common, flag, value])
