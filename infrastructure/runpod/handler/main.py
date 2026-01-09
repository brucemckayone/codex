"""
RunPod Transcoding Handler

GPU-accelerated media transcoding pipeline for video and audio files.

Pipeline:
1. Download original from R2
2. Probe metadata (ffprobe)
3. Create mezzanine (CRF 18) → Upload to B2
4. Two-pass loudness analysis
5. Transcode HLS variants (1080p/720p/480p/360p)
6. Generate preview (30s at 720p)
7. Extract thumbnail (10% mark)
8. Generate waveform JSON + PNG (audio only)
9. Upload outputs to R2
10. Send signed webhook

FFmpeg Settings:
- GPU: h264_nvenc, preset p4, cq 23
- CPU fallback: libx264, preset fast, crf 23
- HLS: 6s segments, VOD playlist type
- Audio: loudnorm I=-16 TP=-1.5 LRA=11
"""

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
from typing import Any, TypedDict

import boto3
import requests
import runpod

# =============================================================================
# Type Definitions
# =============================================================================


class JobInput(TypedDict):
    """Input payload from RunPod job trigger."""

    mediaId: str
    creatorId: str
    type: str  # 'video' | 'audio'
    inputKey: str  # R2 key for original file
    webhookUrl: str
    webhookSecret: str
    # R2 config (delivery assets)
    r2Endpoint: str
    r2AccessKeyId: str
    r2SecretAccessKey: str
    r2BucketName: str
    # B2 config (mezzanine archival)
    b2Endpoint: str
    b2AccessKeyId: str
    b2SecretAccessKey: str
    b2BucketName: str


class TranscodingResult(TypedDict):
    """Result payload sent via webhook."""

    status: str  # 'completed' | 'failed'
    mediaId: str
    hlsMasterPlaylistKey: str | None
    hlsPreviewKey: str | None
    thumbnailKey: str | None
    waveformKey: str | None
    waveformImageKey: str | None
    mezzanineKey: str | None
    durationSeconds: int | None
    width: int | None
    height: int | None
    readyVariants: list[str]
    error: str | None


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
    result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
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


