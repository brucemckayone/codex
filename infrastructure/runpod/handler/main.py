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
import shutil
import subprocess
import tempfile
import time
from typing import Any, TypedDict
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
    "thumbnail_variants": _env_flag("ENABLE_THUMBNAIL_VARIANTS", default=True),
    "video_preview": _env_flag("ENABLE_VIDEO_PREVIEW", default=True),
}


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
    thumbnailKey: str | None  # Points to 'lg' variant
    thumbnailVariants: dict[str, str] | None  # {'sm': key, 'md': key, 'lg': key}
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

# HLS variant settings (resolution → bitrate)
HLS_VARIANTS = {
    "1080p": {"height": 1080, "video_bitrate": "5000k", "audio_bitrate": "192k"},
    "720p": {"height": 720, "video_bitrate": "3000k", "audio_bitrate": "128k"},
    "480p": {"height": 480, "video_bitrate": "1500k", "audio_bitrate": "96k"},
    "360p": {"height": 360, "video_bitrate": "800k", "audio_bitrate": "64k"},
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


# =============================================================================
# FFmpeg Helper
# =============================================================================


def run_ffmpeg(
    cmd: list[str], timeout: int = 3600, description: str = "ffmpeg"
) -> subprocess.CompletedProcess:
    """Run an ffmpeg/ffprobe command with proper error capture.

    On failure, raises RuntimeError with the last 2KB of stderr
    so the actual ffmpeg error message is preserved for debugging.
    """
    try:
        return subprocess.run(
            cmd, check=True, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.CalledProcessError as e:
        stderr_excerpt = (e.stderr or "")[-2000:]
        raise RuntimeError(
            f"{description} failed (exit {e.returncode}): {stderr_excerpt}"
        ) from e


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


def upload_directory(client: Any, bucket: str, key_prefix: str, local_dir: str) -> None:
    """Upload all files in a directory to S3-compatible storage."""
    for root, _, files in os.walk(local_dir):
        for filename in files:
            local_path = os.path.join(root, filename)
            relative_path = os.path.relpath(local_path, local_dir)
            key = f"{key_prefix}{relative_path}"

            # Determine content type
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
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    result = run_ffmpeg(cmd, timeout=30, description="ffprobe")
    return json.loads(result.stdout)


def get_media_info(probe_data: dict[str, Any]) -> tuple[int, int | None, int | None]:
    """Extract duration, width, height from probe data."""
    duration = int(float(probe_data.get("format", {}).get("duration", 0)))

    width = None
    height = None
    for stream in probe_data.get("streams", []):
        if stream.get("codec_type") == "video":
            width = stream.get("width")
            height = stream.get("height")
            break

    return duration, width, height


def validate_streams(probe_data: dict[str, Any], media_type: str) -> None:
    """Verify the file actually contains the expected stream types."""
    streams = probe_data.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    if media_type == "video" and not has_video:
        raise ValueError("File declared as video but contains no video streams")
    if media_type == "audio" and not has_audio:
        raise ValueError("File declared as audio but contains no audio streams")


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


def _build_mezzanine_cmd(input_path: str, output_path: str, use_gpu: bool) -> list[str]:
    """Build ffmpeg command for mezzanine creation."""
    if use_gpu:
        return [
            "ffmpeg",
            "-y",
            "-hwaccel",
            "cuda",
            "-i",
            input_path,
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "256k",
            output_path,
        ]
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        output_path,
    ]


def create_mezzanine(input_path: str, output_path: str, use_gpu: bool) -> None:
    """Create high-quality mezzanine file (CRF 18 for archival).

    Falls back to CPU if GPU encoding fails (e.g. OOM).
    """
    print("Creating mezzanine (CRF 18)...")

    if use_gpu:
        try:
            run_ffmpeg(
                _build_mezzanine_cmd(input_path, output_path, use_gpu=True),
                timeout=3600,
                description="mezzanine (GPU)",
            )
            return
        except RuntimeError as e:
            print(f"GPU mezzanine failed, falling back to CPU: {e}")

    run_ffmpeg(
        _build_mezzanine_cmd(input_path, output_path, use_gpu=False),
        timeout=3600,
        description="mezzanine (CPU)",
    )


def _safe_loudness(value: float, default: float) -> float:
    """Clamp non-finite loudness values (inf, -inf, NaN) to a safe default.

    ffmpeg's loudnorm returns -inf for silent audio tracks — int(-inf) crashes.
    """
    if math.isfinite(value):
        return value
    return default


def analyze_loudness(input_path: str) -> dict[str, float]:
    """Two-pass loudness analysis using loudnorm filter."""
    print("Analyzing audio loudness...")

    cmd = [
        "ffmpeg",
        "-i",
        input_path,
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-f",
        "null",
        "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    # Parse loudnorm output from stderr
    output = result.stderr
    try:
        json_start = output.rfind("{")
        json_end = output.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            loudness_data = json.loads(output[json_start:json_end])
            return {
                "input_i": _safe_loudness(
                    float(loudness_data.get("input_i", -16)), -70.0
                ),
                "input_tp": _safe_loudness(
                    float(loudness_data.get("input_tp", -1)), -1.0
                ),
                "input_lra": _safe_loudness(
                    float(loudness_data.get("input_lra", 7)), 0.0
                ),
            }
    except (json.JSONDecodeError, ValueError):
        print("WARNING: Failed to parse loudness data, using defaults")

    return {"input_i": -16, "input_tp": -1, "input_lra": 7}


def _build_hls_variant_cmd(
    input_path: str,
    variant_dir: str,
    playlist_path: str,
    settings: dict,
    use_gpu: bool,
) -> list[str]:
    """Build ffmpeg command for a single HLS variant."""
    segment_path = os.path.join(variant_dir, "segment_%03d.ts")

    if use_gpu:
        return [
            "ffmpeg",
            "-y",
            "-hwaccel",
            "cuda",
            "-i",
            input_path,
            "-vf",
            f"scale=-2:{settings['height']}",
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "23",
            "-b:v",
            settings["video_bitrate"],
            "-maxrate",
            settings["video_bitrate"],
            "-bufsize",
            f"{int(settings['video_bitrate'][:-1]) * 2}k",
            "-c:a",
            "aac",
            "-b:a",
            settings["audio_bitrate"],
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-f",
            "hls",
            "-hls_time",
            str(HLS_SEGMENT_DURATION),
            "-hls_playlist_type",
            "vod",
            "-hls_segment_filename",
            segment_path,
            playlist_path,
        ]
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vf",
        f"scale=-2:{settings['height']}",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-b:v",
        settings["video_bitrate"],
        "-maxrate",
        settings["video_bitrate"],
        "-bufsize",
        f"{int(settings['video_bitrate'][:-1]) * 2}k",
        "-c:a",
        "aac",
        "-b:a",
        settings["audio_bitrate"],
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-f",
        "hls",
        "-hls_time",
        str(HLS_SEGMENT_DURATION),
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segment_path,
        playlist_path,
    ]


def _encode_hls_variant(
    input_path: str,
    variant_dir: str,
    playlist_path: str,
    settings: dict,
    variant_name: str,
    use_gpu: bool,
) -> None:
    """Encode a single HLS variant with GPU → CPU fallback."""
    if use_gpu:
        try:
            run_ffmpeg(
                _build_hls_variant_cmd(
                    input_path, variant_dir, playlist_path, settings, use_gpu=True
                ),
                timeout=3600,
                description=f"HLS {variant_name} (GPU)",
            )
            return
        except RuntimeError as e:
            print(f"GPU failed for {variant_name}, falling back to CPU: {e}")

    run_ffmpeg(
        _build_hls_variant_cmd(
            input_path, variant_dir, playlist_path, settings, use_gpu=False
        ),
        timeout=3600,
        description=f"HLS {variant_name} (CPU)",
    )


def transcode_video_hls(
    input_path: str,
    output_dir: str,
    source_height: int | None,
    use_gpu: bool,
) -> list[str]:
    """Transcode video to multi-quality HLS variants.

    If source is smaller than all standard variants, produces a 'source'
    variant at the native resolution so the master playlist is never empty.
    """
    print("Transcoding video to HLS variants...")

    ready_variants = []
    variant_playlists = []

    for variant_name, settings in HLS_VARIANTS.items():
        if source_height and settings["height"] > source_height:
            print(
                f"Skipping {variant_name} (source height {source_height} < {settings['height']})"
            )
            continue

        variant_dir = os.path.join(output_dir, variant_name)
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        print(f"Encoding {variant_name}...")
        _encode_hls_variant(
            input_path, variant_dir, playlist_path, settings, variant_name, use_gpu
        )
        ready_variants.append(variant_name)
        variant_playlists.append((variant_name, settings))

    # Fallback: if source is smaller than all standard variants, encode at native resolution
    if not ready_variants and source_height is not None:
        print(
            f"No standard variants fit source ({source_height}p). Encoding 'source' variant..."
        )
        settings = {
            "height": source_height,
            "video_bitrate": "800k",
            "audio_bitrate": "64k",
        }
        variant_dir = os.path.join(output_dir, "source")
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        _encode_hls_variant(
            input_path, variant_dir, playlist_path, settings, "source", use_gpu
        )
        ready_variants.append("source")
        variant_playlists.append(("source", settings))

    # Generate master playlist
    master_path = os.path.join(output_dir, "master.m3u8")
    with open(master_path, "w") as f:
        f.write("#EXTM3U\n")
        f.write("#EXT-X-VERSION:3\n")
        for variant_name, settings in variant_playlists:
            bandwidth = int(settings["video_bitrate"][:-1]) * 1000
            resolution = f"{int(settings['height'] * 16 / 9)}x{settings['height']}"
            f.write(
                f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={resolution}\n"
            )
            f.write(f"{variant_name}/index.m3u8\n")

    return ready_variants


def transcode_audio_hls(input_path: str, output_dir: str) -> list[str]:
    """Transcode audio to HLS variants."""
    print("Transcoding audio to HLS variants...")

    variant_playlists = []

    for variant_name, settings in AUDIO_VARIANTS.items():
        variant_dir = os.path.join(output_dir, variant_name)
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        print(f"Encoding audio {variant_name}...")

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            settings["audio_bitrate"],
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-f",
            "hls",
            "-hls_time",
            str(HLS_SEGMENT_DURATION),
            "-hls_playlist_type",
            "vod",
            "-hls_segment_filename",
            os.path.join(variant_dir, "segment_%03d.ts"),
            playlist_path,
        ]

        run_ffmpeg(cmd, timeout=600, description=f"audio HLS {variant_name}")
        variant_playlists.append((variant_name, settings))

    # Generate master playlist
    master_path = os.path.join(output_dir, "master.m3u8")
    with open(master_path, "w") as f:
        f.write("#EXTM3U\n")
        f.write("#EXT-X-VERSION:3\n")
        for variant_name, settings in variant_playlists:
            bandwidth = int(settings["audio_bitrate"][:-1]) * 1000
            f.write(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth}\n")
            f.write(f"{variant_name}/index.m3u8\n")

    # Report 'audio' as the ready variant (matches hlsVariantSchema enum).
    # Individual bitrate levels (128k/64k) are internal to the master playlist.
    return ["audio"] if variant_playlists else []


