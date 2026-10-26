"""
RunPod Transcoding Handler

GPU-accelerated media transcoding pipeline for video and audio files.

Pipeline:
1. Download original from R2
2. Probe metadata (ffprobe)
3. Create mezzanine (CRF 18) → Upload to B2
4. Two-pass loudness analysis
5. Transcode HLS variants (1080p/720p/480p/360p + source fallback)
6. Generate preview (30s at 720p)
7. Extract thumbnail (10% mark)
8. Generate waveform JSON + PNG (audio only)
9. Upload outputs to R2
10. Send signed webhook (with retry)

FFmpeg Settings:
- GPU: h264_nvenc, preset p4, cq 23
- CPU fallback: libx264, preset fast, crf 23
- HLS: 6s segments, VOD playlist type
- Audio: loudnorm I=-16 TP=-1.5 LRA=11
"""

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable, TypedDict
from urllib.parse import urlparse

import boto3
import requests
import runpod

# =============================================================================
# Feature Flags
# =============================================================================


def _env_flag(name: str, default: bool) -> bool:
    """Parse a boolean env var. Unset → default; common truthy strings → True."""
    value = os.environ.get(name, "").strip().lower()
    if value == "":
        return default
    return value in ("true", "1", "yes", "on")


# Pipeline feature toggles. Defaults match current production behavior except
# mezzanine, which stays off until a consumer is wired up — the B2 upload
# doubles per-job GPU time for no current beneficiary.
FEATURES = {
    "mezzanine": _env_flag("ENABLE_MEZZANINE", default=False),
    "loudness_analysis": _env_flag("ENABLE_LOUDNESS_ANALYSIS", default=True),
    "waveform_image": _env_flag("ENABLE_WAVEFORM_IMAGE", default=True),
    "video_preview": _env_flag("ENABLE_VIDEO_PREVIEW", default=True),
}


# =============================================================================
# Error Codes
# =============================================================================


class TranscodeErrorCode:
    """Why a job failed: the failure webhook's `errorCode`.

    The service believes only these six (JOB_ERROR_CODES in
    packages/constants/src/transcoding.ts; test_error_codes.py reads that file)
    and files anything else as INFRA_ERROR. Which codes are worth a retry is
    the service's decision, not the handler's.
    """

    CORRUPT_INPUT = "CORRUPT_INPUT"
    UNSUPPORTED_CODEC = "UNSUPPORTED_CODEC"
    INVALID_DURATION = "INVALID_DURATION"
    MISSING_STREAM = "MISSING_STREAM"
    OUTPUT_VALIDATION_FAILED = "OUTPUT_VALIDATION_FAILED"
    INFRA_ERROR = "INFRA_ERROR"


class TranscodeError(RuntimeError):
    """A failure that knows its code.

    A RuntimeError, so the GPU → CPU fallbacks (which catch RuntimeError) still
    try the CPU before giving up.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def error_code_of(error: BaseException) -> str:
    """The code to report: a TranscodeError's own, else INFRA_ERROR."""
    if isinstance(error, TranscodeError):
        return error.code
    return TranscodeErrorCode.INFRA_ERROR


# ffmpeg's wording when the bytes can't be read. Anything it says that is not
# listed here (or the decoder line below) is treated as our problem.
_CORRUPT_INPUT_MARKERS = (
    "Invalid data found when processing input",
    "moov atom not found",
)
_MISSING_DECODER = re.compile(r"Decoder \(codec [^)]*\) not found|Unknown decoder")


# ffmpeg's exit status when more of the decoded frames failed than
# -max_error_rate allows (2/3 unless TOLERANT_DECODE): the input is damaged.
# Each failed frame usually also prints "Invalid data found when processing
# input" (376 times for a broken AAC file on 4.4.2), so the marker below
# agrees; the status covers a decoder that fails with other words.
FFMPEG_ERROR_RATE_EXIT = 69


# ffmpeg ends on the line that stopped it. Earlier lines can be frames it
# concealed and moved past (TOLERANT_DECODE prints "Invalid data found ..."
# for each), which must not turn a later disk or memory failure into a
# damaged file the creator cannot retry.
_FATAL_TAIL_LINES = 5
_OUT_OF_RESOURCES = ("No space left on device", "Cannot allocate memory")
# A frame that failed to decode, as ffmpeg reports it; never the line that
# stopped it (tolerated, or past the error rate, which is exit 69).
_FRAME_ERROR = "Error while decoding stream"


def classify_ffmpeg_failure(stderr: str, returncode: int | None = None) -> str:
    """Map a failed ffmpeg/ffprobe run's last lines (and exit status) to a code."""
    if returncode is not None and returncode < 0:
        return TranscodeErrorCode.INFRA_ERROR  # killed by a signal: OOM, a limit
    if returncode == FFMPEG_ERROR_RATE_EXIT:
        return TranscodeErrorCode.CORRUPT_INPUT
    lines = [line for line in stderr.strip().splitlines() if _FRAME_ERROR not in line]
    tail = "\n".join(lines[-_FATAL_TAIL_LINES:])
    if any(marker in tail for marker in _OUT_OF_RESOURCES):
        return TranscodeErrorCode.INFRA_ERROR
    if _MISSING_DECODER.search(tail):
        return TranscodeErrorCode.UNSUPPORTED_CODEC
    if any(marker in tail for marker in _CORRUPT_INPUT_MARKERS):
        return TranscodeErrorCode.CORRUPT_INPUT
    return TranscodeErrorCode.INFRA_ERROR


def validate_output(path: str, what: str) -> None:
    """An encoder that exits 0 but leaves nothing behind has still failed."""
    try:
        size = os.path.getsize(path)
    except OSError:
        size = 0
    if size <= 0:
        raise TranscodeError(
            TranscodeErrorCode.OUTPUT_VALIDATION_FAILED,
            f"{what} is missing or empty: {os.path.basename(path)}",
        )


# Matches the service's uuidSchema (Zod's RFC 9562 check: a version digit and
# a variant nibble). A failure report carrying anything else as mediaId fails
# the service's schema, so it is sent as null instead.
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def reportable_media_id(value: Any) -> str | None:
    """`value` if the service would accept it as a mediaId, else None."""
    if isinstance(value, str) and _UUID.match(value):
        return value
    return None


# The service's userIdSchema (packages/validation/src/primitives.ts), which is
# stricter than validate_path_component: no `_` or `-`.
_USER_ID = re.compile(r"^[a-zA-Z0-9]{1,64}$")


def reportable_creator_id(value: Any) -> str | None:
    """`value` if the service would accept it as a creatorId, else None.

    Every webhook echoes it, so the service can route a report to the
    creator's live status without reading the database (Codex-l2c48.9).
    """
    if isinstance(value, str) and _USER_ID.match(value):
        return value
    return None


# =============================================================================
# Type Definitions
# =============================================================================


class JobInput(TypedDict):
    """Input payload from RunPod job trigger.

    SECURITY: Both B2 and R2 credentials are read from environment variables
    (via RunPod secrets) instead of job payload to avoid logging credentials.
    Credentials are never passed in job payloads.
    """

    mediaId: str
    creatorId: str
    type: str  # 'video' | 'audio'
    inputKey: str  # R2 key for original file
    webhookUrl: str
    # NOTE: webhookSecret comes from env, NOT job payload (security)
    # NOTE: Both B2 and R2 credentials come from environment variables, not job payload


class WebhookOutput(TypedDict):
    """Output payload matching runpodWebhookOutputSchema in TypeScript."""

    mediaId: str
    type: str  # 'video' | 'audio'
    hlsMasterKey: str | None
    hlsPreviewKey: str | None
    thumbnailKey: str | None  # The 'lg' poster
    # sm/md/lg/xl in the sized layout (contract >= 2); sm/md/lg in the flat one
    thumbnailVariants: dict[str, str] | None
    waveformKey: str | None
    waveformImageKey: str | None
    mezzanineKey: str | None
    durationSeconds: int
    width: int | None
    height: int | None
    readyVariants: list[str]
    loudnessIntegrated: int | None
    loudnessPeak: int | None
    loudnessRange: int | None


# =============================================================================
# FFmpeg Configuration
# =============================================================================

# HLS variant settings (resolution → bitrate).
# v1 ladder (Codex-bpjg5, decided 2026-06-29): 720p + 480p only — 1080p and 360p
# are dropped to cut R2 storage / Class-B ops while keeping two adaptive rungs.
# Re-adding rungs later is a config-only change affecting future uploads.
HLS_VARIANTS = {
    "720p": {"height": 720, "video_bitrate": "3000k", "audio_bitrate": "128k"},
    "480p": {"height": 480, "video_bitrate": "1500k", "audio_bitrate": "96k"},
}

# Audio-only HLS variants
AUDIO_VARIANTS = {
    "128k": {"audio_bitrate": "128k"},
    "64k": {"audio_bitrate": "64k"},
}