def check_gpu_available() -> bool:
    """Check if NVIDIA GPU encoder is available."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return "h264_nvenc" in result.stdout
    except Exception:
        return False


# =============================================================================
# Transcoding Functions
# =============================================================================


def create_mezzanine(input_path: str, output_path: str, use_gpu: bool) -> None:
    """Create high-quality mezzanine file (CRF 18 for archival)."""
    print("Creating mezzanine (CRF 18)...")

    if use_gpu:
        # GPU encoding
        cmd = [
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
    else:
        # CPU encoding
        cmd = [
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

    subprocess.run(cmd, check=True, timeout=3600)  # 1 hour timeout


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
        # Find JSON block in output
        json_start = output.rfind("{")
        json_end = output.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            loudness_data = json.loads(output[json_start:json_end])
            return {
                "input_i": float(loudness_data.get("input_i", -16)),
                "input_tp": float(loudness_data.get("input_tp", -1)),
                "input_lra": float(loudness_data.get("input_lra", 7)),
            }
    except (json.JSONDecodeError, ValueError):
        pass

    return {"input_i": -16, "input_tp": -1, "input_lra": 7}


def transcode_video_hls(
    input_path: str,
    output_dir: str,
    source_height: int | None,
    use_gpu: bool,
) -> list[str]:
    """Transcode video to multi-quality HLS variants."""
    print("Transcoding video to HLS variants...")

    ready_variants = []
    variant_playlists = []

    for variant_name, settings in HLS_VARIANTS.items():
        # Skip variants higher than source resolution
        if source_height and settings["height"] > source_height:
            print(
                f"Skipping {variant_name} (source height {source_height} < {settings['height']})"
            )
            continue

        variant_dir = os.path.join(output_dir, variant_name)
        os.makedirs(variant_dir, exist_ok=True)
        playlist_path = os.path.join(variant_dir, "index.m3u8")

        print(f"Encoding {variant_name}...")

        if use_gpu:
            cmd = [
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
                os.path.join(variant_dir, "segment_%03d.ts"),
                playlist_path,
            ]
        else:
            cmd = [
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
                os.path.join(variant_dir, "segment_%03d.ts"),
                playlist_path,
            ]

        subprocess.run(cmd, check=True, timeout=3600)  # 1 hour per variant
        ready_variants.append(variant_name)
        variant_playlists.append((variant_name, settings))

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

    ready_variants = []
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
            "-vn",  # No video
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

        subprocess.run(cmd, check=True, timeout=600)
        ready_variants.append(variant_name)
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

    return ready_variants


def create_preview(
    input_path: str, output_dir: str, duration: int, use_gpu: bool
) -> None:
    """Create 30-second preview clip at 720p."""
    print("Creating preview clip...")

    preview_dir = os.path.join(output_dir, "preview")
    os.makedirs(preview_dir, exist_ok=True)

    # Calculate start time (10% into the video, but at least 0)
    start_time = max(0, int(duration * 0.1))
    preview_duration = min(PREVIEW_DURATION, duration - start_time)

    if use_gpu:
        cmd = [
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
            os.path.join(preview_dir, "segment_%03d.ts"),
            os.path.join(preview_dir, "preview.m3u8"),
        ]
    else:
        cmd = [
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
            os.path.join(preview_dir, "segment_%03d.ts"),
            os.path.join(preview_dir, "preview.m3u8"),
        ]

    subprocess.run(cmd, check=True, timeout=120)


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

    subprocess.run(cmd, check=True, timeout=60)


def generate_waveform(input_path: str, json_path: str, image_path: str) -> None:
    """Generate audio waveform data and image using audiowaveform."""
    print("Generating audio waveform...")

    # Generate JSON waveform data
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
    subprocess.run(cmd_json, check=True, timeout=120)

    # Generate PNG waveform image
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
    subprocess.run(cmd_png, check=True, timeout=120)


# =============================================================================
# Webhook
# =============================================================================


def sign_payload(payload: str, secret: str) -> str:
    """Generate HMAC-SHA256 signature for webhook payload."""
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def send_webhook(url: str, secret: str, result: TranscodingResult) -> None:
    """Send signed webhook to notify completion."""
    print(f"Sending webhook to {url}...")

    payload = json.dumps(result)
    signature = sign_payload(payload, secret)

    response = requests.post(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Runpod-Signature": signature,
        },
        timeout=30,
    )

    print(f"Webhook response: {response.status_code}")
    response.raise_for_status()


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

    print(f"Starting transcoding job for {media_type}: {media_id}")

    # Initialize storage clients
    r2_client = create_s3_client(
        job_input["r2Endpoint"],
        job_input["r2AccessKeyId"],
        job_input["r2SecretAccessKey"],
    )
    b2_client = create_s3_client(
        job_input["b2Endpoint"],
        job_input["b2AccessKeyId"],
        job_input["b2SecretAccessKey"],
    )

    # Check GPU availability
    use_gpu = check_gpu_available()
    print(f"GPU available: {use_gpu}")

    # Create temp directory for processing
    work_dir = tempfile.mkdtemp(prefix="transcoding_")

    try:
        # Step 1: Download original from R2
        input_ext = os.path.splitext(input_key)[1] or ".mp4"
        input_path = os.path.join(work_dir, f"input{input_ext}")
        download_file(r2_client, job_input["r2BucketName"], input_key, input_path)

        # Step 2: Probe metadata
        probe_data = probe_media(input_path)
        duration, width, height = get_media_info(probe_data)
        print(f"Media info: duration={duration}s, width={width}, height={height}")

        # Step 3: Create mezzanine → Upload to B2
        mezzanine_path = os.path.join(work_dir, "mezzanine.mp4")
        mezzanine_key = f"{creator_id}/mezzanine/{media_id}/mezzanine.mp4"

        if media_type == "video":
            create_mezzanine(input_path, mezzanine_path, use_gpu)
            upload_file(
                b2_client,
                job_input["b2BucketName"],
                mezzanine_key,
                mezzanine_path,
                "video/mp4",
            )
        else:
            mezzanine_key = None  # No mezzanine for audio-only

        # Step 4: Loudness analysis
        loudness = analyze_loudness(input_path)
        print(f"Loudness: {loudness}")

        # Step 5: Transcode HLS variants
        hls_dir = os.path.join(work_dir, "hls")
        os.makedirs(hls_dir, exist_ok=True)

        if media_type == "video":
            ready_variants = transcode_video_hls(input_path, hls_dir, height, use_gpu)
        else:
            ready_variants = transcode_audio_hls(input_path, hls_dir)

        # Upload HLS to R2
        hls_prefix = f"{creator_id}/hls/{media_id}/"
        upload_directory(r2_client, job_input["r2BucketName"], hls_prefix, hls_dir)
        hls_master_key = f"{hls_prefix}master.m3u8"
        hls_preview_key = (
            f"{hls_prefix}preview/preview.m3u8" if media_type == "video" else None
        )

        # Step 6: Create preview (video only)
        if media_type == "video" and duration > 0:
            create_preview(input_path, hls_dir, duration, use_gpu)
            # Preview is already in hls_dir, uploaded above

        # Step 7: Extract thumbnail (video only)
        thumbnail_key = None
        if media_type == "video" and duration > 0:
            thumbnail_path = os.path.join(work_dir, "thumbnail.jpg")
            extract_thumbnail(input_path, thumbnail_path, duration)
            thumbnail_key = f"{creator_id}/thumbnails/{media_id}/auto-generated.jpg"
            upload_file(
                r2_client,
                job_input["r2BucketName"],
                thumbnail_key,
                thumbnail_path,
                "image/jpeg",
            )

        # Step 8: Generate waveform (audio only)
        waveform_key = None
        waveform_image_key = None
        if media_type == "audio":
            waveform_json_path = os.path.join(work_dir, "waveform.json")
            waveform_png_path = os.path.join(work_dir, "waveform.png")
            generate_waveform(input_path, waveform_json_path, waveform_png_path)

            waveform_key = f"{creator_id}/waveforms/{media_id}/waveform.json"
            waveform_image_key = f"{creator_id}/waveforms/{media_id}/waveform.png"
            upload_file(
                r2_client,
                job_input["r2BucketName"],
                waveform_key,
                waveform_json_path,
                "application/json",
            )
            upload_file(
                r2_client,
                job_input["r2BucketName"],
                waveform_image_key,
                waveform_png_path,
                "image/png",
            )

        # Build result
        result: TranscodingResult = {
            "status": "completed",
            "mediaId": media_id,
            "hlsMasterPlaylistKey": hls_master_key,
            "hlsPreviewKey": hls_preview_key,
            "thumbnailKey": thumbnail_key,
            "waveformKey": waveform_key,
            "waveformImageKey": waveform_image_key,
            "mezzanineKey": mezzanine_key,
            "durationSeconds": duration,
            "width": width,
            "height": height,
            "readyVariants": ready_variants,
            "error": None,
        }

        # Step 10: Send webhook
        send_webhook(job_input["webhookUrl"], job_input["webhookSecret"], result)

        return {"status": "success", "mediaId": media_id}

    except Exception as e:
        error_msg = str(e)
        print(f"Transcoding failed: {error_msg}")

        # Send failure webhook
        result: TranscodingResult = {
            "status": "failed",
            "mediaId": media_id,
            "hlsMasterPlaylistKey": None,
            "hlsPreviewKey": None,
            "thumbnailKey": None,
            "waveformKey": None,
            "waveformImageKey": None,
            "mezzanineKey": None,
            "durationSeconds": None,
            "width": None,
            "height": None,
            "readyVariants": [],
            "error": error_msg[:2000],  # Cap at 2KB
        }

        try:
            send_webhook(job_input["webhookUrl"], job_input["webhookSecret"], result)
        except Exception as webhook_error:
            print(f"Failed to send error webhook: {webhook_error}")

        return {"status": "error", "error": error_msg}

    finally:
        # Cleanup temp directory
        shutil.rmtree(work_dir, ignore_errors=True)


# RunPod serverless entry point
runpod.serverless.start({"handler": handler})
