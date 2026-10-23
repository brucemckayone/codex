import os
import sys
from unittest.mock import MagicMock

import pytest
import requests

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../scripts"))
)

import update_runpod_endpoint as script

HEALTHY = {
    "workersMin": 0,
    "workersMax": 5,
    "idleTimeout": 5,
    "executionTimeoutMs": 2 * 60 * 60 * 1000,
}
NEW_IMAGE = "ghcr.io/owner/codex-transcoder:sha-abc"
TEMPLATE_ENV = [{"key": "WEBHOOK_SECRET", "value": "{{ RUNPOD_SECRET_x }}"}]
ENDPOINTS = [{"id": "ep-1", "name": "codex", "templateId": "tpl-1"}]
TEMPLATES = [
    {
        "id": "tpl-1",
        "name": "codex-template",
        "imageName": "old",
        "containerDiskInGb": 20,
        "volumeInGb": 0,
        "dockerArgs": "",
        "env": TEMPLATE_ENV,
    }
]
SAVED = {"id": "tpl-1", "name": "codex-template", "imageName": NEW_IMAGE}


def _response(status=200, payload=None):
    response = MagicMock()
    response.status_code = status
    response.json.return_value = payload
    response.text = repr(payload)
    if status >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(
            f"{status} Client Error"
        )
    return response


def _endpoints(payload=None):
    return _response(payload=payload or {"data": {"myself": {"endpoints": ENDPOINTS}}})


def _templates(payload=None):
    return _response(
        payload=payload or {"data": {"myself": {"podTemplates": TEMPLATES}}}
    )


def _saved(payload=None):
    return _response(payload=payload or {"data": {"saveTemplate": SAVED}})


@pytest.fixture
def deploy_env(monkeypatch):
    monkeypatch.setenv("RUNPOD_API_KEY", "key")
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "ep-1")
    monkeypatch.setenv("DOCKER_IMAGE", "ghcr.io/Owner/codex-transcoder")
    monkeypatch.setenv("IMAGE_TAG", "sha-abc")


def _patch_post(monkeypatch, responses):
    post = MagicMock(side_effect=responses)
    monkeypatch.setattr(script.requests, "post", post)
    return post


class TestUpdateEndpoint:
    def test_swaps_the_image_and_keeps_the_template_env(
        self, deploy_env, monkeypatch, capsys
    ):
        post = _patch_post(monkeypatch, [_endpoints(), _templates(), _saved()])

        script.update_endpoint()

        mutation_input = post.call_args_list[2].kwargs["json"]["variables"]["input"]
        assert mutation_input["id"] == "tpl-1"
        assert mutation_input["imageName"] == NEW_IMAGE
        assert mutation_input["env"] == TEMPLATE_ENV
        assert "✅ Updated template tpl-1" in capsys.readouterr().out

    @pytest.mark.parametrize(
        "save_payload, named",
        [
            ({"errors": [{"message": "denied"}]}, "denied"),
            ({"data": {"saveTemplate": None}}, "did not apply"),
            (
                {"data": {"saveTemplate": {**SAVED, "imageName": "old"}}},
                "did not apply",
            ),
            ({"data": {"saveTemplate": {**SAVED, "id": "tpl-NEW"}}}, "did not apply"),
            ({"data": None}, "Unexpected RunPod response"),
        ],
    )
    def test_an_unconfirmed_swap_fails_the_deploy(
        self, deploy_env, monkeypatch, capsys, save_payload, named
    ):
        _patch_post(
            monkeypatch, [_endpoints(), _templates(), _saved(payload=save_payload)]
        )

        with pytest.raises(SystemExit) as exc:
            script.update_endpoint()

        assert exc.value.code == 1
        out = capsys.readouterr().out
        assert named in out
        assert "✅ Updated template" not in out

    @pytest.mark.parametrize(
        "templates_payload, named",
        [
            (
                {"errors": [{"message": "Unauthorized"}], "data": None},
                "GraphQL errors from PodTemplates query",
            ),
            # GraphQL's partial success: errors beside data that looks usable.
            # Writing a template from a partial read would be a silent loss.
            (
                {
                    "errors": [{"message": "field env: denied"}],
                    "data": {"myself": {"podTemplates": TEMPLATES}},
                },
                "field env: denied",
            ),
            ({"data": {"myself": {"podTemplates": []}}}, "Template tpl-1 not found"),
            ({"data": {"myself": None}}, "Template tpl-1 not found"),
        ],
    )
    def test_a_failed_template_read_fails_before_any_write(
        self, deploy_env, monkeypatch, capsys, templates_payload, named
    ):
        post = _patch_post(
            monkeypatch, [_endpoints(), _templates(payload=templates_payload)]
        )

        with pytest.raises(SystemExit) as exc:
            script.update_endpoint()

        assert exc.value.code == 1
        assert named in capsys.readouterr().out
        assert post.call_count == 2

    @pytest.mark.parametrize(
        "endpoints_response",
        [
            _response(status=500, payload="down"),
            _response(payload={"errors": [{"message": "Unauthorized"}]}),
            _response(payload={"data": {"myself": {"endpoints": []}}}),
        ],
    )
    def test_a_failed_endpoint_read_fails_before_any_write(
        self, deploy_env, monkeypatch, endpoints_response
    ):
        post = _patch_post(monkeypatch, [endpoints_response])

        with pytest.raises(SystemExit) as exc:
            script.update_endpoint()

        assert exc.value.code == 1
        assert post.call_count == 1

    def test_a_body_that_is_not_json_fails_with_its_text(
        self, deploy_env, monkeypatch, capsys
    ):
        page = _response()
        page.json.side_effect = ValueError("not json")
        page.text = "<html>challenge</html>"
        _patch_post(monkeypatch, [page])

        with pytest.raises(SystemExit):
            script.update_endpoint()

        assert "<html>challenge</html>" in capsys.readouterr().out

    @pytest.mark.parametrize(
        "missing", ["RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID", "DOCKER_IMAGE"]
    )
    def test_each_missing_variable_exits_1_before_any_call(
        self, deploy_env, monkeypatch, missing
    ):
        monkeypatch.delenv(missing)
        post = _patch_post(monkeypatch, [])

        with pytest.raises(SystemExit) as exc:
            script.update_endpoint()

        assert exc.value.code == 1
        post.assert_not_called()


