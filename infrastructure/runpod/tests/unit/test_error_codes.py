"""The failure webhook's `errorCode`: how the handler picks one (Codex-l2c48.8).

The service believes only the six job-side codes in JOB_ERROR_CODES
(packages/constants/src/transcoding.ts) and files any other as INFRA_ERROR, so
the parity test reads that set from the TypeScript source.
"""

import json
import re
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from handler import main as handler_module
from handler.main import TranscodeError, TranscodeErrorCode

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_CONSTANTS = REPO_ROOT / "packages/constants/src/transcoding.ts"


def _python_codes() -> set[str]:
    return {
        value
        for name, value in vars(TranscodeErrorCode).items()
        if name.isupper() and isinstance(value, str)
    }


class TestParityWithTheService:
    def test_codes_are_exactly_the_job_codes_the_service_believes(self):
        source = TS_CONSTANTS.read_text()
        block = re.search(
            r"const JOB_ERROR_CODES[^=]*=\s*new Set\(\[(.*?)\]", source, re.S
        )
        assert (
            block
        ), "JOB_ERROR_CODES not found in packages/constants/src/transcoding.ts"
        ts_codes = set(re.findall(r"'([A-Z_]+)'", block.group(1)))
        assert ts_codes == _python_codes()


class TestClassifyFfmpegFailure:
    @pytest.mark.parametrize(
        "stderr",
        [
            "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x55] moov atom not found\nin.mov: Invalid data found when processing input",
            "in.mp4: Invalid data found when processing input",
        ],
    )
    def test_unreadable_bytes_are_corrupt_input(self, stderr):
        assert (
            handler_module.classify_ffmpeg_failure(stderr)
            == TranscodeErrorCode.CORRUPT_INPUT
        )

    def test_a_missing_decoder_is_unsupported_codec(self):
        stderr = "Decoder (codec av1) not found for input stream #0:0"
        assert (
            handler_module.classify_ffmpeg_failure(stderr)
            == TranscodeErrorCode.UNSUPPORTED_CODEC
        )

    def test_anything_else_is_ours(self):
        stderr = "[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: out of memory (10)"
        assert (
            handler_module.classify_ffmpeg_failure(stderr)
            == TranscodeErrorCode.INFRA_ERROR
        )


class TestRunFfmpeg:
    def test_a_failed_run_raises_a_coded_error_from_the_whole_stderr(self):
        # The marker sits beyond the 2 KB excerpt kept in the message.
        stderr = "moov atom not found\n" + "x" * 5000
        failure = subprocess.CalledProcessError(1, ["ffmpeg"], stderr=stderr)
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(TranscodeError) as raised:
                handler_module.run_ffmpeg(["ffmpeg"], description="HLS 720p (CPU)")
        assert raised.value.code == TranscodeErrorCode.CORRUPT_INPUT
        assert len(str(raised.value)) < 2100

    def test_the_gpu_fallbacks_still_catch_it(self):
        # _encode_hls_variant and friends fall back to the CPU on RuntimeError.
        assert issubclass(TranscodeError, RuntimeError)


class TestProbe:
    def test_a_file_ffprobe_refuses_is_corrupt_input(self):
        failure = subprocess.CalledProcessError(1, ["ffprobe"], stderr="something odd")
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(TranscodeError) as raised:
                handler_module.probe_media("in.mov")
        assert raised.value.code == TranscodeErrorCode.CORRUPT_INPUT

    def test_output_that_is_not_json_is_corrupt_input(self):
        done = MagicMock(stdout="not json", returncode=0)
        with patch("subprocess.run", return_value=done):
            with pytest.raises(TranscodeError) as raised:
                handler_module.probe_media("in.mov")
        assert raised.value.code == TranscodeErrorCode.CORRUPT_INPUT

    def test_a_duration_ffprobe_cannot_state_is_zero(self):
        duration, _, _ = handler_module.get_media_info({"format": {"duration": "N/A"}})
        assert duration == 0

    @pytest.mark.parametrize(
        "media_type,stream", [("video", "audio"), ("audio", "video")]
    )
    def test_a_missing_stream_is_missing_stream(self, media_type, stream):
        with pytest.raises(TranscodeError) as raised:
            handler_module.validate_streams(
                {"streams": [{"codec_type": stream}]}, media_type
            )
        assert raised.value.code == TranscodeErrorCode.MISSING_STREAM


