"""What the container checks share: the handler imported without the RunPod
SDK, a quiet ffmpeg, an iPhone-like HEVC encoder, and one way to report.

The checks run as scripts (`python3 tests/integration/verify_*.py`), so this
directory is on sys.path and they import it by name.
"""

import os
import subprocess
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
sys.modules.setdefault("runpod", MagicMock())

from handler import main as handler  # noqa: E402


def ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def hevc10(transfer: str | None = None) -> list[str]:
    """10-bit HEVC as an iPhone records it, made fast. An HDR `transfer`
    goes in the bitstream through x265's own parameters: ffmpeg 7's
    -color_trc alone comes back `unknown`, and the check would see SDR."""
    params = "log-level=error"
    if transfer:
        params += f":colorprim=bt2020:transfer={transfer}:colormatrix=bt2020nc"
    return [
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-x265-params",
        params,
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
    ]


def report(problems: list[str], passed: str) -> int:
    """Print the outcome; the exit status for the script."""
    if problems:
        print("FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(passed)
    return 0


__all__ = ["ffmpeg", "handler", "hevc10", "report"]