# Preview clip settings
PREVIEW_DURATION = 30  # seconds
PREVIEW_HEIGHT = 720

# Segment duration for HLS
HLS_SEGMENT_DURATION = 6

# Browsers play H.264 High at 8-bit 4:2:0 only. Without this, an iPhone HEVC
# 10-bit clip, a ProRes 4:2:2 or a 4:4:4 source comes out as High 10 / High
# 4:2:2 / High 4:4:4: `ready`, yet unplayable (checked on prod's ffmpeg 4.4.2).
# It is a CPU filter; with `-hwaccel cuda` and no `-hwaccel_output_format`, the
# decoded frames are in system memory, so it works on the NVENC path too.
VIDEO_PIXEL_FORMAT = "format=yuv420p"
VIDEO_PROFILE = ["-profile:v", "high"]

# loudnorm works at 192 kHz, and the AAC encoder keeps the highest rate it
# supports (96 kHz came out). Every audio output is pinned to 48 kHz.
AUDIO_SAMPLE_RATE = ["-ar", "48000"]

# EBU R128-style levelling on every audio output (its stats are analyze_loudness).
LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"

# Square the pixels before any scale, so an anamorphic source keeps the shape
# it is shown at.
SQUARE_PIXELS = "scale='trunc(iw*sar/2)*2':ih,setsar=1"


def _filters(*parts: str | None) -> str:
    """A -vf chain from its parts, leaving out an absent one (an SDR source's
    tone-map)."""
    return ",".join(part for part in parts if part)


def _audio_codec(bitrate: str) -> list[str]:
    """AAC at `bitrate`, pinned to 48 kHz."""
    return ["-c:a", "aac", "-b:a", bitrate, *AUDIO_SAMPLE_RATE]


# A video job is encoded past damaged frames (owner's choice, 2026-10-26).
# ffmpeg already conceals a bad frame and carries on; what fails the file is
# its error-rate check, exit 69 once 2/3 of ALL decoded frames failed, audio
# included. A 10 fps screen recording with a broken audio track crosses that
# with every video frame intact (checked on 4.4.2). A picture that cannot be
# decoded at all is still caught, by _validate_hls_rung. Audio jobs keep the
# check: there the audio is the content.
TOLERANT_DECODE = ["-max_error_rate", "1.0"]

# iPhones record HLG HDR by default, and editors hand over PQ. Browsers here
# show SDR, and an HDR picture squeezed into 8-bit H.264 still tagged HDR
# looks washed out, so it is tone-mapped to BT.709. Which operator is judged
# on a real iPhone clip (owner's choice, 2026-10-26); hable until then.
HDR_TRANSFERS = ("smpte2084", "arib-std-b67")
TONEMAP_OPERATOR = "hable"
# What zscale can take as the source's primaries and matrix (ffprobe's names).
_ZSCALE_PRIMARIES = ("bt709", "bt2020", "smpte431", "smpte432")
_ZSCALE_MATRICES = ("bt709", "bt2020nc", "bt2020c")


