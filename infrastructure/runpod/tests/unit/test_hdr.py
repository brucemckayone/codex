"""HDR sources are tone-mapped to SDR BT.709 (Codex-l2c48.8).

On prod's ffmpeg 4.4.2 an iPhone HLG (or a PQ) source came out 8-bit H.264
still tagged BT.2020 HLG/PQ: washed out in a browser. Through the chain below
it comes out tagged BT.709 on all three counts; the container verification
(verify_quicktime_outputs.py) checks that on real HLG and PQ files.
"""

from unittest.mock import patch

import pytest
from _jobs import job_input, run_job

from handler import main as handler_module
from handler.main import tonemap_filter


def _probe(**video):
    return {
        "format": {"duration": "60.0"},
        "streams": [
            {"codec_type": "audio", "codec_name": "aac"},
            {"codec_type": "video", "width": 1920, "height": 1080, **video},
        ],
    }


HLG = {
    "color_transfer": "arib-std-b67",
    "color_primaries": "bt2020",
    "color_space": "bt2020nc",
}


class TestDetection:
    @pytest.mark.parametrize("transfer", ["arib-std-b67", "smpte2084"])
    def test_hlg_and_pq_are_tone_mapped(self, transfer):
        chain = tonemap_filter(_probe(**{**HLG, "color_transfer": transfer}))
        assert chain.startswith(
            f"zscale=tin={transfer}:pin=bt2020:min=bt2020nc:t=linear:npl=100,"
        )
        assert f"tonemap=tonemap={handler_module.TONEMAP_OPERATOR}:desat=0" in chain
        assert chain.endswith("zscale=t=bt709:m=bt709:r=tv")

    @pytest.mark.parametrize(
        "video", [{}, {"color_transfer": "bt709"}, {"color_transfer": "unknown"}]
    )
    def test_sdr_is_left_alone(self, video):
        assert tonemap_filter(_probe(**video)) is None

    def test_no_video_stream(self):
        assert tonemap_filter({"streams": [{"codec_type": "audio"}]}) is None

    def test_display_p3_primaries_are_kept(self):
        assert ":pin=smpte432:" in tonemap_filter(
            _probe(**{**HLG, "color_primaries": "smpte432"})
        )

    def test_unknown_primaries_and_matrix_are_taken_as_bt2020(self):
        chain = tonemap_filter(
            _probe(color_transfer="smpte2084", color_primaries="?", color_space="?")
        )
        assert ":pin=bt2020:min=bt2020nc:" in chain


class TestPlacement:
    def test_after_scaling_and_before_8_bit(self):
        # At the rung's size (cheap), and the 8-bit conversion still last.
        assert handler_module.ladder_filter(720, "TONEMAP") == (
            handler_module.ladder_filter(720).replace(
                ",format=yuv420p", ",TONEMAP,format=yuv420p"
            )
        )

    def test_sdr_ladder_is_unchanged(self):
        assert "zscale" not in handler_module.ladder_filter(720)
        assert handler_module.ladder_filter(720, None) == handler_module.ladder_filter(
            720
        )

    def test_mezzanine(self):
        cmd = handler_module._build_mezzanine_cmd("in.mov", "out.mp4", False, "TM")
        assert cmd[cmd.index("-vf") + 1] == "TM,format=yuv420p"


def _job(probe, media_type="video", gpu=False):
    return run_job(job_input(type=media_type, contract=2), probe, gpu=gpu)


class TestHandler:
    def _commands(self, probe, media_type="video", gpu=False):
        """Every ffmpeg command of the job that makes a picture."""
        seen = []
        real = handler_module.run_ffmpeg

        def spy(cmd, *args, **kwargs):
            seen.append(cmd)
            return real(cmd, *args, **kwargs)

        with patch("handler.main.run_ffmpeg", side_effect=spy):
            result, _ = _job(probe, media_type, gpu)
        assert result["status"] == "success", result
        return [cmd for cmd in seen if cmd[0] == "ffmpeg" and "-vf" in cmd]

    @pytest.mark.parametrize("gpu", [True, False], ids=["nvenc", "libx264"])
    def test_an_hlg_source_is_tone_mapped_everywhere(self, gpu):
        pictures = self._commands(_probe(**HLG), gpu=gpu)
        # 2 rungs, the preview, 4 posters (always decoded on the CPU)
        assert len(pictures) == 7
        assert sum("h264_nvenc" in cmd for cmd in pictures) == (3 if gpu else 0)
        for cmd in pictures:
            assert "zscale=tin=arib-std-b67" in cmd[cmd.index("-vf") + 1], cmd

    def test_an_sdr_source_is_not(self):
        pictures = self._commands(_probe(color_transfer="bt709"))
        assert pictures and not any("zscale" in " ".join(cmd) for cmd in pictures)
