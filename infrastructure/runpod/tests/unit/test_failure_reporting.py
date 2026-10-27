"""What the handler reports, and what it keeps, when a job goes wrong.

Codex-l2c48.8: the keep-alive ping is answered before input is read; every
failure after the webhook URL and secret check is reported with a code; and an
undeliverable completion keeps the outputs instead of deleting them.
"""

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from handler import main as handler_module

MEDIA_ID = "550e8400-e29b-41d4-a716-446655440000"

VIDEO_PROBE = json.dumps(
    {
        "format": {"duration": "100.0"},
        "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
    }
)


def _posts(mock_requests) -> list[dict]:
    return [json.loads(call.kwargs["data"]) for call in mock_requests.call_args_list]


def _final_report(mock_requests) -> dict:
    reports = [p for p in _posts(mock_requests) if p["status"] != "progress"]
    assert reports, "no completion or failure webhook was sent"
    return reports[-1]


def _ffmpeg(probe=VIDEO_PROBE, fail_on=None, stderr=""):
    """A subprocess.run stand-in: ffprobe answers `probe`; a command containing
    `fail_on` exits 1 with `stderr`; everything else succeeds."""
    import subprocess

    def run(cmd, **kwargs):
        if fail_on is not None and fail_on in " ".join(cmd):
            raise subprocess.CalledProcessError(1, cmd, stderr=stderr)
        done = MagicMock(returncode=0, stdout="", stderr="")
        if "ffprobe" in cmd:
            done.stdout = probe
        return done

    return run


@pytest.fixture
def uuid_job(basic_job_input):
    basic_job_input["mediaId"] = MEDIA_ID
    basic_job_input["inputKey"] = f"user-123/originals/{MEDIA_ID}/video.mov"
    return basic_job_input


class TestPing:
    def test_answered_before_anything_is_read(self, mock_requests, mock_subprocess):
        # No webhook URL, no environment, no media fields: none of it is needed.
        with patch.dict(os.environ, {}, clear=True):
            result = handler_module.handler(
                {"id": "ping-1", "input": {"ping": True, "contract": 2}}
            )
        assert result == {"status": "pong"}
        mock_requests.assert_not_called()
        mock_subprocess.assert_not_called()

    def test_only_a_true_ping_is_a_ping(
        self,
        mock_requests,
        mock_subprocess,
        mock_check_gpu,
        mock_storage_env,
        basic_job_input,
    ):
        basic_job_input["ping"] = "yes"
        with (
            patch("handler.main.create_s3_client"),
            patch("handler.main.download_file"),
        ):
            result = handler_module.handler({"input": basic_job_input})
        assert result != {"status": "pong"}
        assert mock_requests.called  # it ran as a job and reported


class TestNobodyToTell:
    def test_an_unsafe_webhook_url_raises_and_posts_nothing(
        self, mock_requests, mock_storage_env, basic_job_input
    ):
        basic_job_input["webhookUrl"] = "http://169.254.169.254/latest"
        with pytest.raises(ValueError, match="internal address"):
            handler_module.handler({"input": basic_job_input})
        mock_requests.assert_not_called()

    def test_a_missing_secret_raises_and_posts_nothing(
        self, mock_requests, basic_job_input
    ):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="WEBHOOK_SECRET"):
                handler_module.handler({"input": basic_job_input})
        mock_requests.assert_not_called()


class TestEarlyFailuresAreReported:
    @pytest.mark.parametrize(
        "unset,named",
        [
            ("B2_BUCKET_NAME", "B2 credentials"),
            ("R2_ENDPOINT", "R2 credentials"),
            ("ASSETS_BUCKET_NAME", "ASSETS_BUCKET_NAME"),
        ],
    )
    def test_each_missing_storage_setting(
        self, mock_requests, mock_storage_env, basic_job_input, unset, named
    ):
        del os.environ[unset]  # mock_storage_env restores the environment
        result = handler_module.handler({"input": basic_job_input})
        assert result["status"] == "error"
        report = _final_report(mock_requests)
        assert report["status"] == "failed"
        assert report["errorCode"] == "INFRA_ERROR"
        assert named in report["error"]

    def test_a_job_missing_a_field(
        self, mock_requests, mock_storage_env, basic_job_input
    ):
        del basic_job_input["creatorId"]
        handler_module.handler({"id": "job-7", "input": basic_job_input})
        report = _final_report(mock_requests)
        assert report == {
            "jobId": "job-7",
            "status": "failed",
            "error": "Job input is missing 'creatorId'",
            "errorCode": "INFRA_ERROR",
            "mediaId": None,  # test-media-123 is no UUID: the service would refuse it
            "creatorId": None,
        }

    def test_a_real_media_id_is_reported(
        self, mock_requests, mock_storage_env, uuid_job
    ):
        uuid_job["type"] = "image"
        handler_module.handler({"id": "job-8", "input": uuid_job})
        assert _final_report(mock_requests)["mediaId"] == MEDIA_ID


