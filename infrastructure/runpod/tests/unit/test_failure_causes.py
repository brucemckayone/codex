"""Every failure keeps its real cause (Codex-l2c48.8 REVIEW, silent failures).

- A damaged audio track prints "Invalid data found when processing input"
  once per concealed frame (376 times on 4.4.2) and the encode goes on; a
  later fatal error must be judged by the line that stopped ffmpeg.
- ffprobe says why it refused a file, and only a refusal is a damaged file.
- A hung encode is a coded failure, so the GPU path's CPU retry covers it.
- A full disk does not fail ffmpeg 4.4 (exit 0): a cut-short stream shows as
  a playlist that points past the end of its file.
- What the service's schema would refuse is caught before the encode.
- A webhook the service refuses is not sent again, and says why.
"""

import json
import re
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from _jobs import H264_720P, job_input, run_job

from handler import main as handler_module
from handler.main import TranscodeError, TranscodeErrorCode, classify_ffmpeg_failure

CONCEALED = (
    "Error while decoding stream #0:1: Invalid data found when processing input\n"
)


class TestTheFatalLineDecides:
    def test_a_signal_outranks_any_line(self):
        # Killed (OOM, a limit) part-way: the run was stopped, not refused,
        # whatever it printed last.
        stderr = (
            CONCEALED * 376 + "input.mov: Invalid data found when processing input\n"
        )
        assert classify_ffmpeg_failure(stderr, -9) == TranscodeErrorCode.INFRA_ERROR

    def test_concealed_frames_then_a_full_disk_is_ours(self):
        stderr = (
            CONCEALED * 376
            + "av_interleaved_write_frame(): No space left on device\n"
            + "Conversion failed!\n"
        )
        assert classify_ffmpeg_failure(stderr, 1) == TranscodeErrorCode.INFRA_ERROR

    def test_concealed_frames_then_another_fault_is_ours(self):
        stderr = CONCEALED * 376 + "Error writing trailer of out.ts: I/O error\n"
        assert classify_ffmpeg_failure(stderr, 1) == TranscodeErrorCode.INFRA_ERROR

    def test_an_unreadable_file_still_is(self):
        stderr = (
            "[mov,mp4,m4a,3gp,3g2,mj2 @ 0xaaab07c0bb30] moov atom not found\n"
            "input.mov: Invalid data found when processing input\n"
        )
        assert classify_ffmpeg_failure(stderr, 1) == TranscodeErrorCode.CORRUPT_INPUT


class TestProbe:
    def test_ffprobe_is_asked_for_its_errors(self):
        with patch("subprocess.run", return_value=MagicMock(stdout="{}")) as run:
            handler_module.probe_media("in.mov")
        cmd = run.call_args.args[0]
        assert cmd[cmd.index("-v") + 1] == "error"

    def test_a_refusal_is_a_damaged_file_with_its_reason(self):
        refusal = subprocess.CalledProcessError(
            1, ["ffprobe"], stderr="cut.mp4: something it could not parse\n"
        )
        with patch("subprocess.run", side_effect=refusal):
            with pytest.raises(TranscodeError) as raised:
                handler_module.probe_media("cut.mp4")
        assert raised.value.code == TranscodeErrorCode.CORRUPT_INPUT
        assert "something it could not parse" in str(raised.value)

    @pytest.mark.parametrize(
        "failure",
        [
            subprocess.CalledProcessError(-9, ["ffprobe"], stderr=""),
            subprocess.TimeoutExpired(["ffprobe"], 30),
        ],
        ids=["killed", "timed-out"],
    )
    def test_a_kill_or_a_timeout_is_ours(self, failure):
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(TranscodeError) as raised:
                handler_module.probe_media("in.mov")
        assert raised.value.code == TranscodeErrorCode.INFRA_ERROR