def _build_preview_cmd(
    input_path: str,
    preview_dir: str,
    start_time: int,
    preview_duration: int,
    use_gpu: bool,
) -> list[str]:
    """Build ffmpeg command for preview clip."""
    segment_path = os.path.join(preview_dir, "segment_%03d.ts")
    playlist_path = os.path.join(preview_dir, "preview.m3u8")

    if use_gpu:
        return [
            "ffmpeg",
            "-y",
            "-hwaccel",
            "cuda",
            "-ss",
            str(start_time),
            "-i",
            input_path,
            "-t",
            str(preview_duration),
            "-vf",
            f"scale=-2:{PREVIEW_HEIGHT}",
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-f",
            "hls",
            "-hls_time",
            str(HLS_SEGMENT_DURATION),
            "-hls_playlist_type",
            "vod",
            "-hls_segment_filename",
            segment_path,
            playlist_path,
        ]
    return [
        "ffmpeg",
        "-y",
        "-ss",
        str(start_time),
        "-i",
        input_path,
        "-t",
        str(preview_duration),
        "-vf",
        f"scale=-2:{PREVIEW_HEIGHT}",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "hls",
        "-hls_time",
        str(HLS_SEGMENT_DURATION),
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segment_path,
        playlist_path,
    ]


def create_preview(
    input_path: str, output_dir: str, duration: int, use_gpu: bool
) -> None:
    """Create 30-second preview clip at 720p with GPU → CPU fallback."""
    print("Creating preview clip...")

    preview_dir = os.path.join(output_dir, "preview")
    os.makedirs(preview_dir, exist_ok=True)

    start_time = max(0, int(duration * 0.1))
    preview_duration = min(PREVIEW_DURATION, duration - start_time)

    if use_gpu:
        try:
            run_ffmpeg(
                _build_preview_cmd(
                    input_path, preview_dir, start_time, preview_duration, use_gpu=True
                ),
                timeout=120,
                description="preview (GPU)",
            )
            return
        except RuntimeError as e:
            print(f"GPU preview failed, falling back to CPU: {e}")

    run_ffmpeg(
        _build_preview_cmd(
            input_path, preview_dir, start_time, preview_duration, use_gpu=False
        ),
        timeout=120,
        description="preview (CPU)",
    )


