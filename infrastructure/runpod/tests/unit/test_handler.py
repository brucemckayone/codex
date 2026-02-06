import os
import json
import pytest
from unittest.mock import MagicMock, patch

# Ensure handler is in python path
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

# Mock runpod before importing handler to prevent side-effects (like auto-starting worker)
sys.modules["runpod"] = MagicMock()
from handler import main as handler_module


@pytest.fixture
def mock_s3_client():
    with patch("handler.main.create_s3_client") as mock:
        client = MagicMock()
        mock.return_value = client
        yield mock


@pytest.fixture
def mock_upload_file():
    with patch("handler.main.upload_file") as mock:
        yield mock


@pytest.fixture
def mock_upload_directory():
    with patch("handler.main.upload_directory") as mock:
        yield mock


@pytest.fixture
def mock_download_file():
    with patch("handler.main.download_file") as mock:
        yield mock


@pytest.fixture
def mock_subprocess():
    with patch("subprocess.run") as mock:
        # Default mock response for success
        mock.return_value.returncode = 0
        mock.return_value.stdout = ""
        yield mock


@pytest.fixture
def mock_requests():
    with patch("requests.post") as mock:
        mock.return_value.status_code = 200
        yield mock


@pytest.fixture
def mock_check_gpu():
    with patch("handler.main.check_gpu_available", return_value=False) as mock:
        yield mock


@pytest.fixture
def mock_storage_env():
    """Set storage environment variables required by handler (B2, R2, ASSETS)."""
    with patch.dict(
        os.environ,
        {
            # B2 (Backblaze) for mezzanine archival
            "B2_ENDPOINT": "https://b2.example.com",
            "B2_ACCESS_KEY_ID": "test-key",
            "B2_SECRET_ACCESS_KEY": "test-secret",
            "B2_BUCKET_NAME": "archive-bucket",
            # R2 for HLS streaming outputs
            "R2_ENDPOINT": "https://r2.example.com",
            "R2_ACCESS_KEY_ID": "r2-key",
            "R2_SECRET_ACCESS_KEY": "r2-secret",
            "R2_BUCKET_NAME": "media-bucket",
            # ASSETS_BUCKET for public CDN thumbnails
            "ASSETS_R2_ENDPOINT": "https://assets.r2.example.com",
            "ASSETS_R2_ACCESS_KEY_ID": "assets-key",
            "ASSETS_R2_SECRET_ACCESS_KEY": "assets-secret",
            "ASSETS_BUCKET_NAME": "assets-bucket",
        },
    ):
        yield


@pytest.fixture
def basic_job_input():
    """Job input payload - credentials come from environment, not payload."""
    return {
        "mediaId": "test-media-123",
        "creatorId": "user-123",
        "type": "video",
        "inputKey": "originals/test/video.mp4",
        "webhookUrl": "https://api.example.com/webhook",
        "webhookSecret": "secret-123",
    }