class TestTimeouts:
    def test_a_timed_out_run_is_coded_and_names_its_step(self):
        hang = subprocess.TimeoutExpired(["ffmpeg"], 3600, stderr=b"frame= 812\n")
        with patch("subprocess.run", side_effect=hang):
            with pytest.raises(TranscodeError) as raised:
                handler_module.run_ffmpeg(["ffmpeg"], 3600, "HLS 720p (GPU)")
        assert raised.value.code == TranscodeErrorCode.INFRA_ERROR
        assert "HLS 720p (GPU) timed out after 3600 s" in str(raised.value)
        assert "frame= 812" in str(raised.value)

    def test_a_hung_gpu_encode_gets_the_cpu(self):
        encodes = []

        def run(cmd, *args, **kwargs):
            encodes.append(cmd)
            if "h264_nvenc" in cmd:
                raise subprocess.TimeoutExpired(cmd, 3600)
            return MagicMock()

        with (
            patch("subprocess.run", side_effect=run),
            patch("handler.main.validate_output"),
        ):
            handler_module.create_mezzanine("in.mov", "out.mp4", use_gpu=True)
        assert ["h264_nvenc" in cmd for cmd in encodes] == [True, False]


class TestCutShortStreams:
    def _rung(self, tmp_path, stream_bytes, playlist):
        (tmp_path / "stream.ts").write_bytes(b"\x47" * stream_bytes)
        (tmp_path / "index.m3u8").write_text(playlist)
        handler_module._validate_hls_rung(
            str(tmp_path), str(tmp_path / "index.m3u8"), "HLS 720p"
        )

    PLAYLIST = (
        "#EXTM3U\n#EXTINF:6.0,\n#EXT-X-BYTERANGE:600@0\nstream.ts\n"
        "#EXTINF:4.0,\n#EXT-X-BYTERANGE:400@600\nstream.ts\n#EXT-X-ENDLIST\n"
    )

    def test_a_whole_stream_passes(self, tmp_path):
        self._rung(tmp_path, 1000, self.PLAYLIST)

    def test_a_stream_the_playlist_overruns_fails(self, tmp_path):
        with pytest.raises(TranscodeError) as raised:
            self._rung(tmp_path, 999, self.PLAYLIST)
        assert raised.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED
        assert "cut short" in str(raised.value)

    def test_a_range_without_an_offset_follows_the_last(self, tmp_path):
        playlist = "#EXTM3U\n#EXT-X-BYTERANGE:600@0\ns.ts\n#EXT-X-BYTERANGE:400\ns.ts\n"
        (tmp_path / "p.m3u8").write_text(playlist)
        assert handler_module.playlist_byte_end(str(tmp_path / "p.m3u8")) == 1000


class TestEncodedTags:
    def _tags(self, stdout):
        with patch("subprocess.run", return_value=MagicMock(stdout=stdout)):
            return handler_module.encoded_stream_tags("stream.ts")

    def test_a_video_codec_it_cannot_name_drops_codecs_entirely(self):
        # CODECS="mp4a.40.2" alone would advertise a video rung as audio-only.
        video = {**H264_720P, "profile": "High 4:4:4 Predictive"}
        streams = {"streams": [video, {"codec_type": "audio", "codec_name": "aac"}]}
        assert self._tags(json.dumps(streams)) == ("1280x720", None)

    def test_an_empty_answer_is_a_bad_output(self):
        with pytest.raises(TranscodeError) as raised:
            self._tags("")
        assert raised.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED


SERVICE_SCHEMAS = (
    Path(__file__).resolve().parents[4]
    / "packages/validation/src/schemas/transcoding.ts"
)


