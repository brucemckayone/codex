"""Damaged sources: decoded past bad frames, failed when no picture is left.

Owner's choice 2026-10-26 (Codex-l2c48.8). Measured on prod's ffmpeg 4.4.2:
a source with over half its frames damaged already exits 0; what fails a
file is ffmpeg's error-rate check (exit 69 past 2/3 of ALL decoded frames),
which a 10 fps screen recording with a broken audio track crosses with every
video frame intact. And a source whose every video frame is undecodable exits
0 with the audio alone, which used to reach `ready` as a video without one.
tests/integration/verify_damaged_sources.py runs those files for real.
"""

import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest
from _jobs import PICTURE, video_cmds

from handler import main as handler_module
from handler.main import TOLERANT_DECODE, TranscodeError, TranscodeErrorCode

SETTINGS_720 = handler_module.HLS_VARIANTS["720p"]
SOUND_ONLY = {"codec_type": "audio", "codec_name": "aac"}


class TestEveryVideoDecodeIsTolerant:
    @pytest.mark.parametrize("use_gpu", [True, False], ids=["nvenc", "libx264"])
    @pytest.mark.parametrize("name", ["mezzanine", "variant", "preview"])
    def test_encodes(self, name, use_gpu):
        cmd = video_cmds(use_gpu)[name]
        start = cmd.index(TOLERANT_DECODE[0])
        assert cmd[start : start + 2] == ["-max_error_rate", "1.0"]
        # A global option: before the input, and before -hwaccel.
        assert start < cmd.index("-i")
        if use_gpu:
            assert start < cmd.index("-hwaccel")

    def test_posters(self, tmp_path):
        with patch("handler.main.run_ffmpeg") as run, patch(
            "handler.main.validate_output"
        ), patch("os.path.getsize", return_value=10):
            handler_module.extract_thumbnail_variants(
                "in.mov", str(tmp_path), 60, ["sm"]
            )
        cmd = run.call_args.args[0]
        assert cmd.index("-max_error_rate") < cmd.index("-ss") < cmd.index("-i")

    def test_not_audio_jobs_where_the_audio_is_the_content(self):
        cmd = handler_module._build_audio_hls_cmd(
            "in.m4a", "/out/128k", "/out/128k/index.m3u8", {"audio_bitrate": "128k"}
        )
        assert "-max_error_rate" not in cmd


class TestErrorRateExit:
    def _fail(self, returncode, stderr=""):
        failure = subprocess.CalledProcessError(returncode, ["ffmpeg"], stderr=stderr)
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(TranscodeError) as raised:
                handler_module.run_ffmpeg(["ffmpeg", "-i", "in.m4a"], description="x")
        return raised.value

    def test_exit_69_is_a_damaged_file(self):
        assert self._fail(69).code == TranscodeErrorCode.CORRUPT_INPUT

    def test_another_exit_is_still_judged_by_its_stderr(self):
        assert self._fail(1).code == TranscodeErrorCode.INFRA_ERROR
        assert (
            self._fail(1, "moov atom not found").code
            == TranscodeErrorCode.CORRUPT_INPUT
        )


class TestNoPicture:
    def _encode(self, tmp_path, use_gpu, rung_streams):
        """Encode 720p where every encode writes its rung, and ffprobe finds
        `rung_streams(cmd that wrote it)` in it."""
        variant_dir = tmp_path / "720p"
        variant_dir.mkdir()
        encodes = []

        def run(cmd, **kwargs):
            if cmd[0] == "ffprobe":
                return MagicMock(
                    stdout=json.dumps({"streams": rung_streams(encodes[-1])})
                )
            encodes.append(cmd)
            (variant_dir / "index.m3u8").write_text("#EXTM3U\n")
            (variant_dir / "stream.ts").write_bytes(b"\x47" * 188)
            return MagicMock(stdout="")

        with patch("handler.main.run_ffmpeg", side_effect=run):
            handler_module._encode_hls_variant(
                "in.mov",
                str(variant_dir),
                str(variant_dir / "index.m3u8"),
                SETTINGS_720,
                "720p",
                use_gpu,
            )
        return encodes

    def test_a_rung_without_a_picture_is_a_damaged_file(self, tmp_path):
        with pytest.raises(TranscodeError) as raised:
            self._encode(tmp_path, False, lambda cmd: [SOUND_ONLY])
        assert raised.value.code == TranscodeErrorCode.CORRUPT_INPUT
        assert "no picture" in str(raised.value)

    def test_a_rung_with_one_passes(self, tmp_path):
        assert (
            len(self._encode(tmp_path, False, lambda cmd: [PICTURE, SOUND_ONLY])) == 1
        )

    def test_a_gpu_rung_without_one_gets_the_cpu_first(self, tmp_path):
        encodes = self._encode(
            tmp_path,
            True,
            lambda cmd: [SOUND_ONLY] if "h264_nvenc" in cmd else [PICTURE, SOUND_ONLY],
        )
        assert ["h264_nvenc" in cmd for cmd in encodes] == [True, False]

    def test_audio_rungs_are_not_asked_for_one(self, tmp_path):
        with patch("handler.main.encoded_stream_tags") as tags:
            with patch("handler.main.validate_output"):
                handler_module._validate_hls_rung(
                    str(tmp_path), str(tmp_path / "index.m3u8"), "audio 128k"
                )
        tags.assert_not_called()
