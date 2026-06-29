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

# =============================================================================
# Path Validation Tests
# =============================================================================


class TestValidatePathComponent:
    """Tests for validate_path_component() security function."""

    def test_valid_inputs(self):
        """Valid path components should pass without raising."""
        valid_inputs = [
            ("user123", "creatorId"),
            ("abc-def", "mediaId"),
            ("ABC_DEF", "creatorId"),
            ("a1b2c3", "mediaId"),
            ("550e8400-e29b-41d4-a716-446655440000", "mediaId"),  # UUID format
        ]
        for value, name in valid_inputs:
            # Should not raise
            handler_module.validate_path_component(value, name)

    def test_empty_value_rejected(self):
        """Empty values should be rejected."""
        with pytest.raises(ValueError, match="cannot be empty"):
            handler_module.validate_path_component("", "creatorId")

    def test_path_traversal_rejected(self):
        """Path traversal attempts should be rejected."""
        traversal_attempts = [
            "../../../etc/passwd",
            "user/../admin",
            "..\\windows\\system32",
            "foo//bar",
            "valid\\path",
        ]
        for attempt in traversal_attempts:
            with pytest.raises(ValueError, match="path traversal"):
                handler_module.validate_path_component(attempt, "testPath")

    def test_encoded_traversal_rejected(self):
        """URL-encoded path traversal should be rejected."""
        encoded_attempts = [
            "%2e%2e/admin",  # ../admin
            "%2E%2E/admin",  # ../admin (uppercase)
            "foo%2fbar",  # foo/bar
            "foo%5cbar",  # foo\bar
        ]
        for attempt in encoded_attempts:
            with pytest.raises(ValueError, match="encoded path traversal"):
                handler_module.validate_path_component(attempt, "testPath")

    def test_null_byte_rejected(self):
        """Null bytes should be rejected."""
        null_attempts = [
            "user\0admin",  # literal null
            "user%00admin",  # URL-encoded null
        ]
        for attempt in null_attempts:
            with pytest.raises(ValueError, match="null byte"):
                handler_module.validate_path_component(attempt, "testPath")

    def test_disallowed_characters_rejected(self):
        """Characters outside [a-zA-Z0-9_-] should be rejected."""
        invalid_chars = [
            "user@name",
            "user.name",
            "user name",
            "user/name",
            "user:name",
            "user;name",
            "user<name",
            "user>name",
        ]
        for attempt in invalid_chars:
            with pytest.raises(ValueError, match="disallowed characters"):
                handler_module.validate_path_component(attempt, "testPath")


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
def mock_upload_directory_tracked():
    # The handler uploads HLS output via upload_directory_tracked (returns the
    # list of (client, bucket, key) tuples used for failure cleanup).
    with patch("handler.main.upload_directory_tracked", return_value=[]) as mock:
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
    """Set environment variables required by handler (B2, R2, ASSETS, webhook)."""
    with patch.dict(
        os.environ,
        {
            # Webhook HMAC signing secret (read from env, not job payload)
            "WEBHOOK_SECRET": "secret-123",
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
            # Assets bucket uses shared R2 credentials
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
        "inputKey": "user-123/originals/test-media-123/video.mp4",
        "webhookUrl": "https://api.example.com/webhook",
        "webhookSecret": "secret-123",
    }


class TestHlsSingleFileCommands:
    """v1 ladder + single-file HLS command construction (Codex-bpjg5).

    Single-file HLS means each variant is ONE `stream.ts` addressed by
    #EXT-X-BYTERANGE, so the streaming proxy presigns ONE R2 URL per variant
    (O(1) CPU) instead of one-per-segment.
    """

    def test_v1_ladder_is_720_and_480_only(self):
        # 1080p and 360p dropped for v1 to cut R2 storage; two adaptive rungs kept.
        assert set(handler_module.HLS_VARIANTS.keys()) == {"720p", "480p"}

    @pytest.mark.parametrize("use_gpu", [True, False])
    def test_variant_cmd_is_single_file(self, use_gpu):
        cmd = handler_module._build_hls_variant_cmd(
            "in.mp4",
            "/out/720p",
            "/out/720p/index.m3u8",
            handler_module.HLS_VARIANTS["720p"],
            use_gpu=use_gpu,
        )
        # single_file flag present and immediately follows it with the value
        assert cmd[cmd.index("-hls_flags") + 1] == "single_file"
        # exactly one .ts file (no %03d sequence template)
        seg = cmd[cmd.index("-hls_segment_filename") + 1]
        assert seg.endswith("stream.ts")
        assert "%03d" not in seg

    @pytest.mark.parametrize("use_gpu", [True, False])
    def test_preview_cmd_is_single_file(self, use_gpu):
        cmd = handler_module._build_preview_cmd(
            "in.mp4", "/out/preview", 0, 30, use_gpu=use_gpu
        )
        assert cmd[cmd.index("-hls_flags") + 1] == "single_file"
        seg = cmd[cmd.index("-hls_segment_filename") + 1]
        assert seg.endswith("stream.ts")
        assert "%03d" not in seg


def test_handler_video_flow_cpu(
    mock_s3_client,
    mock_download_file,
    mock_upload_file,
    mock_upload_directory_tracked,
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
        mock_upload_directory_tracked.assert_called()

        # 5. Webhook sent — progress webhooks fire during the run, so the final
        # POST is the completion webhook.
        assert mock_requests.called
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
    basic_job_input["inputKey"] = "user-123/originals/test-media-123/audio.mp3"

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

    # Verify error webhook sent. A progress webhook fires before the download,
    # so the final POST is the failure report.
    assert mock_requests.called
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

    # Mock probe success first. Must include a video stream so the handler's
    # stream validation passes and we reach the (timing-out) transcode step.
    probe_data = json.dumps(
        {
            "format": {"duration": "100.0"},
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }
    )

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