def extract_thumbnail(input_path: str, output_path: str, duration: int) -> None:
    """Extract thumbnail at 10% mark."""
    print("Extracting thumbnail...")

    timestamp = max(1, int(duration * 0.1))

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(timestamp),
        "-i",
        input_path,
        "-vframes",
        "1",
        "-q:v",
        "2",
        output_path,
    ]

    run_ffmpeg(cmd, timeout=60, description="thumbnail extraction")


# Allowed thumbnail sizes - must match THUMBNAIL_SIZES in @codex/validation
# Canonical source: packages/validation/src/schemas/transcoding.ts
ALLOWED_THUMBNAIL_SIZES: frozenset[str] = frozenset({"sm", "md", "lg"})


def extract_thumbnail_variants(
    input_path: str,
    output_dir: str,
    duration: int,
    requested_sizes: list[str] | None = None,
) -> dict[str, str]:
    """Extract thumbnail at 10% mark and generate WebP size variants.

    When requested_sizes is None, produces all three (sm/md/lg). Pass
    ['lg'] to produce only the canonical size — the others are unused
    on the frontend today so callers can skip them via feature flag.
    """
    all_sizes = {
        "sm": {"width": 200, "quality": 75, "compression": 6},
        "md": {"width": 400, "quality": 80, "compression": 5},
        "lg": {"width": 800, "quality": 82, "compression": 4},
    }

    if requested_sizes is None:
        sizes = all_sizes
    else:
        sizes = {k: all_sizes[k] for k in requested_sizes if k in all_sizes}
        if not sizes:
            raise ValueError(f"No valid sizes in {requested_sizes}")

    print(f"Extracting thumbnail variants ({'/'.join(sizes.keys())})...")

    timestamp = max(1, int(duration * 0.1))

    for size_name in sizes:
        if size_name not in ALLOWED_THUMBNAIL_SIZES:
            raise ValueError(f"Invalid thumbnail size: {size_name}")

    variants = {}

    for size_name, config in sizes.items():
        output_path = os.path.join(output_dir, f"thumbnail-{size_name}.webp")

        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(timestamp),
            "-i",
            input_path,
            "-vframes",
            "1",
            "-vf",
            f"scale={config['width']}:-1",
            "-c:v",
            "libwebp",
            "-quality",
            str(config["quality"]),
            "-compression_level",
            str(config["compression"]),
            output_path,
        ]

        run_ffmpeg(cmd, timeout=60, description=f"thumbnail {size_name}")
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