class TestWhatTheServiceAccepts:
    def test_the_limits_are_the_schemas(self):
        source = SERVICE_SCHEMAS.read_text()
        duration = re.search(
            r"durationSeconds: z\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)", source
        )
        width = re.search(
            r"width: z\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)", source
        )
        assert int(duration.group(1)) == handler_module.MAX_DURATION_SECONDS
        assert int(width.group(1)) == handler_module.MAX_REPORTED_DIMENSION

    def test_a_size_it_would_refuse_is_reported_as_unknown(self):
        assert handler_module.reportable_dimensions(8192, 1716) == (None, None)
        assert handler_module.reportable_dimensions(4320, 7680) == (4320, 7680)

    def test_a_day_long_source_fails_before_any_encode(self):
        probe = {
            "format": {"duration": "90000"},
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }
        result, posts = run_job(job_input(), probe)
        assert result["errorCode"] == TranscodeErrorCode.INVALID_DURATION
        assert not any(p.get("step") == "encoding_variants" for p in posts)

    def test_an_anamorphic_8k_completes_without_a_size(self):
        probe = {
            "format": {"duration": "60"},
            "streams": [
                {
                    "codec_type": "video",
                    "width": 4096,
                    "height": 1716,
                    "sample_aspect_ratio": "2:1",
                }
            ],
        }
        result, posts = run_job(job_input(contract=2), probe)
        assert result["status"] == "success", result
        output = posts[-1]["output"]
        assert (output["width"], output["height"]) == (None, None)


class TestDurationTheContainerOmits:
    def test_the_longest_stream_stands_in(self):
        probe = {
            "format": {},
            "streams": [
                {"codec_type": "video", "duration": "12.5"},
                {"codec_type": "audio", "duration": "13.1"},
            ],
        }
        assert handler_module.get_media_info(probe)[0] == 13

    def test_else_the_packets_are_measured(self):
        packets = "0.000000,0.033000\n5.974000,0.033000\n5.994000,0.020000\n"
        with patch("subprocess.run", return_value=MagicMock(stdout=packets)):
            assert handler_module.measure_duration("rec.webm") == 6

    def test_a_browser_recording_completes(self):
        """MediaRecorder WebM: no duration in the container or its streams."""
        probe = {
            "format": {},
            "streams": [{"codec_type": "video", "width": 1280, "height": 720}],
        }
        with patch("handler.main.measure_duration", return_value=42) as measured:
            result, posts = run_job(job_input(), probe)
        measured.assert_called_once()
        assert result["status"] == "success", result
        assert posts[-1]["output"]["durationSeconds"] == 42


class TestWebhookAnswers:
    def _send(self, *answers):
        with (
            patch("requests.post", side_effect=list(answers)) as post,
            patch("time.sleep"),
        ):
            try:
                handler_module.send_webhook("https://m.example/w", "s", {"a": 1})
                error = None
            except RuntimeError as e:
                error = str(e)
        return post.call_count, error

    @staticmethod
    def _answer(status, body="", payload=None):
        answer = MagicMock(status_code=status, ok=200 <= status < 300, text=body)
        answer.json.return_value = payload or {}
        return answer

    def test_a_refusal_is_sent_once(self, capsys):
        calls, error = self._send(self._answer(401, "bad signature"))
        assert calls == 1
        assert "401: bad signature" in error
        assert "WEBHOOK_SECRET" in capsys.readouterr().out

    @pytest.mark.parametrize("status", [500, 503, 429, 408])
    def test_a_passing_failure_is_retried(self, status):
        calls, error = self._send(*[self._answer(status)] * 3)
        assert calls == 3 and error is not None

    def test_a_network_drop_is_retried_then_delivered(self):
        calls, error = self._send(ConnectionError("reset"), self._answer(200))
        assert (calls, error) == (2, None)

    def test_a_rejected_result_is_said(self, capsys):
        answer = self._answer(200, payload={"received": True, "rejected": True})
        self._send(answer)
        assert "rejected the result" in capsys.readouterr().out


def test_a_missing_field_is_named():
    job = job_input()
    del job["inputKey"]
    result, _ = run_job(job, {"format": {"duration": "10"}, "streams": []})
    assert result["error"] == "Job input is missing 'inputKey'"