def first_video_stream(probe_data: dict[str, Any]) -> dict[str, Any] | None:
    """The source's picture: its first video stream, if it has one."""
    return next(
        (s for s in probe_data.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )


def tonemap_filter(probe_data: dict[str, Any]) -> str | None:
    """The filters that bring an HDR (PQ or HLG) picture to SDR BT.709, or
    None when the first video stream is SDR.

    The source's transfer, primaries and matrix are given to zscale outright
    rather than read from each frame. The encoder is tagged BT.709 by the
    frames this leaves (checked on 4.4.2), so no output option is needed.
    """
    video = first_video_stream(probe_data) or {}
    transfer = video.get("color_transfer")
    if transfer not in HDR_TRANSFERS:
        return None
    primaries = video.get("color_primaries")
    if primaries not in _ZSCALE_PRIMARIES:
        primaries = "bt2020"
    matrix = video.get("color_space")
    if matrix not in _ZSCALE_MATRICES:
        matrix = "bt2020nc"
    return (
        f"zscale=tin={transfer}:pin={primaries}:min={matrix}:t=linear:npl=100,"
        "format=gbrpf32le,zscale=p=bt709,"
        f"tonemap=tonemap={TONEMAP_OPERATOR}:desat=0,"
        "zscale=t=bt709:m=bt709:r=tv"
    )


def ladder_filter(short_side: int, tonemap: str | None = None) -> str:
    """The -vf of every video encode: square the pixels, scale the picture's
    SHORT side to `short_side`, tone-map an HDR source, then 8-bit 4:2:0.

    A rung's name is its short side, so a portrait 720p is 720x1280, not the
    406x720 that `scale=-2:720` made. ffmpeg autorotates before this chain
    runs, so iw/ih are already upright here. The callers never pass a
    short_side above the source's, so nothing is upscaled. Tone-mapping runs
    in float after the scale, at the rung's size: about 2.5x the plain
    encode's time for 1080p -> 720p, against far more at the source's.
    """
    return _filters(
        SQUARE_PIXELS,
        f"scale='if(gte(iw,ih),-2,{short_side})':'if(gte(iw,ih),{short_side},-2)'",
        tonemap,
        VIDEO_PIXEL_FORMAT,
    )


def even_floor(value: int) -> int:
    """H.264 4:2:0 needs even dimensions."""
    return max(2, value - value % 2)


# =============================================================================
# FFmpeg Helper
# =============================================================================


def run_ffmpeg(
    cmd: list[str],
    timeout: int = 3600,
    description: str = "ffmpeg",
    on_seconds: Callable[[float], None] | None = None,
) -> subprocess.CompletedProcess:
    """Run an ffmpeg/ffprobe command with proper error capture.

    On failure, raises TranscodeError with the last 2KB of stderr so the actual
    ffmpeg error message is preserved for debugging, coded from the whole of it.

    With `on_seconds`, ffmpeg also writes `-progress` to a file, and each new
    position it reports there (seconds of output so far) is passed on while
    the command runs.
    """
    if on_seconds is None:
        return _run_ffmpeg(cmd, timeout, description)
    with tempfile.TemporaryDirectory(prefix="ffmpeg_progress_") as progress_dir:
        progress_path = os.path.join(progress_dir, "progress")
        done = threading.Event()
        watcher = threading.Thread(
            target=_follow_progress,
            args=(progress_path, on_seconds, done),
            daemon=True,
        )
        watcher.start()
        try:
            return _run_ffmpeg(
                [cmd[0], "-progress", progress_path, "-nostats", *cmd[1:]],
                timeout,
                description,
            )
        finally:
            done.set()
            watcher.join()


def _run_ffmpeg(
    cmd: list[str], timeout: int, description: str
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd, check=True, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.CalledProcessError as e:
        stderr = e.stderr or ""
        raise TranscodeError(
            classify_ffmpeg_failure(stderr, e.returncode),
            f"{description} failed (exit {e.returncode}): {stderr[-2000:]}",
        ) from e
    except subprocess.TimeoutExpired as e:
        # Captured output is bytes here whatever `text` says.
        partial = e.stderr or b""
        tail = (
            partial.decode(errors="replace") if isinstance(partial, bytes) else partial
        )
        raise TranscodeError(
            TranscodeErrorCode.INFRA_ERROR,
            f"{description} timed out after {timeout} s: {tail[-1000:]}",
        ) from e


PROGRESS_POLL_SECONDS = 1.0


def _follow_progress(
    path: str, on_seconds: Callable[[float], None], done: threading.Event
) -> None:
    """Each poll, pass on the latest `out_time_us` ffmpeg has appended to
    `path` if it moved forward; after `done`, poll once more so the last
    position is never missed."""
    offset = 0
    reported = -1.0
    while True:
        finished = done.wait(PROGRESS_POLL_SECONDS)
        try:
            with open(path, "rb") as progress:
                progress.seek(offset)
                chunk = progress.read()
        except OSError:  # ffmpeg has not opened it yet
            chunk = b""
        # Only whole lines: ffmpeg may be part-way through writing one.
        complete = chunk[: chunk.rfind(b"\n") + 1]
        offset += len(complete)
        positions = [
            int(value)
            for key, _, value in (
                line.partition("=")
                for line in complete.decode(errors="replace").splitlines()
            )
            if key == "out_time_us" and value.isdigit()
        ]
        if positions and max(positions) / 1_000_000 > reported:
            reported = max(positions) / 1_000_000
            on_seconds(reported)
        if finished:
            return


# =============================================================================
# Storage Clients
# =============================================================================


def create_s3_client(endpoint: str, access_key: str, secret_key: str) -> Any:
    """Create S3-compatible client for R2 or B2."""
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def download_file(client: Any, bucket: str, key: str, local_path: str) -> None:
    """Download file from S3-compatible storage."""
    print(f"Downloading s3://{bucket}/{key} → {local_path}")
    client.download_file(bucket, key, local_path)


def upload_file(
    client: Any, bucket: str, key: str, local_path: str, content_type: str | None = None
) -> None:
    """Upload file to S3-compatible storage."""
    print(f"Uploading {local_path} → s3://{bucket}/{key}")
    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type
    client.upload_file(
        local_path, bucket, key, ExtraArgs=extra_args if extra_args else None
    )


def upload_directory_tracked(
    client: Any, bucket: str, key_prefix: str, local_dir: str
) -> list[tuple[Any, str, str]]:
    """Upload all files in a directory and return list of (client, bucket, key) for cleanup."""
    uploaded: list[tuple[Any, str, str]] = []
    for root, _, files in os.walk(local_dir):
        for filename in files:
            local_path = os.path.join(root, filename)
            relative_path = os.path.relpath(local_path, local_dir)
            key = f"{key_prefix}{relative_path}"

            content_type = None
            if filename.endswith(".m3u8"):
                content_type = "application/vnd.apple.mpegurl"
            elif filename.endswith(".ts"):
                content_type = "video/MP2T"
            elif filename.endswith(".json"):
                content_type = "application/json"
            elif filename.endswith(".png"):
                content_type = "image/png"
            elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
                content_type = "image/jpeg"

            upload_file(client, bucket, key, local_path, content_type)
            uploaded.append((client, bucket, key))
    return uploaded


def cleanup_uploaded_keys(uploaded_keys: list[tuple[Any, str, str]]) -> None:
    """Best-effort cleanup of uploaded files on error."""
    for client, bucket, key in uploaded_keys:
        try:
            client.delete_object(Bucket=bucket, Key=key)
            print(f"Cleaned up s3://{bucket}/{key}")
        except Exception as err:
            print(f"Failed to clean up s3://{bucket}/{key}: {err}")


# =============================================================================
# Input Validation
# =============================================================================


def validate_path_component(value: str, name: str) -> None:
    """Validate a single path component (no slashes allowed)."""
    if not value:
        raise ValueError(f"{name} cannot be empty")

    if ".." in value or "//" in value or "\\" in value:
        raise ValueError(f"Invalid {name}: path traversal detected")

    if "%2e" in value.lower() or "%2f" in value.lower() or "%5c" in value.lower():
        raise ValueError(f"Invalid {name}: encoded path traversal detected")

    if "\0" in value or "%00" in value:
        raise ValueError(f"Invalid {name}: null byte detected")

    if not re.match(r"^[a-zA-Z0-9_-]+$", value):
        raise ValueError(f"Invalid {name}: contains disallowed characters")


def validate_input_key(key: str) -> None:
    """Validate an R2 input key (full path with slashes).

    Expected format: {creatorId}/{folder}/{mediaId}/{filename}
    Must have at least 4 segments, no traversal, no null bytes.
    """
    if not key:
        raise ValueError("inputKey cannot be empty")

    if ".." in key or "//" in key or "\\" in key:
        raise ValueError("Invalid inputKey: path traversal detected")

    if "%2e" in key.lower() or "%2f" in key.lower() or "%5c" in key.lower():
        raise ValueError("Invalid inputKey: encoded path traversal detected")

    if "\0" in key or "%00" in key:
        raise ValueError("Invalid inputKey: null byte detected")

    if key.startswith("/"):
        raise ValueError("Invalid inputKey: must not start with /")

    segments = key.split("/")
    if len(segments) < 4:
        raise ValueError(
            f"Invalid inputKey: expected at least 4 path segments, got {len(segments)}"
        )


def validate_webhook_url(url: str) -> None:
    """Validate webhook URL to prevent SSRF attacks.

    Blocks internal IPs in production. Allows host.docker.internal in dev.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid webhook URL scheme: {parsed.scheme}")
    if not parsed.hostname:
        raise ValueError("Webhook URL has no hostname")

    hostname = parsed.hostname
    env_mode = os.environ.get("ENVIRONMENT", "production")

    if env_mode == "production":
        blocked_prefixes = (
            "127.",
            "10.",
            "172.16.",
            "172.17.",
            "172.18.",
            "172.19.",
            "172.20.",
            "172.21.",
            "172.22.",
            "172.23.",
            "172.24.",
            "172.25.",
            "172.26.",
            "172.27.",
            "172.28.",
            "172.29.",
            "172.30.",
            "172.31.",
            "192.168.",
            "169.254.",
        )
        if hostname == "localhost" or any(
            hostname.startswith(p) for p in blocked_prefixes
        ):
            raise ValueError(f"Webhook URL points to internal address: {hostname}")


# =============================================================================
# Media Analysis
# =============================================================================


def probe_media(input_path: str) -> dict[str, Any]:
    """Get media metadata using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    try:
        result = run_ffmpeg(cmd, timeout=30, description="ffprobe")
    except TranscodeError as e:
        # ffprobe needs no decoders, so a file it refuses (exit > 0) is
        # unreadable. A kill or a timeout is ours.
        refused = isinstance(e.__cause__, subprocess.CalledProcessError) and (
            e.__cause__.returncode > 0
        )
        if e.code == TranscodeErrorCode.INFRA_ERROR and refused:
            raise TranscodeError(TranscodeErrorCode.CORRUPT_INPUT, str(e)) from e
        raise
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise TranscodeError(
            TranscodeErrorCode.CORRUPT_INPUT, f"ffprobe output is not JSON: {e}"
        ) from e


def get_media_info(probe_data: dict[str, Any]) -> tuple[int, int | None, int | None]:
    """Extract duration, width, height from probe data.

    A duration ffprobe can't state ("N/A", absent) comes back as 0, which the
    handler reports as INVALID_DURATION.
    """
    durations = [probe_data.get("format", {}).get("duration")] + [
        stream.get("duration") for stream in probe_data.get("streams", [])
    ]
    duration = 0
    for value in durations:  # the container's, else the longest stream's
        try:
            duration = max(duration, int(float(value)))
        except (TypeError, ValueError):
            continue
        if value is durations[0]:
            break

    video = first_video_stream(probe_data)
    width, height = display_dimensions(video) if video else (None, None)
    return duration, width, height


def measure_duration(input_path: str) -> int:
    """Seconds of media, from the last packet's end: for a file whose
    container states no duration (a browser's MediaRecorder WebM). Demuxes
    only, decodes nothing. 0 when there are no packets."""
    out = run_ffmpeg(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "packet=pts_time,duration_time",
            "-of",
            "csv=p=0",
            input_path,
        ],
        timeout=300,
        description="ffprobe packets",
    ).stdout
    end = 0.0
    for line in (out or "").splitlines():
        pts, _, length = line.partition(",")
        try:
            end = max(end, float(pts) + (float(length) if length else 0.0))
        except ValueError:
            continue
    return int(end)


# What the service's completed-webhook schema accepts (runpodWebhookOutputSchema
# in packages/validation/src/schemas/transcoding.ts; test_encode_settings
# reads it). A source outside them is caught before it is encoded, not after.
MAX_DURATION_SECONDS = 86400
MAX_REPORTED_DIMENSION = 7680


def reportable_dimensions(
    width: int | None, height: int | None
) -> tuple[int | None, int | None]:
    """(width, height) if the service would accept them, else (None, None):
    an anamorphic 4096x1716 squares to 8192 wide, and the size is optional."""
    if width and height and 1 <= max(width, height) <= MAX_REPORTED_DIMENSION:
        return width, height
    return None, None


def _ratio(value: Any) -> tuple[int, int] | None:
    """'8:9' → (8, 9); None for '0:1', 'N/A' or anything unusable."""
    try:
        num, den = (int(part) for part in str(value).split(":"))
    except (TypeError, ValueError):
        return None
    return (num, den) if num > 0 and den > 0 else None


def _rotation_degrees(stream: dict[str, Any]) -> int:
    """The display rotation ffprobe reports: a display-matrix side data entry
    (iPhone clips; ffmpeg 4.4 prints it as `rotation`), else the legacy
    `rotate` tag."""
    for side_data in stream.get("side_data_list") or []:
        if "rotation" in side_data:
            try:
                return int(float(side_data["rotation"]))
            except (TypeError, ValueError):
                break
    try:
        return int((stream.get("tags") or {}).get("rotate", 0))
    except (TypeError, ValueError):
        return 0


def display_dimensions(stream: dict[str, Any]) -> tuple[int | None, int | None]:
    """The picture's size as it is shown: square pixels, upright.

    A portrait iPhone clip is stored 1920x1080 with a 90° display matrix and
    is reported 1080x1920. Every encode autorotates and ladder_filter squares
    the pixels, so this is also the shape every rung keeps.
    """
    width, height = stream.get("width"), stream.get("height")
    if not width or not height:
        return width, height
    sar = _ratio(stream.get("sample_aspect_ratio"))
    if sar is not None and sar[0] != sar[1]:
        width = round(width * sar[0] / sar[1])
    if _rotation_degrees(stream) % 180 != 0:
        width, height = height, width
    return width, height


def validate_streams(probe_data: dict[str, Any], media_type: str) -> None:
    """Verify the file actually contains the expected stream types."""
    streams = probe_data.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    if media_type == "video" and not has_video:
        raise TranscodeError(
            TranscodeErrorCode.MISSING_STREAM,
            "File declared as video but contains no video streams",
        )
    if media_type == "audio" and not has_audio:
        raise TranscodeError(
            TranscodeErrorCode.MISSING_STREAM,
            "File declared as audio but contains no audio streams",
        )


def check_gpu_available() -> bool:
    """Check if NVIDIA GPU encoder is actually usable (not just listed)."""
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=16x16:d=0.1",
                "-c:v",
                "h264_nvenc",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


# =============================================================================
# Transcoding Functions
# =============================================================================


def _input_args(
    input_path: str, use_gpu: bool, seek_seconds: int | None = None
) -> list[str]:
    """How a video job opens its source: tolerant of damaged frames, decoded
    on the GPU when there is one, optionally from `seek_seconds`."""
    return [
        *TOLERANT_DECODE,
        *(["-hwaccel", "cuda"] if use_gpu else []),
        *(["-ss", str(seek_seconds)] if seek_seconds is not None else []),
        "-i",
        input_path,
    ]


def _video_codec(use_gpu: bool, quality: int, cpu_preset: str) -> list[str]:
    """NVENC at constant quality `quality`, or libx264 at CRF `quality`."""
    if use_gpu:
        return [
            "-c:v",
            "h264_nvenc",
            *VIDEO_PROFILE,
            "-preset",
            "p4",
            "-cq",
            str(quality),
        ]
    return [
        "-c:v",
        "libx264",
        *VIDEO_PROFILE,
        "-preset",
        cpu_preset,
        "-crf",
        str(quality),
    ]


def _hls_output(segment_path: str, playlist_path: str) -> list[str]:
    """VOD HLS in one file: every segment is a byte range of `segment_path`
    (see _build_hls_variant_cmd)."""
    return [
        "-f",
        "hls",
        "-hls_time",
        str(HLS_SEGMENT_DURATION),
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "single_file",
        "-hls_segment_filename",
        segment_path,
        playlist_path,
    ]


def _encode_with_fallback(
    use_gpu: bool,
    build: Callable[[bool], list[str]],
    check: Callable[[], None],
    what: str,
    timeout: int,
    on_seconds: Callable[[float], None] | None = None,
) -> None:
    """Run `build(True)` and `check()` its output; when either fails (an
    NVENC fault, or an output that fails its check) the CPU gets a try with
    `build(False)`, whose failure is the job's."""
    if use_gpu:
        try:
            run_ffmpeg(
                build(True),
                timeout=timeout,
                description=f"{what} (GPU)",
                on_seconds=on_seconds,
            )
            check()
            return
        except RuntimeError as e:
            print(f"GPU {what} failed, falling back to CPU: {e}")

    run_ffmpeg(
        build(False),
        timeout=timeout,
        description=f"{what} (CPU)",
        on_seconds=on_seconds,
    )
    check()


def _build_mezzanine_cmd(
    input_path: str, output_path: str, use_gpu: bool, tonemap: str | None = None
) -> list[str]:
    """Build ffmpeg command for mezzanine creation."""
    return [
        "ffmpeg",
        "-y",
        *_input_args(input_path, use_gpu),
        "-vf",
        _filters(tonemap, VIDEO_PIXEL_FORMAT),
        *_video_codec(use_gpu, 18, cpu_preset="slow"),
        *_audio_codec("256k"),
        output_path,
    ]


def create_mezzanine(
    input_path: str, output_path: str, use_gpu: bool, tonemap: str | None = None
) -> None:
    """Create high-quality mezzanine file (CRF 18 for archival).

    Falls back to CPU if GPU encoding fails (e.g. OOM).
    """
    print("Creating mezzanine (CRF 18)...")
    _encode_with_fallback(
        use_gpu,
        lambda gpu: _build_mezzanine_cmd(input_path, output_path, gpu, tonemap),
        lambda: validate_output(output_path, "mezzanine"),
        "mezzanine",
        timeout=3600,
    )


def analyze_loudness(input_path: str) -> dict[str, float] | None:
    """Two-pass loudness analysis using loudnorm filter.

    Returns None when ffmpeg gives no usable measurement, so the job reports
    no loudness rather than made-up figures. The numbers are statistics only
    (never fed to the encoder), so their absence never fails the job.
    """
    print("Analyzing audio loudness...")

    # Audio only: without -vn the null output decodes every video frame too
    # (12x slower on a 4K HEVC source), enough to reach the timeout below.
    cmd = [
        "ffmpeg",
        "-i",
        input_path,
        "-vn",
        "-sn",
        "-dn",
        "-af",
        f"{LOUDNORM}:print_format=json",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        print("WARNING: Loudness analysis timed out; reporting none")
        return None

    # Parse loudnorm output from stderr
    output = result.stderr or ""
    json_start = output.rfind("{")
    json_end = output.rfind("}") + 1
    try:
        if json_start >= 0 and json_end > json_start:
            loudness_data = json.loads(output[json_start:json_end])
            measured = {
                key: float(loudness_data[key])
                for key in ("input_i", "input_tp", "input_lra")
            }
            # A silent track measures -inf: no loudness, not a made-up one.
            if all(math.isfinite(value) for value in measured.values()):
                return measured
            print("Loudness: the audio is silent; reporting none")
            return None
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        pass

    print(
        f"WARNING: No loudness data (ffmpeg exit {result.returncode}): "
        f"{output[-300:]}; reporting none"
    )
    return None


def _build_hls_variant_cmd(
    input_path: str,
    variant_dir: str,
    playlist_path: str,
    settings: dict,
    use_gpu: bool,
    tonemap: str | None = None,
) -> list[str]:
    """Build ffmpeg command for a single HLS variant.

    Uses `-hls_flags single_file`: all segments are stored in ONE MPEG-TS file
    (`stream.ts`) addressed by #EXT-X-BYTERANGE in the playlist. The streaming
    proxy then presigns ONE R2 URL per variant regardless of duration, keeping
    it under the Workers Free 10ms CPU budget (Codex-bpjg5).
    """
    return [
        "ffmpeg",
        "-y",
        *_input_args(input_path, use_gpu),
        "-vf",
        ladder_filter(settings["height"], tonemap),
        *_video_codec(use_gpu, 23, cpu_preset="fast"),
        "-b:v",
        settings["video_bitrate"],
        "-maxrate",
        settings["video_bitrate"],
        "-bufsize",
        f"{int(settings['video_bitrate'][:-1]) * 2}k",
        *_audio_codec(settings["audio_bitrate"]),
        "-af",
        LOUDNORM,
        *_hls_output(os.path.join(variant_dir, "stream.ts"), playlist_path),
    ]


def _encode_hls_variant(
    input_path: str,
    variant_dir: str,
    playlist_path: str,
    settings: dict,
    variant_name: str,
    use_gpu: bool,
    tonemap: str | None = None,
    on_seconds: Callable[[float], None] | None = None,
) -> None:
    """Encode a single HLS variant with GPU → CPU fallback."""
    _encode_with_fallback(
        use_gpu,
        lambda gpu: _build_hls_variant_cmd(
            input_path, variant_dir, playlist_path, settings, gpu, tonemap
        ),
        lambda: _validate_hls_rung(
            variant_dir, playlist_path, f"HLS {variant_name}", picture=True
        ),
        f"HLS {variant_name}",
        timeout=3600,
        on_seconds=on_seconds,
    )


def _validate_hls_rung(
    variant_dir: str, playlist_path: str, what: str, picture: bool = False
) -> None:
    """A single-file HLS rung is its playlist plus one stream.ts; both must exist.

    With `picture`, the stream must also hold video. A source whose every
    video frame is undecodable still exits 0 with the audio alone (an HEVC
    file with scrambled video, on 4.4.2), so this is where a video that
    "can't be read at all" fails: as CORRUPT_INPUT, since nothing in the
    source can be shown. On the GPU path the CPU gets a try first.
    """
    validate_output(playlist_path, f"{what} playlist")
    stream_path = os.path.join(variant_dir, "stream.ts")
    validate_output(stream_path, f"{what} stream")
    # A full disk does not fail ffmpeg 4.4 (exit 0), so a truncated stream.ts
    # shows only here: its playlist points past the end of the file.
    needed = playlist_byte_end(playlist_path)
    if needed is not None and needed > os.path.getsize(stream_path):
        raise TranscodeError(
            TranscodeErrorCode.OUTPUT_VALIDATION_FAILED,
            f"{what} stream is cut short: the playlist needs {needed} bytes",
        )
    if picture and encoded_stream_tags(stream_path)[0] is None:
        raise TranscodeError(
            TranscodeErrorCode.CORRUPT_INPUT,
            f"{what}: no picture could be decoded from the source",
        )


def playlist_byte_end(playlist_path: str) -> int | None:
    """Where a single-file playlist's last #EXT-X-BYTERANGE ends, or None
    when it has none (or cannot be read). A range without `@offset` starts
    where the one before ended (RFC 8216 4.3.2.2)."""
    end = None
    try:
        with open(playlist_path) as playlist:
            for line in playlist:
                if not line.startswith("#EXT-X-BYTERANGE:"):
                    continue
                spec = line[len("#EXT-X-BYTERANGE:") :].strip()
                length, _, offset = spec.partition("@")
                start = int(offset) if offset else (end or 0)
                end = start + int(length)
    except (OSError, ValueError):
        return None
    return end


# H.264 profile_idc and constraint byte, for an RFC 6381 `avc1.PPCCLL` string.
_AVC_PROFILES = {
    "High": (0x64, 0x00),
    "Main": (0x4D, 0x40),
    "Constrained Baseline": (0x42, 0xE0),
    "Baseline": (0x42, 0x00),
}
AAC_LC_CODEC = "mp4a.40.2"


def peak_bandwidth(playlist_path: str) -> int | None:
    """A rung's peak bits/s: each single-file segment is an #EXTINF duration
    and an #EXT-X-BYTERANGE length. Segments under a second (a clip's tail)
    are skipped unless they are all there is. None if nothing can be read."""
    rates: list[tuple[float, int]] = []
    duration: float | None = None
    try:
        with open(playlist_path) as playlist:
            for line in playlist:
                line = line.strip()
                if line.startswith("#EXTINF:"):
                    try:
                        duration = float(line[len("#EXTINF:") :].split(",")[0])
                    except ValueError:
                        duration = None
                elif line.startswith("#EXT-X-BYTERANGE:") and duration:
                    length = int(line[len("#EXT-X-BYTERANGE:") :].split("@")[0])
                    rates.append((duration, math.ceil(length * 8 / duration)))
                    duration = None
    except (OSError, ValueError):
        return None
    if not rates:
        return None
    full = [rate for seconds, rate in rates if seconds >= 1.0]
    return max(full or [rate for _, rate in rates])


def encoded_stream_tags(stream_path: str) -> tuple[str | None, str | None]:
    """RESOLUTION and CODECS for a rung, read back from what was encoded.

    An output ffprobe can't read is a bad output (OUTPUT_VALIDATION_FAILED).
    """
    try:
        probe = json.loads(
            run_ffmpeg(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-print_format",
                    "json",
                    "-show_streams",
                    stream_path,
                ],
                timeout=30,
                description="ffprobe output",
            ).stdout
        )
    except (TranscodeError, json.JSONDecodeError, TypeError) as e:
        raise TranscodeError(
            TranscodeErrorCode.OUTPUT_VALIDATION_FAILED,
            f"encoded stream unreadable: {e}",
        ) from e

    resolution = None
    codecs: list[str] = []
    video_codec_known = True
    for stream in probe.get("streams", []):
        if stream.get("codec_type") == "video" and resolution is None:
            if stream.get("width") and stream.get("height"):
                resolution = f"{stream['width']}x{stream['height']}"
            avc = _AVC_PROFILES.get(stream.get("profile", ""))
            level = stream.get("level")
            if avc and isinstance(level, int) and level > 0:
                codecs.insert(0, f"avc1.{avc[0]:02x}{avc[1]:02x}{level:02x}")
            else:
                video_codec_known = False
        elif stream.get("codec_type") == "audio" and stream.get("codec_name") == "aac":
            if AAC_LC_CODEC not in codecs:
                codecs.append(AAC_LC_CODEC)
    # CODECS naming only the audio would advertise a video rung as audio-only:
    # better none, which a player then probes.
    if not video_codec_known:
        return resolution, None
    return resolution, ",".join(codecs) or None


def write_master_playlist(
    master_path: str, rungs: list[tuple[str, str]], nominal_bps: dict[str, int]
) -> None:
    """The master playlist, describing each rung as encoded.

    `rungs` is (name, directory) in ladder order. BANDWIDTH is the measured
    peak, falling back to the nominal rate; RESOLUTION and CODECS come from
    the rung's own stream (RESOLUTION is absent for audio).
    """
    with open(master_path, "w") as master:
        master.write("#EXTM3U\n")
        master.write("#EXT-X-VERSION:3\n")
        for name, rung_dir in rungs:
            bandwidth = peak_bandwidth(os.path.join(rung_dir, "index.m3u8"))
            resolution, codecs = encoded_stream_tags(
                os.path.join(rung_dir, "stream.ts")
            )
            attributes = [f"BANDWIDTH={bandwidth or nominal_bps[name]}"]
            if resolution:
                attributes.append(f"RESOLUTION={resolution}")
            if codecs:
                attributes.append(f'CODECS="{codecs}"')
            master.write(f"#EXT-X-STREAM-INF:{','.join(attributes)}\n")
            master.write(f"{name}/index.m3u8\n")


def _bps(bitrate: str) -> int:
    """'3000k' → 3_000_000."""
    return int(bitrate[:-1]) * 1000


Progress = Callable[[float], None]
"""Told how much of a stage is done, from 0.0 to 1.0."""


def _rung_seconds(
    on_progress: Progress | None, rung: int, rungs: int, duration: float
) -> Callable[[float], None] | None:
    """For rung `rung` of `rungs` (each an equal share of the stage), turn
    ffmpeg's seconds-encoded into the stage's fraction done."""
    if on_progress is None or duration <= 0:
        return None
    return lambda seconds: on_progress((rung + min(seconds / duration, 1.0)) / rungs)


def transcode_video_hls(
    input_path: str,
    output_dir: str,
    source_short_side: int | None,
    use_gpu: bool,
    tonemap: str | None = None,
    duration: float = 0,
    on_progress: Progress | None = None,
) -> list[str]:
    """Transcode video to multi-quality HLS variants.

    A rung is encoded when the source's short side reaches it (portrait and
    landscape alike). If the source is smaller than every rung, one 'source'
    rung keeps its own size, so the master playlist is never empty.
    `on_progress` hears the whole ladder's progress when `duration` is known.
    """
    print("Transcoding video to HLS variants...")

    ladder: list[tuple[str, dict]] = []
    for variant_name, settings in HLS_VARIANTS.items():
        if source_short_side and settings["height"] > source_short_side:
            print(
                f"Skipping {variant_name} (source short side {source_short_side} < {settings['height']})"
            )
            continue
        ladder.append((variant_name, settings))

    # Fallback: if source is smaller than all standard variants, encode at native resolution
    if not ladder and source_short_side is not None:
        print(
            f"No standard variants fit source ({source_short_side}p). Encoding 'source' variant..."
        )
        ladder.append(
            (
                "source",
                {
                    "height": even_floor(source_short_side),
                    "video_bitrate": "800k",
                    "audio_bitrate": "64k",
                },
            )
        )

    for rung, (variant_name, settings) in enumerate(ladder):
        variant_dir = os.path.join(output_dir, variant_name)
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        print(f"Encoding {variant_name}...")
        _encode_hls_variant(
            input_path,
            variant_dir,
            playlist_path,
            settings,
            variant_name,
            use_gpu,
            tonemap,
            _rung_seconds(on_progress, rung, len(ladder), duration),
        )

    write_master_playlist(
        os.path.join(output_dir, "master.m3u8"),
        [(name, os.path.join(output_dir, name)) for name, _ in ladder],
        {
            name: _bps(settings["video_bitrate"]) + _bps(settings["audio_bitrate"])
            for name, settings in ladder
        },
    )

    return [name for name, _ in ladder]


def _build_audio_hls_cmd(
    input_path: str, variant_dir: str, playlist_path: str, settings: dict
) -> list[str]:
    """Build ffmpeg command for one audio-only HLS rung (single-file HLS).

    Not TOLERANT_DECODE: with the audio the whole content, a file whose
    frames mostly fail to decode is damaged (exit 69 → CORRUPT_INPUT).
    """
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vn",
        *_audio_codec(settings["audio_bitrate"]),
        "-af",
        LOUDNORM,
        *_hls_output(os.path.join(variant_dir, "stream.ts"), playlist_path),
    ]