def test_handler_video_flow_cpu(
    mock_s3_client,
    mock_download_file,
    mock_upload_file,
    mock_upload_directory,
    mock_subprocess,
    mock_requests,
    mock_check_gpu,
    mock_storage_env,
    basic_job_input,
):
    """Test full video transcoding flow in CPU mode (mocked)."""

    # Mock probe response
    probe_data = json.dumps(
        {
            "format": {"duration": "100.0"},
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }
    )

    # Mock ffmpeg/ffprobe calls
    def subprocess_side_effect(cmd, **kwargs):
        cmd_str = " ".join(cmd)
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = ""
        mock_res.stderr = ""  # Important: Must be string, not Mock

        if "ffprobe" in cmd:
            mock_res.stdout = probe_data
        elif "loudnorm" in cmd and "-f null" in cmd_str:
            # Mock loudness analysis stderr output
            mock_res.stderr = (
                '{"input_i": "-14.0", "input_tp": "-0.5", "input_lra": "5.0"}'
            )

        return mock_res

    mock_subprocess.side_effect = subprocess_side_effect

    # Mock os.path.getsize for thumbnail size logging
    with patch("os.path.getsize", return_value=5000):
        # Execute handler
        result = handler_module.handler({"input": basic_job_input})

        # Verifications
        assert result["status"] == "success"
        assert result["mediaId"] == "test-media-123"

        # Check S3 client creation (R2, B2, and ASSETS)
        assert mock_s3_client.call_count >= 3

        # Check steps
        # 1. Download
        mock_download_file.assert_called_once()

        # 2. Transcode Mezzanine (uploaded to B2)
        # 3. Transcode HLS (uploaded to R2)
        # 4. Upload HLS directory
        mock_upload_directory.assert_called()

        # 5. Webhook sent
        mock_requests.assert_called_once()
        call_args = mock_requests.call_args
        assert call_args[0][0] == basic_job_input["webhookUrl"]

        # Verify signature header
        headers = call_args[1]["headers"]
        assert "X-Runpod-Signature" in headers


def test_handler_audio_flow(
    mock_s3_client,
    mock_download_file,
    mock_upload_file,
    mock_upload_directory,
    mock_subprocess,
    mock_requests,
    mock_check_gpu,
    mock_storage_env,
    basic_job_input,
):
    """Test full audio transcoding flow."""
    basic_job_input["type"] = "audio"
    basic_job_input["inputKey"] = "originals/test/audio.mp3"

    # Mock probe response (audio only)
    probe_data = json.dumps(
        {"format": {"duration": "300.0"}, "streams": [{"codec_type": "audio"}]}
    )

    def subprocess_side_effect(cmd, **kwargs):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = ""
        mock_res.stderr = ""
        if "ffprobe" in cmd:
            mock_res.stdout = probe_data
        return mock_res

    mock_subprocess.side_effect = subprocess_side_effect

    result = handler_module.handler({"input": basic_job_input})

    assert result["status"] == "success"

    # Audio shouldn't trigger mezzanine video creation
    # But currently the code calls create_mezzanine only if media_type == 'video'
    # We can verify by checking what was uploaded

    # Verify waveform generation (audio only)
    # Check if audiowaveform command was called
    waveform_called = False
    for call in mock_subprocess.call_args_list:
        if "audiowaveform" in call[0][0]:
            waveform_called = True
            break
    assert waveform_called


def test_handler_failure_reporting(
    mock_s3_client,
    mock_download_file,
    mock_subprocess,
    mock_requests,
    mock_storage_env,
    basic_job_input,
):
    """Test that exceptions are caught and reported via webhook."""

    # Simulate download failure
    mock_download_file.side_effect = Exception("S3 Download Error")

    result = handler_module.handler({"input": basic_job_input})

    assert result["status"] == "error"
    assert "S3 Download Error" in result["error"]

    # Verify error webhook sent
    mock_requests.assert_called_once()
    payload = json.loads(mock_requests.call_args[1]["data"])
    assert payload["status"] == "failed"
    assert payload["error"] == "S3 Download Error"


def test_handler_timeout_protection(
    mock_s3_client,
    mock_download_file,
    mock_subprocess,
    mock_requests,
    mock_storage_env,
    basic_job_input,
):
    """Test that handler catches subprocess timeouts and reports failure."""
    import subprocess

    # Mock probe success first
    probe_data = json.dumps({"format": {"duration": "100.0"}})

    def side_effect(cmd, **kwargs):
        if "ffprobe" in cmd:
            m = MagicMock()
            m.returncode = 0
            m.stdout = probe_data
            return m
        # Simulate hang on transcoding
        raise subprocess.TimeoutExpired(cmd, 3600)

    mock_subprocess.side_effect = side_effect

    result = handler_module.handler({"input": basic_job_input})

    assert result["status"] == "error"
    assert "Command" in result["error"]
    assert "timed out" in result["error"]
