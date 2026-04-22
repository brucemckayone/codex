"""End-to-end integration tests for the transcoding handler.

These tests exercise the ACTUAL handler pipeline with real ffmpeg against real
fixture media, mocking only the network boundaries (R2/B2 upload, webhook
delivery). This is what catches regressions in the resilience flags, error
classification, and output validation under realistic conditions.

Unlike the unit tests, these run real encodes — expect each scenario to take
5-30 seconds. They are the only tests that would have caught the 2026-04-17
exit-69 incident end-to-end.

Run from repo root:
    cd infrastructure/runpod && .venv/bin/pytest tests/integration/test_resilient_decode.py -v

Fixtures are checked in at tests/fixtures/ — see tests/fixtures/README.md.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("runpod", MagicMock())

from handler import main as handler_module  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

# Every fixture we rely on — guard with skip_if_missing in each test.
FIXTURE_HEALTHY = FIXTURES / "healthy_short.mp4"
FIXTURE_TRUNCATED = FIXTURES / "truncated.mp4"
FIXTURE_CORRUPT_AAC = FIXTURES / "corrupt_aac.mp4"
FIXTURE_AUDIO_ONLY = FIXTURES / "audio_only.m4a"
FIXTURE_UNPARSEABLE = FIXTURES / "unparseable.bin"


def _require_fixture(path: Path) -> Path:
    if not path.exists():
        pytest.skip(
            f"Fixture not available at {path} — run regen commands in tests/fixtures/README.md"
        )
    return path


class _FakeS3Client:
    """Minimal boto3-like stub that serves the fixture file on download and
    captures uploads for assertions."""

    def __init__(self, local_source: Path | None = None) -> None:
        self.local_source = local_source
        self.uploaded: list[tuple[str, str, str]] = []  # (bucket, key, local_path)
        self.deleted: list[tuple[str, str]] = []

    def download_file(self, bucket: str, key: str, local_path: str) -> None:
        if self.local_source is None:
            raise RuntimeError(
                "FakeS3Client has no local_source; can't service download_file"
            )
        # Preserve the fixture extension so ffmpeg auto-detects format.
        import shutil

        shutil.copy(self.local_source, local_path)

    def upload_file(
        self, local_path: str, bucket: str, key: str, ExtraArgs: dict | None = None
    ) -> None:
        self.uploaded.append((bucket, key, local_path))

    def delete_object(self, Bucket: str, Key: str) -> None:
        self.deleted.append((Bucket, Key))


@pytest.fixture
def storage_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set every env var the handler checks at startup."""
    monkeypatch.setenv("B2_ENDPOINT", "https://fake-b2.example.com")
    monkeypatch.setenv("B2_ACCESS_KEY_ID", "fake-b2-key")
    monkeypatch.setenv("B2_SECRET_ACCESS_KEY", "fake-b2-secret")
    monkeypatch.setenv("B2_BUCKET_NAME", "fake-b2-bucket")
    monkeypatch.setenv("R2_ENDPOINT", "https://fake-r2.example.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "fake-r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "fake-r2-secret")
    monkeypatch.setenv("R2_BUCKET_NAME", "fake-r2-bucket")
    monkeypatch.setenv("ASSETS_BUCKET_NAME", "fake-assets-bucket")
    monkeypatch.setenv("WEBHOOK_SECRET", "fake-webhook-secret")


def _make_job(media_id: str, media_type: str, ext: str) -> dict:
    return {
        "id": f"job-{media_id}",
        "input": {
            "mediaId": media_id,
            "creatorId": "creator-abc",
            "type": media_type,
            "inputKey": f"creator-abc/originals/{media_id}/source{ext}",
            "webhookUrl": "https://api.example.com/api/transcoding/webhook",
        },
    }


def _run_handler_with_fixture(
    fixture_path: Path, media_type: str
) -> tuple[dict, list, list, list]:
    """Invoke the handler against a fixture. Returns (result, upload calls,
    webhook completion payloads, progress payloads)."""
    fake_clients: list[_FakeS3Client] = []

    def make_client(endpoint: str, access_key: str, secret_key: str):
        client = _FakeS3Client(local_source=fixture_path)
        fake_clients.append(client)
        return client

    webhook_calls: list[dict] = []
    progress_calls: list[dict] = []

    def fake_send_webhook(url: str, secret: str, payload: dict) -> None:
        webhook_calls.append(payload)

    def fake_send_progress(
        url: str, secret: str, job_id: str, step: str, percent: int, media_id: str = ""
    ) -> None:
        progress_calls.append(
            {"step": step, "percent": percent, "mediaId": media_id, "jobId": job_id}
        )

    job = _make_job(
        media_id="11111111-2222-3333-4444-555555555555",
        media_type=media_type,
        ext=fixture_path.suffix,
    )

    with patch.object(handler_module, "create_s3_client", make_client), patch.object(
        handler_module, "send_webhook", fake_send_webhook
    ), patch.object(handler_module, "send_progress", fake_send_progress), patch.object(
        handler_module, "check_gpu_available", return_value=False
    ):
        result = handler_module.handler(job)

    return result, fake_clients, webhook_calls, progress_calls


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_healthy_video_produces_all_outputs(self, storage_env):
        _require_fixture(FIXTURE_HEALTHY)
        result, clients, webhooks, _ = _run_handler_with_fixture(
            FIXTURE_HEALTHY, "video"
        )

        assert result["status"] == "success"
        # One completion webhook (progress is mocked out; we're asserting final)
        completion = [w for w in webhooks if w.get("status") == "completed"]
        assert len(completion) == 1
        output = completion[0]["output"]
        assert output["readyVariants"]  # at least one variant
        assert output["hlsMasterKey"]
        assert output["mezzanineKey"]  # video path produces mezzanine
        assert output["thumbnailKey"]

    def test_audio_only_fixture(self, storage_env):
        _require_fixture(FIXTURE_AUDIO_ONLY)
        if shutil.which("audiowaveform") is None:
            pytest.skip(
                "audiowaveform not installed locally — available in the "
                "RunPod Docker image via the apt ppa:chris-needham/ppa. "
                "Run this test inside the container for full coverage."
            )
        result, _, webhooks, _ = _run_handler_with_fixture(FIXTURE_AUDIO_ONLY, "audio")
        assert result["status"] == "success"
        completion = [w for w in webhooks if w.get("status") == "completed"][0]
        output = completion["output"]
        assert output["waveformKey"]
        assert output["waveformImageKey"]
        assert output["mezzanineKey"] is None  # audio path skips mezzanine