class TestValidateOutput:
    def test_a_missing_file_fails_output_validation(self, tmp_path):
        with pytest.raises(TranscodeError) as raised:
            handler_module.validate_output(
                str(tmp_path / "stream.ts"), "HLS 720p stream"
            )
        assert raised.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED

    def test_an_empty_file_fails_output_validation(self, tmp_path):
        empty = tmp_path / "index.m3u8"
        empty.write_text("")
        with pytest.raises(TranscodeError):
            handler_module.validate_output(str(empty), "HLS 720p playlist")

    def test_a_written_file_passes(self, tmp_path):
        written = tmp_path / "index.m3u8"
        written.write_text("#EXTM3U\n")
        handler_module.validate_output(str(written), "HLS 720p playlist")


class TestRungValidation:
    """An encode that exits 0 but writes nothing never reaches the master playlist."""

    def _encode(self, tmp_path, use_gpu, run):
        variant_dir = tmp_path / "720p"
        variant_dir.mkdir()
        with patch("handler.main.run_ffmpeg", side_effect=run) as run_ffmpeg:
            handler_module._encode_hls_variant(
                "in.mov",
                str(variant_dir),
                str(variant_dir / "index.m3u8"),
                handler_module.HLS_VARIANTS["720p"],
                "720p",
                use_gpu,
            )
        return run_ffmpeg

    def test_the_cpu_encode_is_checked(self, tmp_path):
        with pytest.raises(TranscodeError) as raised:
            self._encode(tmp_path, False, lambda *a, **k: None)
        assert raised.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED

    def test_an_empty_gpu_encode_falls_back_to_the_cpu(self, tmp_path):
        def run(cmd, **kwargs):
            if "libx264" in cmd:  # only the CPU encode writes its rung
                (tmp_path / "720p" / "index.m3u8").write_text("#EXTM3U\n")
                (tmp_path / "720p" / "stream.ts").write_bytes(b"\x47" * 188)

        run_ffmpeg = self._encode(tmp_path, True, run)
        assert run_ffmpeg.call_count == 2


class TestReportableMediaId:
    def test_a_uuid_is_sent(self):
        media_id = "550e8400-e29b-41d4-a716-446655440000"
        assert handler_module.reportable_media_id(media_id) == media_id

    @pytest.mark.parametrize(
        "value",
        [None, "", "test-media-123", "550e8400-e29b-01d4-a716-446655440000", 42],
    )
    def test_anything_the_service_would_refuse_is_null(self, value):
        assert handler_module.reportable_media_id(value) is None


class TestLoudness:
    def _run(self, stderr):
        return MagicMock(stderr=stderr, returncode=0)

    def test_a_measurement_is_returned(self):
        stderr = json.dumps(
            {"input_i": "-14.0", "input_tp": "-0.5", "input_lra": "5.0"}
        )
        with patch("subprocess.run", return_value=self._run(stderr)):
            assert handler_module.analyze_loudness("in.mp4") == {
                "input_i": -14.0,
                "input_tp": -0.5,
                "input_lra": 5.0,
            }

    def test_silence_is_clamped_not_dropped(self):
        stderr = json.dumps({"input_i": "-inf", "input_tp": "-inf", "input_lra": "0.0"})
        with patch("subprocess.run", return_value=self._run(stderr)):
            assert handler_module.analyze_loudness("in.mp4")["input_i"] == -70.0

    @pytest.mark.parametrize("stderr", ["", "no json here", '{"input_i": "-14.0"}'])
    def test_no_usable_measurement_is_none_not_invented(self, stderr):
        with patch("subprocess.run", return_value=self._run(stderr)):
            assert handler_module.analyze_loudness("in.mp4") is None

    def test_a_timeout_is_none_not_a_failed_job(self):
        with patch(
            "subprocess.run", side_effect=subprocess.TimeoutExpired(["ffmpeg"], 300)
        ):
            assert handler_module.analyze_loudness("in.mp4") is None