def send_webhook(url: str, secret: str, result: dict) -> None:
    """Send signed webhook with retry (3 attempts, exponential backoff).

    On exhaustion, raises RuntimeError so RunPod can retry the entire job.
    """
    max_attempts = 3
    backoff_base = 2

    payload = json.dumps(result)
    timestamp = str(int(time.time()))
    signature = sign_payload(payload, secret, timestamp)
    headers = {
        "Content-Type": "application/json",
        "X-Runpod-Signature": signature,
        "X-Runpod-Timestamp": timestamp,
    }

    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            response = requests.post(url, data=payload, headers=headers, timeout=30)
            response.raise_for_status()
            print(f"Webhook sent successfully (attempt {attempt + 1})")
            return
        except Exception as e:
            last_error = e
            if attempt < max_attempts - 1:
                delay = backoff_base**attempt
                print(
                    f"Webhook attempt {attempt + 1} failed: {e}. Retrying in {delay}s..."
                )
                time.sleep(delay)

    raise RuntimeError(f"Webhook failed after {max_attempts} attempts: {last_error}")


def send_progress(
    url: str, secret: str, job_id: str, step: str, percent: int, media_id: str = ""
) -> None:
    """Send a progress update webhook. Fire-and-forget: failures are logged but don't stop the job."""
    payload_dict: dict[str, Any] = {
        "jobId": job_id,
        "status": "progress",
        "progress": percent,
        "step": step,
    }
    if media_id:
        payload_dict["mediaId"] = media_id
    payload = json.dumps(payload_dict)
    try:
        timestamp = str(int(time.time()))
        signature = sign_payload(payload, secret, timestamp)
        headers = {
            "Content-Type": "application/json",
            "X-Runpod-Signature": signature,
            "X-Runpod-Timestamp": timestamp,
        }
        requests.post(url, data=payload, headers=headers, timeout=5)
    except Exception as e:
        print(f"Progress webhook failed (non-fatal): {e}")


