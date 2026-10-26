"""Shared fixtures for the handler's unit tests.

The handler module is imported once, with `runpod` mocked so importing it never
starts the serverless loop.
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))
sys.modules.setdefault("runpod", MagicMock())


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
