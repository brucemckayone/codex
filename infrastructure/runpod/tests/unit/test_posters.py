"""Posters in the sized image layout (Codex-l2c48.8 item 11, folds Codex-6rzfp).

A job with `contract >= 2` gets `media-thumbnails/{mediaId}/{w}x{h}-{nonce}/`
with sm/md/lg/xl; any other job the flat sm/md/lg its service reads.
"""

import re
from pathlib import Path
from unittest.mock import patch

import pytest

from _jobs import run_job
from handler import main as handler_module

REPO_ROOT = Path(__file__).resolve().parents[4]
IMAGE_TS = REPO_ROOT / "packages/validation/src/image.ts"

MEDIA_ID = "550e8400-e29b-41d4-a716-446655440000"


def _still_folder_pattern() -> re.Pattern:
    """STILL_FOLDER_NAME as the web reads it, from its TypeScript source."""
    match = re.search(r"const STILL_FOLDER_NAME = /(.+)/;", IMAGE_TS.read_text())
    assert match, "STILL_FOLDER_NAME not found in packages/validation/src/image.ts"
    return re.compile(match.group(1))


class TestFolderName:
    def test_the_web_reads_it(self):
        name = handler_module.poster_folder_name(1080, 1920)
        match = _still_folder_pattern().match(name)
        assert match, name
        assert (int(match.group(1)), int(match.group(2))) == (1080, 1920)

    def test_two_uploads_never_share_a_folder(self):
        names = {handler_module.poster_folder_name(1920, 1080) for _ in range(20)}
        assert len(names) == 20


class TestExtract:
    def _cmds(self, sizes):
        with (
            patch("handler.main.run_ffmpeg") as run,
            patch("handler.main.validate_output"),
            patch("os.path.getsize", return_value=1),
        ):
            files = handler_module.extract_thumbnail_variants("in.mov", "/w", 60, sizes)
        return files, [call.args[0] for call in run.call_args_list]

    def test_each_size_is_capped_at_the_picture_never_upscaled(self):
        _, cmds = self._cmds(list(handler_module.POSTER_SIZES))
        filters = [cmd[cmd.index("-vf") + 1] for cmd in cmds]
        assert filters == [
            "scale='trunc(iw*sar/2)*2':ih,setsar=1,scale='min(200,iw)':-1",
            "scale='trunc(iw*sar/2)*2':ih,setsar=1,scale='min(400,iw)':-1",
            "scale='trunc(iw*sar/2)*2':ih,setsar=1,scale='min(800,iw)':-1",
            "scale='trunc(iw*sar/2)*2':ih,setsar=1,scale='min(1600,iw)':-1",
        ]
        assert all(cmd[cmd.index("-c:v") + 1] == "libwebp" for cmd in cmds)

    def test_files_per_size(self):
        files, _ = self._cmds(["sm", "md", "lg"])
        assert list(files) == ["sm", "md", "lg"]

    @pytest.mark.parametrize("sizes", [[], ["lg", "xxl"]])
    def test_unknown_or_no_sizes_are_refused(self, sizes):
        with pytest.raises(ValueError):
            handler_module.extract_thumbnail_variants("in.mov", "/w", 60, sizes)


def _run_job(job_input, probe):
    """The completed webhook's output from a whole (mocked) job."""
    result, posts = run_job(job_input, probe, job_id="job-p")
    assert result["status"] == "success", result
    completed = [p for p in posts if p["status"] == "completed"]
    assert len(completed) == 1
    return completed[0]["output"]


def _job(**extra):
    return {
        "mediaId": MEDIA_ID,
        "creatorId": "user-123",
        "type": "video",
        "inputKey": f"user-123/originals/{MEDIA_ID}/clip.mov",
        "webhookUrl": "https://media-api.example.com/api/transcoding/webhook",
        **extra,
    }


PORTRAIT = {
    "format": {"duration": "60"},
    "streams": [
        {
            "codec_type": "video",
            "width": 1920,
            "height": 1080,
            "side_data_list": [{"rotation": -90}],
        },
        {"codec_type": "audio", "codec_name": "aac"},
    ],
}


class TestLayoutByContract:
    def test_contract_2_writes_four_sizes_in_a_folder_named_by_the_upright_picture(
        self,
    ):
        output = _run_job(_job(contract=2), PORTRAIT)
        folder = output["thumbnailKey"].rsplit("/", 1)[0]
        prefix, name = folder.rsplit("/", 1)
        assert prefix == f"user-123/media-thumbnails/{MEDIA_ID}"
        assert re.fullmatch(r"1080x1920-[0-9a-f]{8}", name)
        assert output["thumbnailKey"] == f"{folder}/lg.webp"
        assert output["thumbnailVariants"] == {
            s: f"{folder}/{s}.webp" for s in ("sm", "md", "lg", "xl")
        }
        assert (output["width"], output["height"]) == (1080, 1920)

    @pytest.mark.parametrize(
        "extra", [{}, {"contract": 1}, {"contract": "2"}, {"contract": True}]
    )
    def test_any_other_job_keeps_the_flat_layout(self, extra):
        output = _run_job(_job(**extra), PORTRAIT)
        base = f"user-123/media-thumbnails/{MEDIA_ID}"
        assert output["thumbnailVariants"] == {
            s: f"{base}/{s}.webp" for s in ("sm", "md", "lg")
        }
        assert output["thumbnailKey"] == f"{base}/lg.webp"

    def test_a_picture_of_unknown_size_keeps_the_flat_layout(self):
        probe = {"format": {"duration": "60"}, "streams": [{"codec_type": "video"}]}
        output = _run_job(_job(contract=2), probe)
        assert "xl" not in output["thumbnailVariants"]