# =============================================================================
# Main Handler
# =============================================================================


def handler(job: dict[str, Any]) -> dict[str, Any]:
    """RunPod serverless handler for transcoding jobs."""
    job_input: JobInput = job["input"]

    media_id = job_input["mediaId"]
    creator_id = job_input["creatorId"]
    media_type = job_input["type"]
    input_key = job_input["inputKey"]

    # --- Input validation ---
    validate_path_component(creator_id, "creatorId")
    validate_path_component(media_id, "mediaId")
    validate_input_key(input_key)
    validate_webhook_url(job_input["webhookUrl"])

    if media_type not in ("video", "audio"):
        raise ValueError(
            f"Invalid media type: '{media_type}'. Must be 'video' or 'audio'."
        )

    print(f"Starting transcoding job for {media_type}: {media_id}")
    print(f"Active features: {FEATURES}")

    # Progress tracking — captured early so steps can report progress
    webhook_url = job_input["webhookUrl"]
    job_id = job.get("id", media_id)

    # --- Environment credentials ---
    b2_endpoint = os.environ.get("B2_ENDPOINT")
    b2_access_key_id = os.environ.get("B2_ACCESS_KEY_ID")
    b2_secret_access_key = os.environ.get("B2_SECRET_ACCESS_KEY")
    b2_bucket_name = os.environ.get("B2_BUCKET_NAME")

    if not all([b2_endpoint, b2_access_key_id, b2_secret_access_key, b2_bucket_name]):
        raise ValueError(
            "B2 credentials not configured in environment. Add secrets in RunPod console."
        )

    r2_endpoint = os.environ.get("R2_ENDPOINT")
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    r2_bucket_name = os.environ.get("R2_BUCKET_NAME")

    if not all([r2_endpoint, r2_access_key_id, r2_secret_access_key, r2_bucket_name]):
        raise ValueError(
            "R2 credentials not configured in environment. Add secrets in RunPod console."
        )

    assets_bucket_name = os.environ.get("ASSETS_BUCKET_NAME")
    if not assets_bucket_name:
        raise ValueError(
            "ASSETS_BUCKET_NAME not configured in environment. Add secret in RunPod console."
        )

    webhook_secret = os.environ.get("WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise ValueError("WEBHOOK_SECRET not configured in environment.")

    # --- Storage clients ---
    r2_client = create_s3_client(r2_endpoint, r2_access_key_id, r2_secret_access_key)
    b2_client = create_s3_client(b2_endpoint, b2_access_key_id, b2_secret_access_key)
    assets_client = create_s3_client(
        r2_endpoint, r2_access_key_id, r2_secret_access_key
    )

    # --- GPU check ---
    use_gpu = check_gpu_available()
    print(f"GPU available: {use_gpu}")

    # --- Processing ---
    work_dir = tempfile.mkdtemp(prefix="transcoding_")
    uploaded_keys: list[tuple[Any, str, str]] = []

    try:
        # Step 1: Download original from R2
        send_progress(webhook_url, webhook_secret, job_id, "downloading", 0, media_id)
        input_ext = os.path.splitext(input_key)[1] or ".mp4"
        input_path = os.path.join(work_dir, f"input{input_ext}")
        download_file(r2_client, r2_bucket_name, input_key, input_path)

        # Step 2: Probe metadata
        send_progress(webhook_url, webhook_secret, job_id, "probing", 5, media_id)
        probe_data = probe_media(input_path)
        duration, width, height = get_media_info(probe_data)
        print(f"Media info: duration={duration}s, width={width}, height={height}")

        if duration <= 0:
            raise ValueError(
                f"Invalid media duration: {duration}s. File may be corrupt or empty."
            )

        validate_streams(probe_data, media_type)

        # Step 3: Create mezzanine → Upload to B2 (gated)
        mezzanine_key = None
        if FEATURES["mezzanine"] and media_type == "video":
            send_progress(webhook_url, webhook_secret, job_id, "mezzanine", 6, media_id)
            mezzanine_path = os.path.join(work_dir, "mezzanine.mp4")
            mezzanine_key = f"{creator_id}/mezzanine/{media_id}/mezzanine.mp4"
            create_mezzanine(input_path, mezzanine_path, use_gpu)
            upload_file(
                b2_client, b2_bucket_name, mezzanine_key, mezzanine_path, "video/mp4"
            )
            uploaded_keys.append((b2_client, b2_bucket_name, mezzanine_key))

        # Step 4: Loudness analysis (gated — stats only, not fed back to encoder)
        loudness_integrated: int | None = None
        loudness_peak: int | None = None
        loudness_range: int | None = None
        if FEATURES["loudness_analysis"]:
            send_progress(webhook_url, webhook_secret, job_id, "loudness", 15, media_id)
            loudness = analyze_loudness(input_path)
            print(f"Loudness: {loudness}")
            loudness_integrated = max(-10000, min(1000, int(loudness["input_i"] * 100)))
            loudness_peak = max(-10000, min(2000, int(loudness["input_tp"] * 100)))
            loudness_range = max(0, min(50000, int(loudness["input_lra"] * 100)))

        # Step 5: Transcode HLS variants
        send_progress(
            webhook_url, webhook_secret, job_id, "encoding_variants", 17, media_id
        )
        hls_dir = os.path.join(work_dir, "hls")
        os.makedirs(hls_dir, exist_ok=True)

        if media_type == "video":
            ready_variants = transcode_video_hls(input_path, hls_dir, height, use_gpu)
        else:
            ready_variants = transcode_audio_hls(input_path, hls_dir)

        # Step 6: Create preview BEFORE uploading HLS dir (preview goes into hls_dir)
        hls_preview_key = None
        preview_generated = False
        if FEATURES["video_preview"] and media_type == "video" and duration > 0:
            send_progress(webhook_url, webhook_secret, job_id, "preview", 72, media_id)
            create_preview(input_path, hls_dir, duration, use_gpu)
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
        send_progress(webhook_url, webhook_secret, job_id, "thumbnails", 77, media_id)
        thumbnail_key = None
        thumbnail_variants = None
        if media_type == "video" and duration > 0:
            requested_sizes = None if FEATURES["thumbnail_variants"] else ["lg"]
            thumbnail_files = extract_thumbnail_variants(
                input_path, work_dir, duration, requested_sizes=requested_sizes
            )

            thumbnail_variants = {}
            for size_name, local_path in thumbnail_files.items():
                r2_key = f"{creator_id}/media-thumbnails/{media_id}/{size_name}.webp"
                upload_file(
                    assets_client, assets_bucket_name, r2_key, local_path, "image/webp"
                )
                uploaded_keys.append((assets_client, assets_bucket_name, r2_key))
                thumbnail_variants[size_name] = r2_key

            thumbnail_key = thumbnail_variants.get("lg")

        # Step 8: Generate waveform (audio only)
        send_progress(
            webhook_url,
            webhook_secret,
            job_id,
            "waveform" if media_type == "audio" else "uploading_outputs",
            80,
            media_id,
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
            "width": width,
            "height": height,
            "readyVariants": ready_variants,
            "loudnessIntegrated": loudness_integrated,
            "loudnessPeak": loudness_peak,
            "loudnessRange": loudness_range,
        }

        # Step 10: Send completion webhook
        send_progress(webhook_url, webhook_secret, job_id, "finalizing", 95, media_id)
        webhook_payload = {
            "jobId": job_id,
            "status": "completed",
            "output": result,
        }
        send_webhook(webhook_url, webhook_secret, webhook_payload)

        return {"status": "success", "mediaId": media_id}

    except Exception as e:
        error_msg = str(e)
        print(f"Transcoding failed: {error_msg}")

        # Clean up any partial uploads
        if uploaded_keys:
            print(f"Cleaning up {len(uploaded_keys)} uploaded files...")
            cleanup_uploaded_keys(uploaded_keys)

        # Send failure webhook (include mediaId so the service can find it even
        # when runpodJobId hasn't been stored yet — common in local /runsync flow)
        try:
            webhook_payload = {
                "jobId": job_id,
                "status": "failed",
                "error": error_msg[:2000],
                "mediaId": media_id,
            }
            send_webhook(webhook_url, webhook_secret, webhook_payload)
        except Exception as webhook_error:
            print(f"Failed to send error webhook: {webhook_error}")
            # Re-raise so RunPod surfaces this as an exception in its error logs
            # rather than a quiet error-dict return. Idempotent retry is safe.
            raise

        return {"status": "error", "error": error_msg}

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# RunPod serverless entry point
runpod.serverless.start({"handler": handler})
