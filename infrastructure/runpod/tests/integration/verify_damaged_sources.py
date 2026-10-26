"""Container verification: damaged sources through the real decoders.

Runs inside the production image (its ffmpeg 4.4.2) in runpod-ci.yml, and
locally against any ffmpeg >= 4.4. Each source is made here from a healthy
one, then taken through the handler's own probe, ladder, preview and poster
functions, and must end as listed in EXPECTED: either complete, with a
picture in every rung, or fail with the code the creator's tile is worded
from (owner's choice 2026-10-26: decode past damaged frames, but a file that
can't be read at all still fails; Codex-l2c48.8).

Exit status 1 on any mismatch.
"""

import json
import os
import random
import subprocess
import sys
import tempfile
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
sys.modules.setdefault("runpod", MagicMock())

from handler import main as h  # noqa: E402

COMPLETES = "completes"

# name -> (media type, outcome)
EXPECTED = {
    "healthy": ("video", COMPLETES),
    # The last 4 KB gone: a copy that broke at the end.
    "truncated_tail": ("video", COMPLETES),
    # 36 scattered 512-byte holes.
    "scrambled": ("video", COMPLETES),
    # Every audio packet scrambled under a perfect 10 fps picture: past
    # ffmpeg's 2/3 error rate (exit 69) without TOLERANT_DECODE.
    "low_fps_broken_audio": ("video", COMPLETES),
    # Every video packet scrambled: exits 0 with the audio alone.
    "no_decodable_picture": ("video", h.TranscodeErrorCode.CORRUPT_INPUT),
    # The index (moov) is at the end, and the end is gone.
    "moov_lost": ("video", h.TranscodeErrorCode.CORRUPT_INPUT),
    # Audio is the whole content, and none of it decodes: exit 69.
    "broken_audio_only": ("audio", h.TranscodeErrorCode.CORRUPT_INPUT),
}


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def scramble_packets(src: str, dst: str, codec_type: str) -> None:
    """Overwrite the payload of every `codec_type` packet (its first 2 bytes
    kept), found by ffprobe's packet offsets."""
    probe = json.loads(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "packet=stream_index,pos,size:stream=index,codec_type",
                "-of",
                "json",
                src,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    wanted = {s["index"] for s in probe["streams"] if s["codec_type"] == codec_type}
    data = bytearray(open(src, "rb").read())
    noise = random.Random(7)
    for packet in probe["packets"]:
        if packet["stream_index"] in wanted and packet.get("pos", "N/A") != "N/A":
            start = int(packet["pos"])
            for i in range(start + 2, start + int(packet["size"])):
                data[i] = noise.randint(0, 255)
    open(dst, "wb").write(bytes(data))


def scramble_regions(src: str, dst: str, count: int, span: int) -> None:
    data = bytearray(open(src, "rb").read())
    noise = random.Random(42)
    for k in range(count):
        start = int(len(data) * (0.1 + 0.85 * k / count))
        for i in range(start, min(len(data), start + span)):
            data[i] = noise.randint(0, 255)
    open(dst, "wb").write(bytes(data))


def make_sources(work: str) -> dict:
    def p(name, ext="mp4"):
        return os.path.join(work, f"{name}.{ext}")

    picture = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    sound = ["-c:a", "aac", "-b:a", "64k"]
    lavfi_tone = ["-f", "lavfi", "-i", "sine=d=8:f=440:sample_rate=48000"]

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=d=8:s=640x360:r=24",
        *lavfi_tone,
        *picture,
        *sound,
        "-movflags",
        "+faststart",
        p("healthy"),
    )
    data = open(p("healthy"), "rb").read()
    open(p("truncated_tail"), "wb").write(data[:-4096])
    scramble_regions(p("healthy"), p("scrambled"), 36, 512)

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=d=8:s=640x360:r=10",
        *lavfi_tone,
        *picture,
        *sound,
        "-movflags",
        "+faststart",
        p("low_fps"),
    )
    scramble_packets(p("low_fps"), p("low_fps_broken_audio"), "audio")

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=d=8:s=1280x720:r=30",
        *lavfi_tone,
        "-c:v",
        "libx265",
        "-x265-params",
        "log-level=error",
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
        *sound,
        "-movflags",
        "+faststart",
        p("hevc", "mov"),
    )
    scramble_packets(p("hevc", "mov"), p("no_decodable_picture", "mov"), "video")

    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=d=8:s=640x360:r=24", *picture, p("moov_at_end")
    )
    data = open(p("moov_at_end"), "rb").read()
    open(p("moov_lost"), "wb").write(data[:-4096])

    ffmpeg(*lavfi_tone, *sound, p("audio_only", "m4a"))
    scramble_packets(p("audio_only", "m4a"), p("broken_audio_only", "m4a"), "audio")

    return {
        "healthy": p("healthy"),
        "truncated_tail": p("truncated_tail"),
        "scrambled": p("scrambled"),
        "low_fps_broken_audio": p("low_fps_broken_audio"),
        "no_decodable_picture": p("no_decodable_picture", "mov"),
        "moov_lost": p("moov_lost"),
        "broken_audio_only": p("broken_audio_only", "m4a"),
    }


def outcome(path: str, media_type: str, work: str) -> str:
    """Run the handler's own steps on `path`; COMPLETES, or the error code."""
    out = tempfile.mkdtemp(dir=work)
    try:
        probe = h.probe_media(path)
        duration, width, height = h.get_media_info(probe)
        h.validate_streams(probe, media_type)
        if media_type == "audio":
            h.transcode_audio_hls(path, out)
            return COMPLETES
        short = min(width, height)
        tonemap = h.tonemap_filter(probe)
        h.transcode_video_hls(path, out, short, False, tonemap, duration)
        h.create_preview(path, out, duration, False, short, tonemap)
        h.extract_thumbnail_variants(path, out, duration, ["sm"], tonemap)
        return COMPLETES
    except Exception as error:
        return h.error_code_of(error)


def main() -> int:
    problems = []
    with tempfile.TemporaryDirectory(prefix="damaged_") as work:
        sources = make_sources(work)
        for name, (media_type, expected) in EXPECTED.items():
            got = outcome(sources[name], media_type, work)
            print(f"  {name:22} {media_type}: {got}")
            if got != expected:
                problems.append(f"{name}: {got}, expected {expected}")
    if problems:
        print("FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("Damaged sources complete, or fail as damaged, as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