def transcode_audio_hls(
    input_path: str,
    output_dir: str,
    duration: float = 0,
    on_progress: Progress | None = None,
) -> list[str]:
    """Transcode audio to HLS variants; `on_progress` as for video."""
    print("Transcoding audio to HLS variants...")

    variant_playlists = []

    for rung, (variant_name, settings) in enumerate(AUDIO_VARIANTS.items()):
        variant_dir = os.path.join(output_dir, variant_name)
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        print(f"Encoding audio {variant_name}...")
        run_ffmpeg(
            _build_audio_hls_cmd(input_path, variant_dir, playlist_path, settings),
            timeout=600,
            description=f"audio HLS {variant_name}",
            on_seconds=_rung_seconds(on_progress, rung, len(AUDIO_VARIANTS), duration),
        )
        _validate_hls_rung(variant_dir, playlist_path, f"audio {variant_name}")
        variant_playlists.append((variant_name, settings))

    write_master_playlist(
        os.path.join(output_dir, "master.m3u8"),
        [(name, os.path.join(output_dir, name)) for name, _ in variant_playlists],
        {name: _bps(settings["audio_bitrate"]) for name, settings in variant_playlists},
    )

    # Report 'audio' as the LOGICAL ready variant (matches hlsVariantSchema —
    # the readyVariants label set surfaced to the client quality picker).
    #
    # The PHYSICAL rungs (128k/64k) are the directory names written into the
    # master playlist above, so the client fetches them back through the
    # variant-playlist proxy as `/hls/<rung>/index.m3u8`. Those names MUST stay
    # in `hlsVariantPathSchema` (packages/validation/src/schemas/transcoding.ts)
    # or the proxy 403s ("Invalid request") and audio playback breaks.
    return ["audio"] if variant_playlists else []


