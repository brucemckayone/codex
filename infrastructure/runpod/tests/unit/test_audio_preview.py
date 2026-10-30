"""An audio source gets a 30-second preview, cut as a video's is (Codex-hro3u).

The sales page's audio reel plays `hlsPreviewKey`, and states its length by
the same rule as preview_window. Without this an audio upload had no preview,
so its course's reel never reached the page.
"""

from unittest.mock import patch

import pytest
from _jobs import CREATOR_ID, MEDIA_ID, job_input, run_job

from handler import main as handler_module

AUDIO = {"format": {"duration": "180.2"}, "streams": [{"codec_type": "audio"}]}
PREVIEW_KEY = f"{CREATOR_ID}/hls/{MEDIA_ID}/preview/preview.m3u8"


def _value(cmd: list[str], flag: str) -> str:
    assert flag in cmd, f"{flag} missing from {' '.join(cmd)}"
    return cmd[cmd.index(flag) + 1]


def _audio_job():
    return job_input(
        contract=2, type="audio", inputKey=f"{CREATOR_ID}/originals/{MEDIA_ID}/talk.m4a"
    )


@pytest.mark.parametrize("duration", range(0, 601))
def test_the_window_is_the_sales_pages_rule(duration):
    """min(30, d - floor(d / 10)) from floor(d / 10): what the page says."""
    start, length = handler_module.preview_window(duration)
    assert start == duration // 10
    assert length == min(30, duration - duration // 10)


class TestAudioPreviewCommand:
    @property
    def cmd(self) -> list[str]:
        return handler_module._build_audio_preview_cmd("in.m4a", "/out/preview", 18, 30)

    def test_seeks_before_the_input_and_stops_after_its_length(self):
        assert self.cmd.index("-ss") < self.cmd.index("-i")
        assert _value(self.cmd, "-ss") == "18"
        assert _value(self.cmd, "-t") == "30"
        assert self.cmd.index("-t") > self.cmd.index("-i")

    def test_is_audio_only_aac_at_128k_and_48_khz(self):
        assert "-vn" in self.cmd
        assert _value(self.cmd, "-c:a") == "aac"
        assert _value(self.cmd, "-b:a") == "128k"
        assert _value(self.cmd, "-ar") == "48000"

    def test_is_levelled_like_the_audio_rungs(self):
        assert _value(self.cmd, "-af") == handler_module.LOUDNORM

    def test_is_single_file_hls_where_the_video_preview_goes(self):
        assert _value(self.cmd, "-hls_flags") == "single_file"
        assert _value(self.cmd, "-hls_segment_filename") == "/out/preview/stream.ts"
        assert self.cmd[-1] == "/out/preview/preview.m3u8"

    def test_is_not_tolerant_of_damaged_frames(self):
        # The audio is the whole content (see _build_audio_hls_cmd).
        assert "-max_error_rate" not in self.cmd


def test_an_audio_job_reports_its_preview():
    _, posts = run_job(_audio_job(), AUDIO, job_id="job-audio")
    [done] = [p for p in posts if p["status"] == "completed"]
    assert done["output"]["hlsPreviewKey"] == PREVIEW_KEY


def test_the_audio_preview_is_cut_from_the_window():
    with patch(
        "handler.main._build_audio_preview_cmd",
        wraps=handler_module._build_audio_preview_cmd,
    ) as build:
        run_job(_audio_job(), AUDIO, job_id="job-audio")
    # 180.2 s probes as 180: from 18 s, for 30 s.
    assert build.call_args.args[2:] == (18, 30)


def test_the_flag_turns_it_off():
    with patch.dict(handler_module.FEATURES, {"audio_preview": False}):
        _, posts = run_job(_audio_job(), AUDIO, job_id="job-audio")
    [done] = [p for p in posts if p["status"] == "completed"]
    assert done["output"]["hlsPreviewKey"] is None


def test_the_video_preview_flag_does_not_turn_it_off():
    with patch.dict(handler_module.FEATURES, {"video_preview": False}):
        _, posts = run_job(_audio_job(), AUDIO, job_id="job-audio")
    [done] = [p for p in posts if p["status"] == "completed"]
    assert done["output"]["hlsPreviewKey"] == PREVIEW_KEY
