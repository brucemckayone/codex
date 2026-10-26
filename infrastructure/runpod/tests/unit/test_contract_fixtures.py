"""The webhook bodies this handler sends, as committed JSON (Codex-l2c48.8).

tests/fixtures/contract/*.json are what the handler POSTs for real (mocked)
jobs. This test fails when the handler's output drifts from them; the
TypeScript side parses the same files with the service's own schemas
(packages/validation/src/schemas/__tests__/transcoding-contract.test.ts), so a
change one side would refuse fails a test on that side too.

After an intended change: UPDATE_CONTRACT_FIXTURES=1 pytest tests/unit, then
run the validation package's tests.
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from _jobs import CREATOR_ID, MEDIA_ID, job_input, run_job

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "contract"
UPDATE = os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1"

NONCE = "0f1e2d3c"


def _video(width, height, rotation=0):
    stream = {"codec_type": "video", "width": width, "height": height}
    if rotation:
        stream["side_data_list"] = [{"rotation": rotation}]
    return {
        "format": {"duration": "61.4"},
        "streams": [stream, {"codec_type": "audio", "codec_name": "aac"}],
    }


AUDIO = {"format": {"duration": "180.2"}, "streams": [{"codec_type": "audio"}]}


def _check(name: str, payload: dict) -> None:
    path = FIXTURES / f"{name}.json"
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if UPDATE:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return
    assert path.exists(), f"{path} missing: run with UPDATE_CONTRACT_FIXTURES=1"
    # Compared as data: the commit hook's biome reformats the file (it puts
    # a short array on one line), which must not read as a contract change.
    assert json.loads(path.read_text()) == json.loads(text), (
        f"{path.name} no longer matches what the handler sends. If the change is "
        "intended, re-run with UPDATE_CONTRACT_FIXTURES=1 and run the validation "
        "package's contract test."
    )


def _final(posts, status):
    [body] = [p for p in posts if p["status"] == status]
    return body


@pytest.fixture(autouse=True)
def fixed_nonce():
    with patch("secrets.token_hex", return_value=NONCE):
        yield


def test_completed_video_in_the_sized_layout():
    _, posts = run_job(
        job_input(contract=2), _video(1920, 1080, rotation=-90), job_id="job-sized"
    )
    _check("completed-video-sized", _final(posts, "completed"))
    _check("progress", posts[0])


def test_completed_video_in_the_flat_layout():
    _, posts = run_job(job_input(), _video(1920, 1080), job_id="job-flat")
    _check("completed-video-flat", _final(posts, "completed"))


def test_completed_audio():
    job = job_input(
        contract=2, type="audio", inputKey=f"{CREATOR_ID}/originals/{MEDIA_ID}/talk.m4a"
    )
    _, posts = run_job(job, AUDIO, job_id="job-audio")
    _check("completed-audio", _final(posts, "completed"))


def test_failed_unreadable_file():
    _, posts = run_job(
        job_input(contract=2),
        _video(1920, 1080),
        job_id="job-corrupt",
        fail_on="ffprobe",
        stderr="moov atom not found",
    )
    _check("failed-corrupt-input", _final(posts, "failed"))


def test_failed_with_no_reportable_media_id():
    job = job_input(contract=2, mediaId="not-a-uuid")
    del job["creatorId"]
    _, posts = run_job(job, _video(1920, 1080), job_id="job-broken")
    _check("failed-no-media-id", _final(posts, "failed"))