def _build_preview_cmd(
    input_path: str,
    preview_dir: str,
    start_time: int,
    preview_duration: int,
    use_gpu: bool,
    short_side: int = PREVIEW_HEIGHT,
    tonemap: str | None = None,
) -> list[str]:
    """Build ffmpeg command for preview clip (single-file HLS, see variant cmd)."""
    return [
        "ffmpeg",
        "-y",
        *_input_args(input_path, use_gpu, seek_seconds=start_time),
        "-t",
        str(preview_duration),
        "-vf",
        ladder_filter(short_side, tonemap),
        *_video_codec(use_gpu, 23, cpu_preset="fast"),
        *_audio_codec("128k"),
        *_hls_output(
            os.path.join(preview_dir, "stream.ts"),
            os.path.join(preview_dir, "preview.m3u8"),
        ),
    ]


def create_preview(
    input_path: str,
    output_dir: str,
    duration: int,
    use_gpu: bool,
    source_short_side: int | None = None,
    tonemap: str | None = None,
) -> None:
    """Create a 30-second preview clip with GPU → CPU fallback: 720p, or the
    source's own size when it is smaller (never upscaled)."""
    print("Creating preview clip...")

    preview_dir = os.path.join(output_dir, "preview")
    os.makedirs(preview_dir, exist_ok=True)

    start_time = max(0, int(duration * 0.1))
    preview_duration = min(PREVIEW_DURATION, duration - start_time)
    short_side = PREVIEW_HEIGHT
    if source_short_side:
        short_side = min(PREVIEW_HEIGHT, even_floor(source_short_side))

    playlist_path = os.path.join(preview_dir, "preview.m3u8")
    _encode_with_fallback(
        use_gpu,
        lambda gpu: _build_preview_cmd(
            input_path,
            preview_dir,
            start_time,
            preview_duration,
            use_gpu=gpu,
            short_side=short_side,
            tonemap=tonemap,
        ),
        lambda: _validate_hls_rung(preview_dir, playlist_path, "preview"),
        "preview",
        timeout=120,
    )