class TestConfigWarnings:
    def test_healthy_endpoint_has_no_warnings(self):
        assert script.config_warnings(HEALTHY) == []

    @pytest.mark.parametrize(
        "override, named",
        [
            ({"idleTimeout": 600}, "600 s"),
            ({"executionTimeoutMs": 600000}, "600000"),
        ],
    )
    def test_each_problem_is_named_once(self, override, named):
        warnings = script.config_warnings({**HEALTHY, **override})
        assert len(warnings) == 1
        assert named in warnings[0]


class TestCheckEndpointHealth:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("RUNPOD_API_KEY", "key")
        monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "ep-1")

    def _patch_get(self, monkeypatch, response=None, **kwargs):
        get = MagicMock(return_value=response, **kwargs)
        monkeypatch.setattr(script.requests, "get", get)
        return get

    def test_a_healthy_endpoint_passes_and_prints_its_config(self, monkeypatch, capsys):
        get = self._patch_get(monkeypatch, _response(payload=HEALTHY))

        assert script.check_endpoint_health() == 0

        assert get.call_args.args[0] == "https://rest.runpod.io/v1/endpoints/ep-1"
        assert get.call_args.kwargs["headers"] == {"Authorization": "Bearer key"}
        out = capsys.readouterr().out
        assert "workersMax=5" in out
        assert "::warning::" not in out
        assert "::error::" not in out

    def test_a_paused_endpoint_fails_the_step(self, monkeypatch, capsys):
        self._patch_get(monkeypatch, _response(payload={**HEALTHY, "workersMax": 0}))

        assert script.check_endpoint_health() == 2

        assert "::error::Endpoint ep-1 is PAUSED" in capsys.readouterr().out

    def test_settings_warnings_do_not_fail_the_step(self, monkeypatch, capsys):
        self._patch_get(monkeypatch, _response(payload={**HEALTHY, "idleTimeout": 600}))

        assert script.check_endpoint_health() == 0

        assert "::warning::idleTimeout is 600 s" in capsys.readouterr().out

    @pytest.mark.parametrize(
        "kwargs, named",
        [
            ({"response": _response(status=401)}, "401 Client Error"),
            (
                {"side_effect": requests.ConnectionError("boom")},
                "boom",
            ),
            ({"response": _response(payload=None)}, "not an object"),
            ({"response": _response(payload=[])}, "not an object"),
            ({"response": _response(payload={"error": "nope"})}, "lacks workersMax"),
        ],
    )
    def test_an_unreadable_config_is_a_warning_that_says_health_was_not_checked(
        self, monkeypatch, capsys, kwargs, named
    ):
        response = kwargs.pop("response", None)
        self._patch_get(monkeypatch, response, **kwargs)

        assert script.check_endpoint_health() == 0

        out = capsys.readouterr().out
        assert "health NOT checked" in out
        assert named in out

    def test_a_body_that_is_not_json_is_a_warning(self, monkeypatch, capsys):
        response = _response()
        response.json.side_effect = ValueError("not json")
        self._patch_get(monkeypatch, response)

        assert script.check_endpoint_health() == 0

        assert "health NOT checked: not json" in capsys.readouterr().out

    def test_missing_env_exits_1(self, monkeypatch):
        monkeypatch.delenv("RUNPOD_ENDPOINT_ID")
        get = self._patch_get(monkeypatch)

        assert script.check_endpoint_health() == 1

        get.assert_not_called()


class TestMain:
    def test_health_flag_runs_only_the_health_check(self, monkeypatch):
        health = MagicMock(return_value=2)
        update = MagicMock()
        monkeypatch.setattr(script, "check_endpoint_health", health)
        monkeypatch.setattr(script, "update_endpoint", update)

        assert script.main(["--health"]) == 2
        update.assert_not_called()

    def test_no_flag_runs_only_the_deploy(self, monkeypatch):
        health = MagicMock()
        update = MagicMock()
        monkeypatch.setattr(script, "check_endpoint_health", health)
        monkeypatch.setattr(script, "update_endpoint", update)

        assert script.main([]) == 0
        update.assert_called_once()
        health.assert_not_called()
