"""Every encode a browser plays: 8-bit 4:2:0 H.264 High, 48 kHz AAC (Codex-l2c48.8).

On prod's ffmpeg 4.4.2, without these an iPhone HEVC 10-bit clip came out
H.264 High 10, ProRes High 4:2:2, a 4:4:4 source High 4:4:4 (all `ready`, none
playable), and loudnorm's 192 kHz reached AAC as 96 kHz.
"""

from unittest.mock import MagicMock, patch

import pytest
from _jobs import video_cmds

from handler import main as handler_module


def _value(cmd: list[str], flag: str) -> str:
    assert flag in cmd, f"{flag} missing from {' '.join(cmd)}"
    return cmd[cmd.index(flag) + 1]


@pytest.mark.parametrize("use_gpu", [True, False], ids=["nvenc", "libx264"])
@pytest.mark.parametrize("name", ["mezzanine", "variant", "preview"])
class TestVideoEncodes:
    def test_converts_to_8_bit_420_after_scaling(self, name, use_gpu):
        filters = _value(video_cmds(use_gpu)[name], "-vf").split(",")
        assert filters[-1] == "format=yuv420p"

    def test_encodes_high_profile(self, name, use_gpu):
        assert _value(video_cmds(use_gpu)[name], "-profile:v") == "high"

    def test_profile_follows_the_video_codec(self, name, use_gpu):
        cmd = video_cmds(use_gpu)[name]
        assert cmd.index("-profile:v") == cmd.index("-c:v") + 2

    def test_audio_is_48_khz(self, name, use_gpu):
        assert _value(video_cmds(use_gpu)[name], "-ar") == "48000"


@pytest.mark.parametrize("rung", list(handler_module.AUDIO_VARIANTS))
def test_audio_only_rungs_are_48_khz(rung):
    cmd = handler_module._build_audio_hls_cmd(
        "in.m4a",
        f"/out/{rung}",
        f"/out/{rung}/index.m3u8",
        handler_module.AUDIO_VARIANTS[rung],
    )
    assert _value(cmd, "-ar") == "48000"
    assert "-vn" in cmd
    assert _value(cmd, "-hls_flags") == "single_file"


def test_loudness_reads_the_audio_only():
    """Without -vn the null output decodes every video frame as well: 12x
    slower on a 4K HEVC source, enough to reach the analysis's timeout."""
    with patch("subprocess.run", return_value=MagicMock(stderr="")) as run:
        handler_module.analyze_loudness("in.mov")
    cmd = run.call_args.args[0]
    assert {"-vn", "-sn", "-dn"} <= set(cmd)
    assert cmd.index("-vn") > cmd.index("-i")