# Poster sizes, by width: lossy libwebp, each at min(width, the picture's
# width), so a small source is never upscaled. sm/md/lg/xl and their widths
# match the web's still sizes (packages/validation THUMBNAIL_SIZES plus xl,
# apps/web/src/lib/utils/image.ts).
POSTER_SIZES: dict[str, dict[str, int]] = {
    "sm": {"width": 200, "quality": 75, "compression": 6},
    "md": {"width": 400, "quality": 80, "compression": 5},
    "lg": {"width": 800, "quality": 82, "compression": 4},
    "xl": {"width": 1600, "quality": 82, "compression": 4},
}

# The job-input contract from which posters go in the sized image layout
# (TRANSCODING_JOB_CONTRACT in packages/constants/src/transcoding.ts). A job
# without it comes from a service that reads only the flat layout
# `media-thumbnails/{mediaId}/{sm,md,lg}.webp`, so it gets that.
SIZED_POSTERS_CONTRACT = 2
FLAT_POSTER_SIZES = ("sm", "md", "lg")


def poster_folder_name(width: int, height: int) -> str:
    """`{width}x{height}-{8 hex}`: the picture's upright size, which the web
    reads from the name (STILL_FOLDER_NAME, packages/validation/src/image.ts),
    and a nonce that keeps two uploads apart so every file caches forever."""
    return f"{width}x{height}-{secrets.token_hex(4)}"


def extract_thumbnail_variants(
    input_path: str,
    output_dir: str,
    duration: int,
    sizes: tuple[str, ...] | list[str],
    tonemap: str | None = None,
) -> dict[str, str]:
    """Extract a poster at the 10% mark in each of `sizes` (POSTER_SIZES keys).

    Pixels are squared first, as in every rung, so the poster has the shape
    the picture is shown at. One frame is decoded, so a damaged one at that
    point would be 100% of the error rate: tolerant decode keeps it a glitch.
    """
    unknown = [size for size in sizes if size not in POSTER_SIZES]
    if unknown or not sizes:
        raise ValueError(f"Invalid thumbnail sizes: {list(sizes)}")

    print(f"Extracting thumbnail variants ({'/'.join(sizes)})...")

    timestamp = max(1, int(duration * 0.1))

    variants = {}

    for size_name in sizes:
        config = POSTER_SIZES[size_name]
        output_path = os.path.join(output_dir, f"thumbnail-{size_name}.webp")

        cmd = [
            "ffmpeg",
            "-y",
            *_input_args(input_path, use_gpu=False, seek_seconds=timestamp),
            "-vframes",
            "1",
            "-vf",
            _filters(SQUARE_PIXELS, tonemap, f"scale='min({config['width']},iw)':-1"),
            "-c:v",
            "libwebp",
            "-quality",
            str(config["quality"]),
            "-compression_level",
            str(config["compression"]),
            output_path,
        ]

        run_ffmpeg(cmd, timeout=60, description=f"thumbnail {size_name}")
        validate_output(output_path, f"thumbnail {size_name}")
        variants[size_name] = output_path

        file_size = os.path.getsize(output_path)
        print(f"  {size_name}: {file_size} bytes")

    return variants


def generate_waveform(
    input_path: str, json_path: str, image_path: str | None = None
) -> None:
    """Generate audio waveform JSON (always) and optional PNG image.

    Pass image_path=None to skip PNG generation — the JSON is the
    canonical data consumed by the audio player; the PNG is a static
    preview currently unused on the frontend.
    """
    print("Generating audio waveform...")

    cmd_json = [
        "audiowaveform",
        "-i",
        input_path,
        "-o",
        json_path,
        "--pixels-per-second",
        "10",
        "-b",
        "8",
    ]
    run_ffmpeg(cmd_json, timeout=120, description="waveform JSON")
    validate_output(json_path, "waveform JSON")

    if image_path is None:
        return

    cmd_png = [
        "audiowaveform",
        "-i",
        input_path,
        "-o",
        image_path,
        "--width",
        "1800",
        "--height",
        "140",
        "--colors",
        "audition",
    ]
    run_ffmpeg(cmd_png, timeout=120, description="waveform PNG")
    validate_output(image_path, "waveform PNG")


# =============================================================================
# Webhook
# =============================================================================


def sign_payload(payload: str, secret: str, timestamp: str | None = None) -> str:
    """Generate HMAC-SHA256 signature for webhook payload.

    If timestamp is provided, signs 'timestamp.payload' to match
    the server's signature format for replay protection.
    """
    message = f"{timestamp}.{payload}" if timestamp else payload
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _signed_headers(payload: str, secret: str) -> dict[str, str]:
    """The headers media-api verifies: an HMAC over `timestamp.payload`."""
    timestamp = str(int(time.time()))
    return {
        "Content-Type": "application/json",
        "X-Runpod-Signature": sign_payload(payload, secret, timestamp),
        "X-Runpod-Timestamp": timestamp,
    }


