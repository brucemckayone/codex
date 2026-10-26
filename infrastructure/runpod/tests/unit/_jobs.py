"""Run the whole handler with every external effect mocked.

ffprobe answers `probe` for the source and `encoded_rung` for an encoded
stream.ts (a video job's rungs hold a picture); every other command succeeds
and writes nothing (the handler's output checks see a 5000-byte file), except
that a command given `-progress` gets one line: the source's full duration,
as ffmpeg's last report would be. Storage calls are mocks; each webhook POST
is captured as parsed JSON.
"""

import json
import subprocess
from typing import Any
from unittest.mock import MagicMock, patch

from handler import main as handler_module

STORAGE_ENV = {
    "WEBHOOK_SECRET": "secret-123",
    "B2_ENDPOINT": "https://b2.example.com",
    "B2_ACCESS_KEY_ID": "test-key",
    "B2_SECRET_ACCESS_KEY": "test-secret",
    "B2_BUCKET_NAME": "archive-bucket",
    "R2_ENDPOINT": "https://r2.example.com",
    "R2_ACCESS_KEY_ID": "r2-key",
    "R2_SECRET_ACCESS_KEY": "r2-secret",
    "R2_BUCKET_NAME": "media-bucket",
    "ASSETS_BUCKET_NAME": "assets-bucket",
}

LOUDNESS_STDERR = '{"input_i": "-14.0", "input_tp": "-0.5", "input_lra": "5.0"}'

MEDIA_ID = "550e8400-e29b-41d4-a716-446655440000"
# A real user id's shape (userIdSchema: letters and digits), so the echo shows.
CREATOR_ID = "k9Xq2LmVt7RzP4wN"
# What ffprobe says of an encoded rung that holds a picture.
PICTURE = {"codec_type": "video", "width": 1280, "height": 720}


def job_input(**fields: Any) -> dict[str, Any]:
    """A video job's input from CREATOR_ID for MEDIA_ID; `fields` override."""
    return {
        "mediaId": MEDIA_ID,
        "creatorId": CREATOR_ID,
        "type": "video",
        "inputKey": f"{CREATOR_ID}/originals/{MEDIA_ID}/clip.mov",
        "webhookUrl": "https://media-api.example.com/api/transcoding/webhook",
        **fields,
    }


def video_cmds(use_gpu: bool) -> dict[str, list[str]]:
    """The three video builders' commands for a 720p rung's settings."""
    settings = handler_module.HLS_VARIANTS["720p"]
    return {
        "mezzanine": handler_module._build_mezzanine_cmd("in.mov", "out.mp4", use_gpu),
        "variant": handler_module._build_hls_variant_cmd(
            "in.mov", "/out/720p", "/out/720p/index.m3u8", settings, use_gpu
        ),
        "preview": handler_module._build_preview_cmd(
            "in.mov", "/out/preview", 3, 30, use_gpu
        ),
    }


AAC = {"codec_type": "audio", "codec_name": "aac"}
H264_720P = {
    "codec_type": "video",
    "codec_name": "h264",
    "profile": "High",
    "level": 31,
    "width": 1280,
    "height": 720,
}


def encoded_rung(probe: dict[str, Any]) -> dict[str, Any]:
    """What ffprobe says of a rung encoded from `probe`'s source."""
    has_video = any(s.get("codec_type") == "video" for s in probe.get("streams", []))
    return {"streams": [H264_720P, AAC] if has_video else [AAC]}


def run_job(
    job_input: dict[str, Any],
    probe: dict[str, Any],
    job_id: str = "job-1",
    fail_on: str | None = None,
    stderr: str = "",
    gpu: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(the handler's return value, every webhook body it POSTed in order).

    A command containing `fail_on` exits 1 with `stderr`. With `gpu`, the
    handler finds a GPU, so every encode takes the NVENC path.
    """

    def run(cmd, **kwargs):
        if fail_on is not None and fail_on in " ".join(cmd):
            raise subprocess.CalledProcessError(1, cmd, stderr=stderr)
        done = MagicMock(returncode=0, stdout="", stderr="")
        if "-progress" in cmd:
            seconds = float(probe.get("format", {}).get("duration") or 0)
            with open(cmd[cmd.index("-progress") + 1], "w") as progress:
                progress.write(f"out_time_us={int(seconds * 1_000_000)}\n")
        if "ffprobe" in cmd and cmd[-1].endswith("stream.ts"):
            done.stdout = json.dumps(encoded_rung(probe))
        elif "ffprobe" in cmd:
            done.stdout = json.dumps(probe)
        elif "print_format=json" in " ".join(cmd):
            done.stderr = LOUDNESS_STDERR
        return done

    posts: list[dict[str, Any]] = []

    def post(url, data, **kwargs):
        posts.append(json.loads(data))
        return MagicMock(status_code=200)

    with (
        patch.dict("os.environ", STORAGE_ENV, clear=True),
        patch("handler.main.create_s3_client"),
        patch("handler.main.download_file"),
        patch("handler.main.upload_file"),
        patch("handler.main.upload_directory_tracked", return_value=[]),
        patch("handler.main.check_gpu_available", return_value=gpu),
        patch("subprocess.run", side_effect=run),
        patch("os.path.getsize", return_value=5000),
        patch("requests.post", side_effect=post),
    ):
        result = handler_module.handler({"id": job_id, "input": job_input})
    return result, posts