class TestCodes:
    def _run(self, job, run):
        with (
            patch("handler.main.create_s3_client"),
            patch("handler.main.download_file"),
            patch("handler.main.check_gpu_available", return_value=False),
            patch("subprocess.run", side_effect=run),
        ):
            return handler_module.handler({"id": "job-9", "input": job})

    def test_a_file_ffprobe_cannot_read(
        self, mock_requests, mock_storage_env, uuid_job
    ):
        result = self._run(
            uuid_job, _ffmpeg(fail_on="ffprobe", stderr="moov atom not found")
        )
        assert result["errorCode"] == "CORRUPT_INPUT"
        assert _final_report(mock_requests)["errorCode"] == "CORRUPT_INPUT"

    def test_no_duration(self, mock_requests, mock_storage_env, uuid_job):
        probe = json.dumps({"format": {}, "streams": [{"codec_type": "video"}]})
        self._run(uuid_job, _ffmpeg(probe=probe))
        assert _final_report(mock_requests)["errorCode"] == "INVALID_DURATION"

    def test_no_video_stream(self, mock_requests, mock_storage_env, uuid_job):
        probe = json.dumps(
            {"format": {"duration": "9"}, "streams": [{"codec_type": "audio"}]}
        )
        self._run(uuid_job, _ffmpeg(probe=probe))
        assert _final_report(mock_requests)["errorCode"] == "MISSING_STREAM"

    def test_a_codec_with_no_decoder(self, mock_requests, mock_storage_env, uuid_job):
        stderr = "Decoder (codec av1) not found for input stream #0:0"
        self._run(uuid_job, _ffmpeg(fail_on="-hls_time", stderr=stderr))
        assert _final_report(mock_requests)["errorCode"] == "UNSUPPORTED_CODEC"

    def test_an_encode_that_leaves_nothing(
        self, mock_requests, mock_storage_env, uuid_job
    ):
        # Every ffmpeg run "succeeds" but, mocked, writes no file.
        self._run(uuid_job, _ffmpeg())
        assert _final_report(mock_requests)["errorCode"] == "OUTPUT_VALIDATION_FAILED"


class TestUndeliverableCompletion:
    def test_keeps_the_outputs_and_reports_no_failure(self, mock_storage_env, uuid_job):
        def post(url, data, headers, timeout):
            if json.loads(data)["status"] == "completed":
                raise ConnectionError("media-api unreachable")
            return MagicMock(status_code=200)

        with (
            patch("handler.main.create_s3_client"),
            patch("handler.main.download_file"),
            patch("handler.main.upload_file"),
            patch(
                "handler.main.upload_directory_tracked", return_value=[("c", "b", "k")]
            ),
            patch("handler.main.check_gpu_available", return_value=False),
            patch("handler.main.cleanup_uploaded_keys") as cleanup,
            patch("subprocess.run", side_effect=_ffmpeg()),
            patch("os.path.getsize", return_value=5000),
            patch("time.sleep"),
            patch("requests.post", side_effect=post) as requests_post,
        ):
            result = handler_module.handler({"id": "job-10", "input": uuid_job})

        assert result["status"] == "webhook_undelivered"
        assert result["mediaId"] == MEDIA_ID
        cleanup.assert_not_called()
        statuses = [
            json.loads(c.kwargs["data"])["status"] for c in requests_post.call_args_list
        ]
        assert "failed" not in statuses
        assert statuses.count("completed") == 3  # send_webhook's three attempts

    def test_a_failure_before_completion_still_cleans_up(
        self, mock_requests, mock_storage_env, uuid_job
    ):
        with (
            patch("handler.main.create_s3_client"),
            patch("handler.main.download_file"),
            patch("handler.main.upload_file"),
            patch(
                "handler.main.upload_directory_tracked", return_value=[("c", "b", "k")]
            ),
            patch("handler.main.check_gpu_available", return_value=False),
            patch("handler.main.cleanup_uploaded_keys") as cleanup,
            patch(
                "handler.main.extract_thumbnail_variants",
                side_effect=RuntimeError("disk full"),
            ),
            patch("subprocess.run", side_effect=_ffmpeg()),
            patch("os.path.getsize", return_value=5000),
        ):
            handler_module.handler({"id": "job-11", "input": uuid_job})

        cleanup.assert_called_once()
        assert _final_report(mock_requests)["status"] == "failed"
