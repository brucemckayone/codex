"""Unit tests for the FFmpeg command-builder helpers and output validation.

These tests verify the invariants that matter most for transcode reliability:
- `_input_args` applies the resilience flag set in the correct positions
  (global BEFORE `-hwaccel`, per-input BEFORE `-i`), so every decode site
  survives mid-stream corruption.
- `validate_output` correctly rejects missing / tiny / unparseable outputs.
- `verify_decodable` classifies catastrophic input as `CORRUPT_INPUT`.

The tests exercise pure helpers (no subprocess mocking) wherever possible,
then touch real fixtures under `tests/fixtures/` for `verify_decodable` and
`validate_output` — which only call ffmpeg/ffprobe directly, so they're
self-contained and don't need the full handler pipeline.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Make the handler package importable without installing the project.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Stub `runpod` before importing handler — the real SDK starts a serverless
# worker on import, which we don't want in tests. Matches the pattern in
# test_handler.py.
sys.modules.setdefault("runpod", MagicMock())

from handler.main import (  # noqa: E402  (sys.path + module-stub above)
    MIN_OUTPUT_BYTES,
    PERMANENT_ERROR_CODES,
    RESILIENT_GLOBAL_FLAGS,
    RESILIENT_INPUT_FLAGS,
    TranscodeError,
    TranscodeErrorCode,
    _build_hls_variant_cmd,
    _build_mezzanine_cmd,
    _build_preview_cmd,
    _input_args,
    validate_output,
    verify_decodable,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


# ---------------------------------------------------------------------------
# _input_args — correct flag composition
# ---------------------------------------------------------------------------


def _index(seq: list[str], needle: str) -> int:
    """Return index of `needle` in seq or -1. Test helper."""
    return seq.index(needle) if needle in seq else -1


class TestInputArgs:
    """The most load-bearing helper in the pipeline — assert its shape."""

    def test_cpu_includes_all_resilience_flags(self):
        args = _input_args("/tmp/input.mp4", use_gpu=False)
        # Global
        assert _index(args, "-max_error_rate") >= 0
        assert args[_index(args, "-max_error_rate") + 1] == "1.0"
        # Demuxer
        assert _index(args, "-fflags") >= 0
        assert args[_index(args, "-fflags") + 1] == "+discardcorrupt"
        # Decoder
        assert _index(args, "-err_detect") >= 0
        assert args[_index(args, "-err_detect") + 1] == "ignore_err"
        # Video error concealment
        assert _index(args, "-ec") >= 0
        assert args[_index(args, "-ec") + 1] == "guess_mvs+deblock+favor_inter"
        # Input last
        assert args[-2] == "-i"
        assert args[-1] == "/tmp/input.mp4"
        # CPU path: no -hwaccel
        assert "-hwaccel" not in args

    def test_gpu_adds_hwaccel_after_global_flags(self):
        args = _input_args("/tmp/input.mp4", use_gpu=True)
        assert "-hwaccel" in args
        assert args[_index(args, "-hwaccel") + 1] == "cuda"
        # Global flags must come BEFORE -hwaccel (global vs per-input ordering)
        assert _index(args, "-max_error_rate") < _index(args, "-hwaccel")

    def test_seek_lands_between_flags_and_input(self):
        args = _input_args("/tmp/input.mp4", use_gpu=False, seek_seconds=42)
        ss_i = _index(args, "-ss")
        input_i = _index(args, "-i")
        assert ss_i >= 0
        assert args[ss_i + 1] == "42"
        # -ss must come before -i (per-input option, before input)
        assert ss_i < input_i
        # -ss must come after global -max_error_rate
        assert _index(args, "-max_error_rate") < ss_i

    def test_no_seek_omits_ss(self):
        args = _input_args("/tmp/input.mp4", use_gpu=False)
        assert "-ss" not in args

    def test_resilience_constants_are_authoritative(self):
        """If someone adds a new global flag, these lists should grow — catch
        accidental removals."""
        assert "-max_error_rate" in RESILIENT_GLOBAL_FLAGS
        assert "+discardcorrupt" in RESILIENT_INPUT_FLAGS
        assert "ignore_err" in RESILIENT_INPUT_FLAGS
        assert "guess_mvs+deblock+favor_inter" in RESILIENT_INPUT_FLAGS


# ---------------------------------------------------------------------------
# Command builders — each invokes _input_args, contains expected codec args
# ---------------------------------------------------------------------------


class TestCommandBuilders:
    def test_mezzanine_cpu_uses_input_args_and_x264(self):
        cmd = _build_mezzanine_cmd("/tmp/in.mp4", "/tmp/out.mp4", use_gpu=False)
        assert cmd[0] == "ffmpeg"
        assert "-max_error_rate" in cmd and "1.0" in cmd
        assert "-fflags" in cmd and "+discardcorrupt" in cmd
        assert "libx264" in cmd
        assert "-hwaccel" not in cmd
        assert cmd[-1] == "/tmp/out.mp4"

    def test_mezzanine_gpu_uses_nvenc(self):
        cmd = _build_mezzanine_cmd("/tmp/in.mp4", "/tmp/out.mp4", use_gpu=True)
        assert "h264_nvenc" in cmd
        assert "-hwaccel" in cmd and "cuda" in cmd
        # Resilience flags still present on GPU path
        assert "+discardcorrupt" in cmd
        assert "ignore_err" in cmd

    def test_hls_variant_cpu(self):
        settings = {
            "height": 720,
            "video_bitrate": "3000k",
            "audio_bitrate": "128k",
        }
        cmd = _build_hls_variant_cmd(
            "/tmp/in.mp4",
            "/tmp/variant",
            "/tmp/variant/index.m3u8",
            settings,
            use_gpu=False,
        )
        assert "libx264" in cmd
        assert "-max_error_rate" in cmd  # resilience propagates
        assert "-hls_playlist_type" in cmd and "vod" in cmd

    def test_preview_seeks_into_input(self):
        cmd = _build_preview_cmd(
            "/tmp/in.mp4",
            "/tmp/preview",
            start_time=30,
            preview_duration=15,
            use_gpu=False,
        )
        # -ss must be present and precede -i
        ss_i = cmd.index("-ss")
        input_i = cmd.index("-i")
        assert ss_i < input_i
        assert cmd[ss_i + 1] == "30"


# ---------------------------------------------------------------------------
# TranscodeError and PERMANENT_ERROR_CODES
# ---------------------------------------------------------------------------


class TestTranscodeError:
    def test_carries_code_and_message(self):
        err = TranscodeError(TranscodeErrorCode.CORRUPT_INPUT, "bad bytes")
        assert err.code == "CORRUPT_INPUT"
        assert str(err) == "bad bytes"

    def test_optional_cause_is_preserved(self):
        inner = ValueError("inner")
        err = TranscodeError(TranscodeErrorCode.INFRA_ERROR, "wrapped", cause=inner)
        assert err.cause is inner

    def test_permanent_set_includes_expected_codes(self):
        for code in (
            TranscodeErrorCode.CORRUPT_INPUT,
            TranscodeErrorCode.UNSUPPORTED_CODEC,
            TranscodeErrorCode.INVALID_DURATION,
            TranscodeErrorCode.MISSING_STREAM,
            TranscodeErrorCode.OUTPUT_VALIDATION_FAILED,
        ):
            assert code in PERMANENT_ERROR_CODES, f"{code} should be permanent"

    def test_permanent_set_excludes_transient_codes(self):
        assert TranscodeErrorCode.INFRA_ERROR not in PERMANENT_ERROR_CODES
        assert TranscodeErrorCode.WEBHOOK_DELIVERY_FAILED not in PERMANENT_ERROR_CODES


# ---------------------------------------------------------------------------
# validate_output — real filesystem + real ffprobe
# ---------------------------------------------------------------------------


@pytest.fixture
def healthy_fixture() -> Path:
    p = FIXTURES / "healthy_short.mp4"
    if not p.exists():
        pytest.skip(f"Fixture missing: {p}")
    return p


@pytest.fixture
def unparseable_fixture() -> Path:
    p = FIXTURES / "unparseable.bin"
    if not p.exists():
        pytest.skip(f"Fixture missing: {p}")
    return p


class TestValidateOutput:
    def test_accepts_healthy_file(self, healthy_fixture: Path):
        # No exception
        validate_output(str(healthy_fixture), "healthy fixture")

    def test_rejects_missing_file(self, tmp_path: Path):
        missing = tmp_path / "does-not-exist.mp4"
        with pytest.raises(TranscodeError) as exc:
            validate_output(str(missing), "missing test")
        assert exc.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED
        assert "missing" in str(exc.value).lower()

    def test_rejects_tiny_file(self, tmp_path: Path):
        tiny = tmp_path / "tiny.mp4"
        tiny.write_bytes(b"a" * (MIN_OUTPUT_BYTES - 1))
        with pytest.raises(TranscodeError) as exc:
            validate_output(str(tiny), "tiny test")
        assert exc.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED
        assert "small" in str(exc.value).lower()

    def test_rejects_unparseable_file(self, unparseable_fixture: Path):
        with pytest.raises(TranscodeError) as exc:
            validate_output(str(unparseable_fixture), "unparseable test")
        assert exc.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED


# ---------------------------------------------------------------------------
# verify_decodable — the actual resilience end-to-end check
# ---------------------------------------------------------------------------


class TestVerifyDecodable:
    def test_accepts_healthy_file(self, healthy_fixture: Path):
        # No exception — happy path.
        verify_decodable(str(healthy_fixture))

    def test_accepts_truncated_file(self):
        """The 2026-04-17 incident regression test.
        A file truncated mid-stream must preflight successfully with the
        resilience flag set — that's the whole point of RESILIENT_*_FLAGS."""
        truncated = FIXTURES / "truncated.mp4"
        if not truncated.exists():
            pytest.skip(f"Fixture missing: {truncated}")
        # Must NOT raise. Decode completes with a "partial file" warning.
        verify_decodable(str(truncated))

    def test_rejects_unparseable_bytes(self, unparseable_fixture: Path):
        with pytest.raises(TranscodeError) as exc:
            verify_decodable(str(unparseable_fixture))
        assert exc.value.code == TranscodeErrorCode.CORRUPT_INPUT
