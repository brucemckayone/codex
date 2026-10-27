"""Portrait, anamorphic and small sources; master playlists that describe their
rungs as encoded (Codex-l2c48.8 items 8 and 9).

Checked against real ffmpeg too: a 2880x1800 source gives 1152x720 and
768x480, a rotated portrait clip 720x1280 and 480x854, a 352x240 clip one
352x240 rung and preview, and an 8:9-pixel 720x480 source a square 640x480.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from handler import main as handler_module
from handler.main import TranscodeError, TranscodeErrorCode


class TestDisplayDimensions:
    def test_a_landscape_frame_is_as_stored(self):
        assert handler_module.display_dimensions({"width": 1920, "height": 1080}) == (
            1920,
            1080,
        )

    @pytest.mark.parametrize("rotation", [-90, 90, 270])
    def test_a_display_matrix_quarter_turn_swaps(self, rotation):
        stream = {
            "width": 1920,
            "height": 1080,
            "side_data_list": [
                {"side_data_type": "Display Matrix", "rotation": rotation}
            ],
        }
        assert handler_module.display_dimensions(stream) == (1080, 1920)

    def test_the_legacy_rotate_tag_swaps(self):
        stream = {"width": 1920, "height": 1080, "tags": {"rotate": "90"}}
        assert handler_module.display_dimensions(stream) == (1080, 1920)

    def test_a_half_turn_keeps_the_shape(self):
        stream = {"width": 1920, "height": 1080, "side_data_list": [{"rotation": 180}]}
        assert handler_module.display_dimensions(stream) == (1920, 1080)

    def test_non_square_pixels_are_squared(self):
        stream = {"width": 720, "height": 480, "sample_aspect_ratio": "8:9"}
        assert handler_module.display_dimensions(stream) == (640, 480)

    @pytest.mark.parametrize("sar", ["0:1", "N/A", None, "1:1"])
    def test_an_unusable_or_square_ratio_changes_nothing(self, sar):
        stream = {"width": 720, "height": 480, "sample_aspect_ratio": sar}
        assert handler_module.display_dimensions(stream) == (720, 480)

    def test_get_media_info_reports_the_displayed_size(self):
        probe = {
            "format": {"duration": "12.5"},
            "streams": [
                {"codec_type": "audio"},
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "side_data_list": [{"rotation": -90}],
                },
            ],
        }
        assert handler_module.get_media_info(probe) == (12, 1080, 1920)


class TestLadderFilter:
    def test_scales_the_short_side_whichever_way_round(self):
        chain = handler_module.ladder_filter(720).split(",setsar=1,")
        assert chain[0] == "scale='trunc(iw*sar/2)*2':ih"
        scale, pixel_format = chain[1].rsplit(",", 1)
        assert scale == "scale='if(gte(iw,ih),-2,720)':'if(gte(iw,ih),720,-2)'"
        assert pixel_format == "format=yuv420p"

    @pytest.mark.parametrize("use_gpu", [True, False])
    def test_every_rung_uses_it(self, use_gpu):
        cmd = handler_module._build_hls_variant_cmd(
            "in.mov",
            "/o/480p",
            "/o/480p/index.m3u8",
            handler_module.HLS_VARIANTS["480p"],
            use_gpu,
        )
        assert cmd[cmd.index("-vf") + 1] == handler_module.ladder_filter(480)

    @pytest.mark.parametrize("value,expected", [(240, 240), (241, 240), (1, 2)])
    def test_even_floor(self, value, expected):
        assert handler_module.even_floor(value) == expected


class TestRungChoice:
    def _rungs(self, tmp_path, short_side):
        encoded = []

        def encode(input_path, variant_dir, playlist_path, settings, name, *rest):
            encoded.append((name, settings["height"]))

        with (
            patch("handler.main._encode_hls_variant", side_effect=encode),
            patch("handler.main.write_master_playlist"),
        ):
            ready = handler_module.transcode_video_hls(
                "in.mov", str(tmp_path), short_side, False
            )
        return ready, encoded

    def test_a_portrait_1080x1920_gets_the_full_ladder(self, tmp_path):
        # The short side is 1080: by height (1920) or by short side, both fit;
        # the point is the rung's NAME is its short side.
        assert self._rungs(tmp_path, 1080)[0] == ["720p", "480p"]

    def test_a_source_between_rungs_skips_the_bigger_one(self, tmp_path):
        assert self._rungs(tmp_path, 600)[0] == ["480p"]

    def test_a_small_source_keeps_its_own_size(self, tmp_path):
        ready, encoded = self._rungs(tmp_path, 241)
        assert ready == ["source"]
        assert encoded == [("source", 240)]


class TestPreviewNeverUpscales:
    def _short_side(self, source_short_side):
        with (
            patch("handler.main.run_ffmpeg"),
            patch("handler.main._validate_hls_rung"),
            patch("handler.main._build_preview_cmd", return_value=["ffmpeg"]) as build,
        ):
            handler_module.create_preview(
                "in.mov", "/tmp/out", 60, False, source_short_side
            )
        return build.call_args.kwargs["short_side"]

    def test_a_large_source_previews_at_720(self):
        assert self._short_side(1080) == 720

    def test_a_small_source_previews_at_its_own_size(self):
        assert self._short_side(240) == 240

    def test_an_unknown_size_previews_at_720(self):
        assert self._short_side(None) == 720


PLAYLIST = """#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:7
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.000000,
#EXT-X-BYTERANGE:1500000@0
stream.ts
#EXTINF:6.000000,
#EXT-X-BYTERANGE:2250000@1500000
stream.ts
#EXTINF:0.200000,
#EXT-X-BYTERANGE:100000@3750000
stream.ts
#EXT-X-ENDLIST
"""


class TestPeakBandwidth:
    def test_the_busiest_full_segment(self, tmp_path):
        playlist = tmp_path / "index.m3u8"
        playlist.write_text(PLAYLIST)
        # 2,250,000 bytes over 6 s; the 0.2 s tail (4 Mb/s) is ignored.
        assert handler_module.peak_bandwidth(str(playlist)) == 3_000_000

    def test_a_clip_of_only_short_segments_still_measures(self, tmp_path):
        playlist = tmp_path / "index.m3u8"
        playlist.write_text("#EXTINF:0.5,\n#EXT-X-BYTERANGE:1000@0\nstream.ts\n")
        assert handler_module.peak_bandwidth(str(playlist)) == 16_000

    def test_an_unreadable_playlist_is_none(self, tmp_path):
        assert handler_module.peak_bandwidth(str(tmp_path / "missing.m3u8")) is None


def _probe(*streams):
    return MagicMock(stdout=json.dumps({"streams": list(streams)}), returncode=0)


class TestEncodedStreamTags:
    def test_video_and_audio(self):
        video = {
            "codec_type": "video",
            "width": 720,
            "height": 1280,
            "profile": "High",
            "level": 31,
        }
        audio = {"codec_type": "audio", "codec_name": "aac"}
        with patch("subprocess.run", return_value=_probe(audio, video)):
            assert handler_module.encoded_stream_tags("stream.ts") == (
                "720x1280",
                "avc1.64001f,mp4a.40.2",
            )

    def test_audio_only(self):
        with patch(
            "subprocess.run",
            return_value=_probe({"codec_type": "audio", "codec_name": "aac"}),
        ):
            assert handler_module.encoded_stream_tags("stream.ts") == (
                None,
                "mp4a.40.2",
            )

    def test_an_unknown_profile_omits_the_video_codec(self):
        video = {
            "codec_type": "video",
            "width": 640,
            "height": 480,
            "profile": "High 10",
            "level": 30,
        }
        with patch("subprocess.run", return_value=_probe(video)):
            assert handler_module.encoded_stream_tags("stream.ts") == ("640x480", None)

    def test_an_unreadable_output_fails_output_validation(self):
        import subprocess

        failure = subprocess.CalledProcessError(1, ["ffprobe"], stderr="")
        with patch("subprocess.run", side_effect=failure):
            with pytest.raises(TranscodeError) as raised:
                handler_module.encoded_stream_tags("stream.ts")
        assert raised.value.code == TranscodeErrorCode.OUTPUT_VALIDATION_FAILED


class TestMasterPlaylist:
    def test_describes_each_rung_as_encoded(self, tmp_path):
        rung = tmp_path / "720p"
        rung.mkdir()
        (rung / "index.m3u8").write_text(PLAYLIST)
        tags = ("720x1280", "avc1.64001f,mp4a.40.2")
        with patch("handler.main.encoded_stream_tags", return_value=tags):
            handler_module.write_master_playlist(
                str(tmp_path / "master.m3u8"),
                [("720p", str(rung))],
                {"720p": 3_128_000},
            )
        assert (tmp_path / "master.m3u8").read_text() == (
            "#EXTM3U\n#EXT-X-VERSION:3\n"
            '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=720x1280,CODECS="avc1.64001f,mp4a.40.2"\n'
            "720p/index.m3u8\n"
        )

    def test_falls_back_to_the_nominal_rate(self, tmp_path):
        rung = tmp_path / "128k"
        rung.mkdir()
        with patch(
            "handler.main.encoded_stream_tags", return_value=(None, "mp4a.40.2")
        ):
            handler_module.write_master_playlist(
                str(tmp_path / "master.m3u8"), [("128k", str(rung))], {"128k": 128_000}
            )
        assert (
            '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"\n'
            in (tmp_path / "master.m3u8").read_text()
        )