def send_webhook(url: str, secret: str, result: dict) -> None:
    """Send a signed webhook: 3 attempts with backoff for a network failure,
    a 5xx, a 408 or a 429; one for any other 4xx, which would be refused
    again. Raises RuntimeError when it is not delivered (the handler then
    reports or keeps the outputs, see `handler`).
    """
    max_attempts = 3
    backoff_base = 2

    payload = json.dumps(result)
    headers = _signed_headers(payload, secret)

    last_error = "not sent"
    for attempt in range(max_attempts):
        try:
            response = requests.post(url, data=payload, headers=headers, timeout=30)
        except Exception as e:
            last_error = str(e)
        else:
            if response.ok:
                print(f"Webhook sent successfully (attempt {attempt + 1})")
                _note_rejection(response)
                return
            last_error = (
                f"media-api answered {response.status_code}: {response.text[:300]}"
            )
            if response.status_code in (401, 403):
                print(
                    "Webhook refused as unsigned: WEBHOOK_SECRET or this worker's "
                    "clock differs from media-api's"
                )
            if 400 <= response.status_code < 500 and response.status_code not in (
                408,
                429,
            ):
                break
        if attempt < max_attempts - 1:
            delay = backoff_base**attempt
            print(
                f"Webhook attempt {attempt + 1} failed: {last_error}. Retrying in {delay}s..."
            )
            time.sleep(delay)

    raise RuntimeError(f"Webhook not delivered: {last_error}")


def _note_rejection(response: Any) -> None:
    """media-api answers 200 `{rejected: true}` to a completion its schema
    refused, and fails the row: say so here, where the job's log is."""
    try:
        body = response.json()
    except ValueError:
        return
    if isinstance(body, dict) and body.get("rejected") is True:
        print(f"WARNING: media-api rejected the result: {body.get('error')}")


def send_progress(
    url: str,
    secret: str,
    job_id: str,
    step: str,
    percent: int,
    media_id: str = "",
    creator_id: str | None = None,
) -> None:
    """Send a progress update webhook. Fire-and-forget: failures are logged but don't stop the job."""
    payload_dict: dict[str, Any] = {
        "jobId": job_id,
        "status": "progress",
        "progress": percent,
        "step": step,
        "creatorId": creator_id,
    }
    if media_id:
        payload_dict["mediaId"] = media_id
    payload = json.dumps(payload_dict)
    try:
        # Short: it is fire-and-forget, and the end of a rung waits for a
        # tick in flight.
        answer = requests.post(
            url, data=payload, headers=_signed_headers(payload, secret), timeout=(2, 3)
        )
        if not answer.ok:
            print(f"Progress webhook answered {answer.status_code} (non-fatal)")
    except Exception as e:
        print(f"Progress webhook failed (non-fatal): {e}")


# Ticks within a step go no closer than this (owner's choice, 2026-10-26:
# about every 5%), so a long encode sends a dozen, not one a second.
PROGRESS_INTERVAL_POINTS = 5


class ProgressReporter:
    """One job's progress webhooks.

    A new step is always reported. Within a step a tick goes once it is
    PROGRESS_INTERVAL_POINTS past the last one sent, never backwards (a GPU
    encode that falls back to the CPU starts again from zero).
    """

    def __init__(
        self,
        url: str,
        secret: str,
        job_id: str,
        media_id: str,
        creator_id: str | None,
    ):
        self.url = url
        self.secret = secret
        self.job_id = job_id
        self.media_id = media_id
        self.creator_id = creator_id
        self._step: str | None = None
        self._percent = 0

    def report(self, step: str, percent: int) -> None:
        if step == self._step and percent < self._percent + PROGRESS_INTERVAL_POINTS:
            return
        self._step, self._percent = step, percent
        send_progress(
            self.url,
            self.secret,
            self.job_id,
            step,
            percent,
            self.media_id,
            self.creator_id,
        )

    def stage(self, step: str, start: int, end: int) -> Progress:
        """Report `step` at `start`; the callback returned maps the stage's
        0.0-1.0 onto start..end."""
        self.report(step, start)
        return lambda done: self.report(step, start + int((end - start) * done))


# =============================================================================
# Main Handler
# =============================================================================


def _required(job_input: dict[str, Any], name: str) -> Any:
    if name not in job_input:
        raise ValueError(f"Job input is missing '{name}'")
    return job_input[name]


