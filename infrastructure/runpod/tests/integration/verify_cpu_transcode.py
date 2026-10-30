import os
import sys
import subprocess

# Add /app to python path (Docker workdir)
sys.path.append("/app")

# Mock runpod to avoid import side-effects (checking for test_input.json)
from unittest.mock import MagicMock

sys.modules["runpod"] = MagicMock()

from handler import main as handler_module

TEST_ASSETS_DIR = "/app/tests/assets"
OUTPUT_DIR = "/app/tests/output"


def verify_ffmpeg():
    print("Verifying FFmpeg...")
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ FFmpeg not found or error")
        sys.exit(1)
    print("✅ FFmpeg found")


def verify_audiowaveform():
    print("Verifying audiowaveform...")
    result = subprocess.run(["audiowaveform", "-v"], capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ audiowaveform not found or error")
        sys.exit(1)
    print("✅ audiowaveform found")


def create_dummy_video(path):
    print(f"Creating dummy video at {path}...")
    # Generate 1s test video with lavfi
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1:size=1280x720:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:duration=1",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        path,
    ]
    subprocess.run(cmd, check=True)


def test_transcode_function():
    print("Testing internal transcode logic (CPU)...")

    # Ensure Test Dirs
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(TEST_ASSETS_DIR, exist_ok=True)

    input_path = os.path.join(TEST_ASSETS_DIR, "test_video.mp4")
    if not os.path.exists(input_path):
        create_dummy_video(input_path)

    # Test 1: HLS Transcoding
    # We call the internal function directly to avoid mocking S3 downloads/uploads here
    # We just want to ensure ffmpeg works inside the container

    try:
        # Mocking check_gpu to force CPU
        handler_module.check_gpu_available = lambda: False

        print("Running create_mezzanine...")
        mezz_out = os.path.join(OUTPUT_DIR, "mezz.mp4")
        handler_module.create_mezzanine(input_path, mezz_out, use_gpu=False)

        if not os.path.exists(mezz_out):
            raise Exception("Mezzanine file not created")

        print("Running transcode_video_hls...")
        hls_dir = os.path.join(OUTPUT_DIR, "hls")
        os.makedirs(hls_dir, exist_ok=True)
        # The dummy source is 1280x720: the ladder keys on the short side.
        handler_module.transcode_video_hls(
            input_path, hls_dir, source_short_side=720, use_gpu=False
        )

        if not os.path.exists(os.path.join(hls_dir, "master.m3u8")):
            raise Exception("Master playlist not created")

        # Single-file HLS (Codex-bpjg5): each variant must be ONE stream.ts
        # addressed by #EXT-X-BYTERANGE, so the proxy presigns one URL per variant.
        import glob

        for variant in ("720p", "480p"):
            vdir = os.path.join(hls_dir, variant)
            ts_files = glob.glob(os.path.join(vdir, "*.ts"))
            if len(ts_files) != 1 or not ts_files[0].endswith("stream.ts"):
                names = [os.path.basename(t) for t in ts_files]
                raise Exception(f"{variant}: expected one stream.ts, got {names}")
            with open(os.path.join(vdir, "index.m3u8")) as pl:
                playlist = pl.read()
            if "#EXT-X-BYTERANGE" not in playlist:
                raise Exception(f"{variant}: playlist missing #EXT-X-BYTERANGE")

        print("✅ Single-file HLS verified (one stream.ts + byte-range per variant)")

        # Audio preview (Codex-hro3u): 30s from the 10% mark, audio only.
        print("Running create_audio_preview...")
        audio_path = os.path.join(TEST_ASSETS_DIR, "test_audio.m4a")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=40",
                "-ac",
                "2",
                audio_path,
            ],
            check=True,
        )
        audio_dir = os.path.join(OUTPUT_DIR, "audio-hls")
        handler_module.create_audio_preview(audio_path, audio_dir, 40)
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,sample_rate",
                "-of",
                "json",
                os.path.join(audio_dir, "preview", "stream.ts"),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        import json

        found = json.loads(probe.stdout)
        streams = [
            (s["codec_type"], s["codec_name"], s.get("sample_rate"))
            for s in found["streams"]
        ]
        if streams != [("audio", "aac", "48000")]:
            raise Exception(
                f"audio preview: expected one 48 kHz AAC stream, got {streams}"
            )
        seconds = float(found["format"]["duration"])
        if abs(seconds - 30) > 0.5:
            raise Exception(f"audio preview: expected 30s, got {seconds:.2f}s")
        print("✅ Audio preview verified (30s, audio-only 48 kHz AAC)")

        print("✅ CPU Transcode successful")

    except Exception as e:
        print(f"❌ Transcode failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    print("=== Starting Container Verification ===")
    verify_ffmpeg()
    verify_audiowaveform()
    test_transcode_function()
    print("=== All Tests Passed ===")
    sys.exit(0)
