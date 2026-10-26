"""Container verification: real QuickTime sources through the real encoders.

Runs inside the production image (its ffmpeg 4.4.2) in runpod-ci.yml, and
locally against any ffmpeg >= 4.4. The sources are generated here, so no video
is committed. For each one it encodes the HLS ladder, the preview and the
sized posters with the handler's own functions, then checks every output with
ffprobe (Codex-l2c48.8):

- every video stream is H.264 High, yuv420p (browsers play nothing else);
- an HDR source (HLG, PQ) comes out tone-mapped, tagged BT.709, and no
  output of an SDR source is tagged HDR;
- every audio stream is 48 kHz;
- each rung's short side is its name (a portrait 720p is 720x1280), and no
  rung or preview is larger than the source;
- the master playlist's RESOLUTION is each rung's real size, with CODECS;
- each poster is webp, min(nominal, picture width) wide, picture-shaped;
- the ladder's progress, read from ffmpeg's -progress file, rises to the end.

Exit status 1 on any failure.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
sys.modules.setdefault("runpod", MagicMock())

from handler import main as h  # noqa: E402


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def ffmpeg_major() -> int:
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
    match = re.search(r"ffmpeg version n?(\d+)", out)
    return int(match.group(1)) if match else 0


def make_sources(work: str) -> dict:
    """name -> (path, has_audio, picture (w, h)). Mirrors the 2026-10-23
    QuickTime harness: what iPhones, Macs and editors actually hand over."""

    def p(name):
        return os.path.join(work, f"{name}.mov")

    tone = ["-f", "lavfi", "-i", "sine=f=440:d=4:sample_rate=96000"]
    sources = {}

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:d=4:r=30",
        *tone,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-timecode",
        "01:00:00:00",
        p("h264_timecode"),
    )
    sources["h264_timecode"] = (p("h264_timecode"), True, (1920, 1080))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=2880x1800:d=4:r=30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        p("screen_no_audio"),
    )
    sources["screen_no_audio"] = (p("screen_no_audio"), False, (2880, 1800))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:d=4:r=30",
        *tone,
        "-c:v",
        "libx265",
        "-x265-params",
        "log-level=error",
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        "arib-std-b67",
        "-colorspace",
        "bt2020nc",
        "-c:a",
        "aac",
        p("hevc10_hlg"),
    )
    sources["hevc10_hlg"] = (p("hevc10_hlg"), True, (1920, 1080))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:d=4:r=30",
        "-c:v",
        "libx265",
        "-x265-params",
        "log-level=error",
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        "smpte2084",
        "-colorspace",
        "bt2020nc",
        p("hevc10_pq"),
    )
    sources["hevc10_pq"] = (p("hevc10_pq"), False, (1920, 1080))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:d=4:r=30",
        *tone,
        "-c:v",
        "prores_ks",
        "-profile:v",
        "2",
        "-pix_fmt",
        "yuv422p10le",
        "-c:a",
        "pcm_s24le",
        p("prores422"),
    )
    sources["prores422"] = (p("prores422"), True, (1920, 1080))

    landscape = os.path.join(work, "landscape.mp4")
    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:d=4:r=30",
        *tone,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        landscape,
    )
    if ffmpeg_major() >= 6:
        ffmpeg("-display_rotation", "90", "-i", landscape, "-c", "copy", p("portrait"))
    else:  # 4.4/5.x write the legacy tag as a display matrix
        ffmpeg(
            "-i", landscape, "-c", "copy", "-metadata:s:v:0", "rotate=90", p("portrait")
        )
    sources["portrait"] = (p("portrait"), True, (1080, 1920))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=352x240:d=4:r=30",
        *tone,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv444p",
        "-c:a",
        "aac",
        p("small_444"),
    )
    sources["small_444"] = (p("small_444"), True, (352, 240))

    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1280x720:d=1.2:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=d=1.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        p("short_1_2s"),
    )
    sources["short_1_2s"] = (p("short_1_2s"), True, (1280, 720))
    return sources


def streams(path: str) -> list:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,profile,pix_fmt,width,height,sample_rate,"
            "color_transfer,color_primaries",
            "-of",
            "json",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(out)["streams"]


HDR = ("smpte2084", "arib-std-b67")


def check_encode(path: str, has_audio: bool, hdr: bool, problems: list, what: str):
    """The shape of one encoded stream.ts; returns its (w, h)."""
    found = {s["codec_type"]: s for s in streams(path)}
    video = found.get("video", {})
    colour = (video.get("color_transfer"), video.get("color_primaries"))
    if (hdr and colour != ("bt709", "bt709")) or colour[0] in HDR:
        problems.append(f"{what}: tagged {colour}")
    if (video.get("codec_name"), video.get("profile"), video.get("pix_fmt")) != (
        "h264",
        "High",
        "yuv420p",
    ):
        problems.append(
            f"{what}: video {video.get('codec_name')} {video.get('profile')} {video.get('pix_fmt')}"
        )
    audio = found.get("audio")
    if has_audio and (audio is None or audio.get("sample_rate") != "48000"):
        problems.append(f"{what}: audio {audio and audio.get('sample_rate')}")
    return video.get("width"), video.get("height")


def verify(name, path, has_audio, picture, work, problems):
    out = os.path.join(work, f"out_{name}")
    os.makedirs(out)
    probe = h.probe_media(path)
    duration, width, height = h.get_media_info(probe)
    tonemap = h.tonemap_filter(probe)
    hdr = name.startswith("hevc10_")
    if (tonemap is not None) != hdr:
        problems.append(f"{name}: tone-map {'missing' if hdr else 'unwanted'}")
    if (width, height) != picture:
        problems.append(
            f"{name}: reported {width}x{height}, picture is {picture[0]}x{picture[1]}"
        )
    short = min(width, height)

    heard: list = []
    rungs = h.transcode_video_hls(
        path, out, short, False, tonemap, duration, on_progress=heard.append
    )
    if not heard or heard != sorted(heard) or heard[-1] < 0.95:
        problems.append(f"{name}: ladder progress {heard}")
    master = open(os.path.join(out, "master.m3u8")).read()
    for rung in rungs:
        w, hgt = check_encode(
            os.path.join(out, rung, "stream.ts"),
            has_audio,
            hdr,
            problems,
            f"{name} {rung}",
        )
        expected_short = int(rung[:-1]) if rung.endswith("p") else h.even_floor(short)
        if (
            min(w, hgt) != expected_short
            or max(w, hgt) > max(picture)
            or (w > hgt) != (picture[0] > picture[1])
        ):
            problems.append(f"{name} {rung}: {w}x{hgt}")
        tag = re.search(rf"#EXT-X-STREAM-INF:([^\n]*)\n{rung}/index\.m3u8", master)
        attrs = tag.group(1) if tag else ""
        if f"RESOLUTION={w}x{hgt}" not in attrs or 'CODECS="avc1.64' not in attrs:
            problems.append(f"{name} {rung}: master says {attrs!r}")

    if duration > 0:
        h.create_preview(path, out, duration, False, short, tonemap)
        w, hgt = check_encode(
            os.path.join(out, "preview", "stream.ts"),
            has_audio,
            hdr,
            problems,
            f"{name} preview",
        )
        if min(w, hgt) > min(720, short):
            problems.append(f"{name} preview upscaled: {w}x{hgt}")

    posters = h.extract_thumbnail_variants(
        path, out, max(duration, 1), list(h.POSTER_SIZES), tonemap
    )
    for size, poster in posters.items():
        [s] = streams(poster)
        expected_w = min(h.POSTER_SIZES[size]["width"], width)
        if (
            s["codec_name"] != "webp"
            or s["width"] != expected_w
            or abs(s["width"] / s["height"] - width / height) > 0.02
        ):
            problems.append(
                f"{name} poster {size}: {s['codec_name']} {s['width']}x{s['height']}"
            )
    print(f"  {name:16} {width}x{height}  rungs {rungs}")


def main() -> int:
    print(f"ffmpeg major version {ffmpeg_major()}")
    problems: list = []
    with tempfile.TemporaryDirectory(prefix="qt_verify_") as work:
        for name, (path, has_audio, picture) in make_sources(work).items():
            try:
                verify(name, path, has_audio, picture, work, problems)
            except Exception as error:  # report every source, not just the first
                problems.append(f"{name}: {type(error).__name__}: {error}")
    if problems:
        print("FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("All QuickTime sources produce playable, truthfully described outputs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