def handler(job: dict[str, Any]) -> dict[str, Any]:
    """RunPod serverless handler for transcoding jobs."""
    job_input = job.get("input") or {}

    # The maintenance run's keep-alive ping (`ping` in
    # packages/transcoding/src/runpod-api.ts). Its request alone resets
    # RunPod's idle clock, so it is answered before anything a real job
    # carries is read.
    if job_input.get("ping") is True:
        print("Keep-alive ping")
        return {"status": "pong"}

    job_id = job.get("id") or str(job_input.get("mediaId") or "unknown")
    webhook_url = job_input.get("webhookUrl", "")
    webhook_secret = os.environ.get("WEBHOOK_SECRET", "")

    # Without a safe URL and a signing secret there is nobody to tell, so these
    # two raise: RunPod records the job FAILED, and the maintenance run
    # reconciles the row from the job's status. Every other check runs inside
    # the try below, so its failure is reported.
    validate_webhook_url(webhook_url)
    if not webhook_secret:
        raise ValueError("WEBHOOK_SECRET not configured in environment.")

    work_dir: str | None = None
    uploaded_keys: list[tuple[Any, str, str]] = []
    # The completed report, once every output is uploaded. If it then cannot
    # be delivered, the outputs are kept (see the except).
    completion: dict[str, Any] | None = None

    try:
        media_id = _required(job_input, "mediaId")
        creator_id = _required(job_input, "creatorId")
        media_type = _required(job_input, "type")
        input_key = _required(job_input, "inputKey")

        # --- Input validation ---
        validate_path_component(creator_id, "creatorId")
        validate_path_component(media_id, "mediaId")
        validate_input_key(input_key)

        if media_type not in ("video", "audio"):
            raise ValueError(
                f"Invalid media type: '{media_type}'. Must be 'video' or 'audio'."
            )

        progress = ProgressReporter(
            webhook_url,
            webhook_secret,
            job_id,
            media_id,
            reportable_creator_id(creator_id),
        )

        print(f"Starting transcoding job for {media_type}: {media_id}")
        print(f"Active features: {FEATURES}")

        # --- Environment credentials ---
        b2_endpoint = os.environ.get("B2_ENDPOINT")
        b2_access_key_id = os.environ.get("B2_ACCESS_KEY_ID")
        b2_secret_access_key = os.environ.get("B2_SECRET_ACCESS_KEY")
        b2_bucket_name = os.environ.get("B2_BUCKET_NAME")

        if not all(
            [b2_endpoint, b2_access_key_id, b2_secret_access_key, b2_bucket_name]
        ):
            raise ValueError(
                "B2 credentials not configured in environment. Add secrets in RunPod console."
            )

        r2_endpoint = os.environ.get("R2_ENDPOINT")
        r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
        r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
        r2_bucket_name = os.environ.get("R2_BUCKET_NAME")

        if not all(
            [r2_endpoint, r2_access_key_id, r2_secret_access_key, r2_bucket_name]
        ):
            raise ValueError(
                "R2 credentials not configured in environment. Add secrets in RunPod console."
            )

        assets_bucket_name = os.environ.get("ASSETS_BUCKET_NAME")
        if not assets_bucket_name:
            raise ValueError(
                "ASSETS_BUCKET_NAME not configured in environment. Add secret in RunPod console."
            )

        # --- Storage clients ---
        r2_client = create_s3_client(
            r2_endpoint, r2_access_key_id, r2_secret_access_key
        )
        b2_client = create_s3_client(
            b2_endpoint, b2_access_key_id, b2_secret_access_key
        )
        assets_client = create_s3_client(
            r2_endpoint, r2_access_key_id, r2_secret_access_key
        )

        # --- GPU check ---
        use_gpu = check_gpu_available()
        print(f"GPU available: {use_gpu}")

        # --- Processing ---
        work_dir = tempfile.mkdtemp(prefix="transcoding_")

        # Step 1: Download original from R2
        progress.report("downloading", 0)
        input_ext = os.path.splitext(input_key)[1] or ".mp4"
        input_path = os.path.join(work_dir, f"input{input_ext}")
        download_file(r2_client, r2_bucket_name, input_key, input_path)

        # Step 2: Probe metadata
        progress.report("probing", 5)
        probe_data = probe_media(input_path)
        duration, width, height = get_media_info(probe_data)
        if duration <= 0:
            duration = measure_duration(input_path)
        print(f"Media info: duration={duration}s, width={width}, height={height}")

        if duration <= 0:
            raise TranscodeError(
                TranscodeErrorCode.INVALID_DURATION,
                f"Invalid media duration: {duration}s. File may be corrupt or empty.",
            )
        if duration > MAX_DURATION_SECONDS:
            raise TranscodeError(
                TranscodeErrorCode.INVALID_DURATION,
                f"Media is {duration}s long; the most is {MAX_DURATION_SECONDS}s.",
            )

        validate_streams(probe_data, media_type)
        tonemap = tonemap_filter(probe_data) if media_type == "video" else None
        if tonemap:
            print("HDR source: tone-mapping to SDR (BT.709)")

        # Step 3: Create mezzanine → Upload to B2 (gated)
        mezzanine_key = None
        if FEATURES["mezzanine"] and media_type == "video":
            progress.report("mezzanine", 6)
            mezzanine_path = os.path.join(work_dir, "mezzanine.mp4")
            mezzanine_key = f"{creator_id}/mezzanine/{media_id}/mezzanine.mp4"
            create_mezzanine(input_path, mezzanine_path, use_gpu, tonemap)
            upload_file(
                b2_client, b2_bucket_name, mezzanine_key, mezzanine_path, "video/mp4"
            )
            uploaded_keys.append((b2_client, b2_bucket_name, mezzanine_key))

        # Step 4: Loudness analysis (gated — stats only, not fed back to encoder)
        loudness_integrated: int | None = None
        loudness_peak: int | None = None
        loudness_range: int | None = None
        if FEATURES["loudness_analysis"]:
            progress.report("loudness", 15)
            loudness = analyze_loudness(input_path)
            print(f"Loudness: {loudness}")
            if loudness is not None:
                loudness_integrated = max(
                    -10000, min(1000, int(loudness["input_i"] * 100))
                )
                loudness_peak = max(-10000, min(2000, int(loudness["input_tp"] * 100)))
                loudness_range = max(0, min(50000, int(loudness["input_lra"] * 100)))

        # Step 5: Transcode HLS variants
        # The ladder reports as it encodes: 17% → 72%.
        on_encode = progress.stage("encoding_variants", 17, 72)
        hls_dir = os.path.join(work_dir, "hls")
        os.makedirs(hls_dir, exist_ok=True)

        # The picture's short side (upright, square pixels) picks the rungs.
        short_side = min(width, height) if width and height else None
        if media_type == "video":
            ready_variants = transcode_video_hls(
                input_path, hls_dir, short_side, use_gpu, tonemap, duration, on_encode
            )
        else:
            ready_variants = transcode_audio_hls(
                input_path, hls_dir, duration, on_encode
            )

        # Step 6: Create preview BEFORE uploading HLS dir (preview goes into hls_dir)
        hls_preview_key = None
        preview_generated = False
        if FEATURES["video_preview"] and media_type == "video" and duration > 0:
            progress.report("preview", 72)
            create_preview(input_path, hls_dir, duration, use_gpu, short_side, tonemap)
            preview_generated = True

        # Upload HLS to R2 (includes preview if generated above)
        hls_prefix = f"{creator_id}/hls/{media_id}/"
        hls_uploaded = upload_directory_tracked(
            r2_client, r2_bucket_name, hls_prefix, hls_dir
        )
        uploaded_keys.extend(hls_uploaded)
        hls_master_key = f"{hls_prefix}master.m3u8"
        if preview_generated:
            hls_preview_key = f"{hls_prefix}preview/preview.m3u8"

        # Step 7: Extract thumbnail variants (video only)
        progress.report("thumbnails", 77)
        thumbnail_key = None
        thumbnail_variants = None
        if media_type == "video" and duration > 0:
            # A job without a contract, or a picture whose size is unknown,
            # keeps the flat layout an older service reads.
            contract = job_input.get("contract")
            sized = (
                isinstance(contract, int)
                and contract >= SIZED_POSTERS_CONTRACT
                and bool(width)
                and bool(height)
            )
            poster_prefix = f"{creator_id}/media-thumbnails/{media_id}/"
            if sized:
                poster_prefix += f"{poster_folder_name(width, height)}/"
            thumbnail_files = extract_thumbnail_variants(
                input_path,
                work_dir,
                duration,
                list(POSTER_SIZES) if sized else FLAT_POSTER_SIZES,
                tonemap,
            )

            thumbnail_variants = {}
            for size_name, local_path in thumbnail_files.items():
                r2_key = f"{poster_prefix}{size_name}.webp"
                upload_file(
                    assets_client, assets_bucket_name, r2_key, local_path, "image/webp"
                )
                uploaded_keys.append((assets_client, assets_bucket_name, r2_key))
                thumbnail_variants[size_name] = r2_key

            thumbnail_key = thumbnail_variants.get("lg")

        # Step 8: Generate waveform (audio only)
        progress.report(
            "waveform" if media_type == "audio" else "uploading_outputs", 80
        )
        waveform_key = None
        waveform_image_key = None
        if media_type == "audio":
            waveform_json_path = os.path.join(work_dir, "waveform.json")
            waveform_png_path = (
                os.path.join(work_dir, "waveform.png")
                if FEATURES["waveform_image"]
                else None
            )
            generate_waveform(input_path, waveform_json_path, waveform_png_path)

            waveform_key = f"{creator_id}/waveforms/{media_id}/waveform.json"
            upload_file(
                r2_client,
                r2_bucket_name,
                waveform_key,
                waveform_json_path,
                "application/json",
            )
            uploaded_keys.append((r2_client, r2_bucket_name, waveform_key))

            if waveform_png_path is not None:
                waveform_image_key = f"{creator_id}/waveforms/{media_id}/waveform.png"
                upload_file(
                    r2_client,
                    r2_bucket_name,
                    waveform_image_key,
                    waveform_png_path,
                    "image/png",
                )
                uploaded_keys.append((r2_client, r2_bucket_name, waveform_image_key))

        # Build result — field names must match runpodWebhookOutputSchema
        result: WebhookOutput = {
            "mediaId": media_id,
            "type": media_type,
            "hlsMasterKey": hls_master_key,
            "hlsPreviewKey": hls_preview_key,
            "thumbnailKey": thumbnail_key,
            "thumbnailVariants": thumbnail_variants,
            "waveformKey": waveform_key,
            "waveformImageKey": waveform_image_key,
            "mezzanineKey": mezzanine_key,
            "durationSeconds": duration,
            # The encodes use the real size; only an unreportable one is null.
            "width": reportable_dimensions(width, height)[0],
            "height": reportable_dimensions(width, height)[1],
            "readyVariants": ready_variants,
            "loudnessIntegrated": loudness_integrated,
            "loudnessPeak": loudness_peak,
            "loudnessRange": loudness_range,
        }

        # Step 10: Send completion webhook
        progress.report("finalizing", 95)
        completion = {
            "jobId": job_id,
            "status": "completed",
            "creatorId": reportable_creator_id(creator_id),
            "output": result,
        }
        send_webhook(webhook_url, webhook_secret, completion)

        return {"status": "success", "mediaId": media_id}

    except Exception as e:
        error_msg = str(e)

        if completion is not None:
            # Every output is uploaded; only the report failed, and the service
            # may even have recorded it before answering badly. Deleting the
            # outputs and reporting a failure could contradict a row already
            # `ready`. So keep them and finish COMPLETED: the maintenance run
            # finds the job COMPLETED without its webhook (WEBHOOK_LOST).
            print(f"Completion webhook undeliverable; keeping outputs: {error_msg}")
            return {
                "status": "webhook_undelivered",
                "mediaId": completion["output"]["mediaId"],
                "error": error_msg[:2000],
            }

        error_code = error_code_of(e)
        print(f"Transcoding failed ({error_code}): {error_msg}")

        # Clean up any partial uploads
        if uploaded_keys:
            print(f"Cleaning up {len(uploaded_keys)} uploaded files...")
            cleanup_uploaded_keys(uploaded_keys)

        # Send failure webhook (include mediaId so the service can find it even
        # when runpodJobId hasn't been stored yet — common in local /runsync
        # flow). A mediaId the service's schema would refuse goes as null, so
        # the report itself is never rejected.
        try:
            webhook_payload = {
                "jobId": job_id,
                "status": "failed",
                "error": error_msg[:2000],
                "errorCode": error_code,
                "mediaId": reportable_media_id(job_input.get("mediaId")),
                "creatorId": reportable_creator_id(job_input.get("creatorId")),
            }
            send_webhook(webhook_url, webhook_secret, webhook_payload)
        except Exception as webhook_error:
            print(f"Failed to send error webhook: {webhook_error}")
            # Re-raise so RunPod surfaces this as an exception in its error logs
            # rather than a quiet error-dict return. Idempotent retry is safe.
            raise

        return {"status": "error", "error": error_msg, "errorCode": error_code}

    finally:
        if work_dir is not None:
            shutil.rmtree(work_dir, ignore_errors=True)


# RunPod serverless entry point.
#
# Guarded so this module can be imported without starting the serverless loop —
# local_server.py imports `handler` directly to run jobs on a background thread
# (see LOCAL_DEV.md). Production is unaffected: its CMD is
# `python3 -u handler/main.py`, so __name__ == "__main__" and this still runs.
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
