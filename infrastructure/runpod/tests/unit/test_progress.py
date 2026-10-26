"""Progress while encoding, about every 5%, and creatorId on every webhook.

Owner's choice 2026-10-26 (Codex-l2c48.8 item 12, for the live status object
of Codex-l2c48.9): the ladder reports as ffmpeg encodes (17% → 72%) instead
of jumping from one step to the next, and every report carries the creator,
so the service can route it without reading the database.
"""

import os
import subprocess
from unittest.mock import MagicMock, patch

import pytest
from _jobs import run_job

from handler import main as handler_module
from handler.main import ProgressReporter

MEDIA_ID = "550e8400-e29b-41d4-a716-446655440000"
CREATOR_ID = "k9Xq2LmVt7RzP4wN"


class Polls:
    """A `done` event whose every wait() first runs the test's next step, and
    which is set once the steps run out."""

    def __init__(self, *steps):
        self.steps = list(steps)

    def wait(self, timeout):
        self.steps.pop(0)()
        return not self.steps


class TestFollowProgress:
    def _follow(self, tmp_path, *writes):
        path = tmp_path / "progress"
        heard = []

        def append(text):
            def write():
                with path.open("a") as progress:
                    progress.write(text)

            return write

        handler_module._follow_progress(
            str(path), heard.append, Polls(*(append(w) for w in writes))
        )
        return heard

    def test_the_latest_position_of_each_poll(self, tmp_path):
        heard = self._follow(
            tmp_path,
            "out_time_us=N/A\nout_time_us=1000000\nout_time_us=1500000\n",
            "out_time_us=4000000\nprogress=end\n",
        )
        assert heard == [1.5, 4.0]

    def test_a_line_still_being_written_waits_for_its_end(self, tmp_path):
        heard = self._follow(tmp_path, "out_time_us=1000000\nout_time_us=2", "000000\n")
        assert heard == [1.0, 2.0]

    def test_never_backwards(self, tmp_path):
        heard = self._follow(tmp_path, "out_time_us=3000000\n", "out_time_us=2000000\n")
        assert heard == [3.0]

    def test_a_file_ffmpeg_never_wrote(self, tmp_path):
        heard = []
        handler_module._follow_progress(
            str(tmp_path / "missing"), heard.append, Polls(lambda: None)
        )
        assert heard == []


class TestRunFfmpeg:
    def test_without_a_listener_the_command_is_untouched(self):
        with patch("subprocess.run") as run:
            handler_module.run_ffmpeg(["ffmpeg", "-i", "in.mov", "out.ts"])
        assert run.call_args.args[0] == ["ffmpeg", "-i", "in.mov", "out.ts"]

    def test_a_listener_hears_where_ffmpeg_got_to(self):
        commands = []

        def run(cmd, **kwargs):
            commands.append(cmd)
            with open(cmd[2], "w") as progress:
                progress.write("out_time_us=2500000\nprogress=end\n")
            return MagicMock(returncode=0)

        heard = []
        with patch("subprocess.run", side_effect=run):
            handler_module.run_ffmpeg(
                ["ffmpeg", "-i", "in.mov", "out.ts"], on_seconds=heard.append
            )
        [cmd] = commands
        assert cmd[1] == "-progress" and cmd[3] == "-nostats"
        assert cmd[4:] == ["-i", "in.mov", "out.ts"]
        assert heard == [2.5]
        assert not os.path.exists(cmd[2])  # the progress file is cleaned up

    def test_a_failure_still_raises_with_its_code(self):
        failure = subprocess.CalledProcessError(69, ["ffmpeg"], stderr="")
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(handler_module.TranscodeError) as raised:
                handler_module.run_ffmpeg(["ffmpeg"], on_seconds=lambda s: None)
        assert raised.value.code == "CORRUPT_INPUT"


class TestReporter:
    def _sent(self, ticks):
        reporter = ProgressReporter("url", "secret", "job", MEDIA_ID, CREATOR_ID)
        with patch("handler.main.send_progress") as send:
            for step, percent in ticks:
                reporter.report(step, percent)
        return [(c.args[3], c.args[4]) for c in send.call_args_list]

    def test_about_every_5_points_within_a_step(self):
        ticks = [("encoding_variants", p) for p in (17, 19, 21, 22, 27, 30, 32)]
        assert self._sent(ticks) == [
            ("encoding_variants", 17),
            ("encoding_variants", 22),
            ("encoding_variants", 27),
            ("encoding_variants", 32),
        ]

    def test_a_new_step_always_goes(self):
        assert self._sent([("loudness", 15), ("encoding_variants", 17)]) == [
            ("loudness", 15),
            ("encoding_variants", 17),
        ]

    def test_never_backwards(self):
        # A GPU encode that fails half way restarts on the CPU from zero.
        ticks = [("encoding_variants", p) for p in (17, 44, 20, 30, 49)]
        assert self._sent(ticks) == [
            ("encoding_variants", 17),
            ("encoding_variants", 44),
            ("encoding_variants", 49),
        ]

    def test_a_stage_maps_its_share(self):
        reporter = ProgressReporter("url", "secret", "job", MEDIA_ID, CREATOR_ID)
        with patch("handler.main.send_progress") as send:
            on_encode = reporter.stage("encoding_variants", 17, 72)
            on_encode(0.5)
            on_encode(1.0)
        assert [c.args[4] for c in send.call_args_list] == [17, 44, 72]
        assert {c.args[6] for c in send.call_args_list} == {CREATOR_ID}


def _job(media_type="video", creator_id=CREATOR_ID):
    probe = {
        "format": {"duration": "120.0"},
        "streams": [{"codec_type": "audio", "codec_name": "aac"}]
        + (
            [{"codec_type": "video", "width": 1920, "height": 1080}]
            if media_type == "video"
            else []
        ),
    }
    return run_job(
        {
            "mediaId": MEDIA_ID,
            "creatorId": creator_id,
            "type": media_type,
            "inputKey": f"{creator_id}/originals/{MEDIA_ID}/clip.mov",
            "webhookUrl": "https://api.example.com/webhook",
            "contract": 2,
        },
        probe,
    )


class TestJob:
    @pytest.mark.parametrize("media_type", ["video", "audio"])
    def test_the_ladder_reports_each_rung_done(self, media_type):
        result, posts = _job(media_type)
        assert result["status"] == "success", result
        encoding = [
            p["progress"] for p in posts if p.get("step") == "encoding_variants"
        ]
        # Two rungs, each an equal half of 17 → 72.
        assert encoding == [17, 44, 72]

    def test_every_webhook_carries_the_creator(self):
        _, posts = _job()
        assert posts and all(p["creatorId"] == CREATOR_ID for p in posts)
        assert posts[-1]["status"] == "completed"

    def test_a_creator_the_service_would_refuse_is_sent_as_null(self):
        # validate_path_component allows `-`; the service's userIdSchema does not.
        _, posts = _job(creator_id="user-123")
        assert posts and all(p["creatorId"] is None for p in posts)
