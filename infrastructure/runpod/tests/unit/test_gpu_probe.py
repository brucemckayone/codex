"""The NVENC probe that decides whether a job encodes on the GPU or the CPU.

Every production job logged "GPU available: False" on a GPU worker (an RTX PRO
6000 Blackwell MIG 1g.24gb slice, which has its own NVENC), because the probe
encoded a 16x16 frame and NVENC's driver refuses frames under its minimum
(144x144 fails and 145x145 opens, FFmpeg trac #9251). Codex-dlzgf.
"""

import re
import subprocess
from unittest.mock import MagicMock, patch

from handler.main import check_gpu_available

# The smallest frame NVENC was seen to open (FFmpeg trac #9251).
NVENC_REPORTED_MINIMUM = 145


def _probe(returncode: int = 0, stderr: str = "") -> MagicMock:
    return MagicMock(returncode=returncode, stderr=stderr)


class TestTheProbeFrame:
    def test_is_at_least_the_size_nvenc_opens(self):
        with patch("subprocess.run", return_value=_probe()) as run:
            check_gpu_available()

        cmd = run.call_args.args[0]
        source = cmd[cmd.index("-i") + 1]
        size = re.search(r"s=(\d+)x(\d+)", source)
        assert size, source
        assert min(int(size[1]), int(size[2])) >= NVENC_REPORTED_MINIMUM
        assert cmd[cmd.index("-c:v") + 1] == "h264_nvenc"


class TestTheAnswer:
    def test_an_encoder_that_opens_is_a_yes(self, capsys):
        with patch("subprocess.run", return_value=_probe()):
            assert check_gpu_available() is True
        assert "GPU probe" not in capsys.readouterr().out

    def test_a_refusal_is_a_no_that_says_why(self, capsys):
        refusal = (
            "[h264_nvenc @ 0x55a8] InitializeEncoder failed: invalid param (8): "
            "Frame Dimension less than the minimum supported value."
        )
        with patch("subprocess.run", return_value=_probe(1, refusal + "\n")):
            assert check_gpu_available() is False
        out = capsys.readouterr().out
        assert "GPU probe failed (exit 1)" in out
        assert "Frame Dimension less than the minimum" in out

    def test_a_silent_refusal_still_says_so(self, capsys):
        with patch("subprocess.run", return_value=_probe(1, "")):
            assert check_gpu_available() is False
        assert "GPU probe failed (exit 1): no output" in capsys.readouterr().out

    def test_a_long_refusal_keeps_its_last_lines(self, capsys):
        stderr = "noise\n" * 200 + "Cannot load libcuda.so.1"
        with patch("subprocess.run", return_value=_probe(1, stderr)):
            check_gpu_available()
        out = capsys.readouterr().out
        assert out.rstrip().endswith("Cannot load libcuda.so.1")
        assert len(out) < 700

    def test_a_probe_that_hangs_is_a_no(self, capsys):
        hang = subprocess.TimeoutExpired(cmd="ffmpeg", timeout=10)
        with patch("subprocess.run", side_effect=hang):
            assert check_gpu_available() is False
        assert "GPU probe could not run: TimeoutExpired" in capsys.readouterr().out

    def test_no_ffmpeg_is_a_no(self, capsys):
        with patch("subprocess.run", side_effect=FileNotFoundError("ffmpeg")):
            assert check_gpu_available() is False
        assert "GPU probe could not run: FileNotFoundError" in capsys.readouterr().out