class TestResilientDecode:
    """These are the regression tests for the 2026-04-17 incident."""

    def test_truncated_file_completes(self, storage_env):
        """Before A1: exit 69, job thrown away.
        After A1: job completes; outputs playable up to the truncation point."""
        _require_fixture(FIXTURE_TRUNCATED)
        result, _, webhooks, _ = _run_handler_with_fixture(FIXTURE_TRUNCATED, "video")
        assert result["status"] == "success", (
            f"Truncated file should complete with resilience flags, "
            f"got result={result}, webhooks={webhooks}"
        )
        completion = [w for w in webhooks if w.get("status") == "completed"]
        assert len(completion) == 1

    def test_corrupt_aac_completes(self, storage_env):
        _require_fixture(FIXTURE_CORRUPT_AAC)
        result, _, webhooks, _ = _run_handler_with_fixture(FIXTURE_CORRUPT_AAC, "video")
        assert result["status"] == "success"
        completion = [w for w in webhooks if w.get("status") == "completed"]
        assert len(completion) == 1


class TestPermanentFailures:
    def test_unparseable_bin_fails_with_corrupt_input(self, storage_env):
        """Preflight must reject catastrophic input FAST with CORRUPT_INPUT."""
        _require_fixture(FIXTURE_UNPARSEABLE)
        result, _, webhooks, _ = _run_handler_with_fixture(FIXTURE_UNPARSEABLE, "video")
        assert result["status"] == "error"
        assert result["errorCode"] in (
            handler_module.TranscodeErrorCode.CORRUPT_INPUT,
            # probe_media failing first with a generic error is also acceptable
            # — either way, we never reach mezzanine.
            handler_module.TranscodeErrorCode.INFRA_ERROR,
        )
        # Webhook should carry errorCode for the TS side to classify
        failure = [w for w in webhooks if w.get("status") == "failed"]
        assert len(failure) == 1
        assert "errorCode" in failure[0]

    def test_output_validation_catches_zero_byte_mezzanine(
        self, storage_env, tmp_path: Path
    ):
        """Simulate FFmpeg silently producing an empty mezzanine.
        Output validation must raise OUTPUT_VALIDATION_FAILED, preventing
        the garbage file from being uploaded."""
        _require_fixture(FIXTURE_HEALTHY)

        fake_clients: list[_FakeS3Client] = []

        def make_client(endpoint: str, access_key: str, secret_key: str):
            c = _FakeS3Client(local_source=FIXTURE_HEALTHY)
            fake_clients.append(c)
            return c

        webhook_calls: list[dict] = []

        # Override create_mezzanine to produce an empty file — simulates
        # the "ffmpeg exited 0 but something went wrong" scenario.
        original_create = handler_module.create_mezzanine

        def broken_create_mezzanine(
            input_path: str, output_path: str, use_gpu: bool
        ) -> None:
            # Write < MIN_OUTPUT_BYTES so validate_output rejects it.
            with open(output_path, "wb") as f:
                f.write(b"x" * 10)
            # The real create_mezzanine calls validate_output; our replacement
            # doesn't, so call it explicitly to simulate the guard firing.
            handler_module.validate_output(output_path, "mezzanine (CPU)")

        with patch.object(
            handler_module, "create_s3_client", make_client
        ), patch.object(
            handler_module, "send_webhook", lambda u, s, p: webhook_calls.append(p)
        ), patch.object(
            handler_module, "send_progress", lambda *a, **k: None
        ), patch.object(
            handler_module, "check_gpu_available", return_value=False
        ), patch.object(
            handler_module, "create_mezzanine", broken_create_mezzanine
        ):
            result = handler_module.handler(
                _make_job(
                    media_id="22222222-3333-4444-5555-666666666666",
                    media_type="video",
                    ext=".mp4",
                )
            )

        assert result["status"] == "error"
        assert (
            result["errorCode"]
            == handler_module.TranscodeErrorCode.OUTPUT_VALIDATION_FAILED
        )
        failure = [w for w in webhook_calls if w.get("status") == "failed"]
        assert len(failure) == 1
        assert failure[0]["errorCode"] == "OUTPUT_VALIDATION_FAILED"
