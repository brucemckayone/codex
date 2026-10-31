"""Deploy a new transcoder image to the RunPod endpoint, and check its health.

    python update_runpod_endpoint.py           # swap the endpoint's image
    python update_runpod_endpoint.py --warm    # start a worker on it now
    python update_runpod_endpoint.py --health  # read the endpoint's live settings

They are separate workflow steps so a paused endpoint turns the health step
red while the deploy step, which did its job, stays green.
"""

import os
import sys
import time

import requests

GRAPHQL_URL = "https://api.runpod.io/graphql"
# REST v1 (rest.runpod.io/v1) is retired on 2026-11-15; v2 nests the worker
# settings under `workers` and calls the execution timeout `timeout` (ms).
REST_URL = "https://api.runpod.io/v2"

# An idle worker is billed while it waits for the next job.
MAX_IDLE_TIMEOUT_S = 60
# A job is killed at the endpoint's execution timeout, with no webhook.
MIN_EXECUTION_TIMEOUT_MS = 60 * 60 * 1000
HEALTH_READ_ATTEMPTS = 3

# The job API, which the management calls above do not serve.
JOBS_URL = "https://api.runpod.ai/v2"
WARM_WAIT_S = 10 * 60
WARM_POLL_S = 10
# Normal priority, unlike the cron's low-priority keep-alive: starting a
# worker is the point. RunPod drops a job still queued at its ttl.
WARM_POLICY = {"ttl": 15 * 60 * 1000, "executionTimeout": 60 * 1000}
JOB_ENDED = {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"}


def graphql(headers, operation, query, variables=None):
    """Run one GraphQL call; its `data` object, or None after saying why.

    GraphQL reports auth and schema problems as a 200 with `errors`, and a
    declined write as a null field, so a 200 alone proves nothing.
    """
    body = {"query": query}
    if variables is not None:
        body["variables"] = variables
    response = requests.post(GRAPHQL_URL, json=body, headers=headers, timeout=30)
    if response.status_code != 200:
        print(f"❌ {operation} failed: {response.status_code} - {response.text[:500]}")
        return None
    try:
        payload = response.json()
    except ValueError:
        print(f"❌ {operation} returned a body that is not JSON: {response.text[:500]}")
        return None
    if not isinstance(payload, dict):
        print(f"❌ Unexpected RunPod response for {operation}: {payload!r}")
        return None
    if payload.get("errors"):
        print(f"❌ GraphQL errors from {operation}: {payload['errors']}")
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        print(f"❌ Unexpected RunPod response for {operation}: {payload!r}")
        return None
    return data


def get_endpoint_details(headers, endpoint_id):
    """Query all endpoints and find the matching one."""
    query = """
    query Endpoints {
        myself {
            endpoints {
                id
                name
                templateId
                gpuIds
                workersMin
                workersMax
            }
        }
    }
    """
    data = graphql(headers, "Endpoints query", query)
    if data is None:
        return None

    endpoints = (data.get("myself") or {}).get("endpoints") or []
    for endpoint in endpoints:
        if endpoint.get("id") == endpoint_id:
            return endpoint

    print(f"❌ Endpoint {endpoint_id} not found in {len(endpoints)} endpoints")
    return None


def update_template(headers, template_id, new_image_name):
    """Point the template at the new image; True only when RunPod confirms it."""
    query = """
    query PodTemplates {
        myself {
            podTemplates {
                id
                name
                imageName
                containerDiskInGb
                volumeInGb
                dockerArgs
                containerRegistryAuthId
                env {
                    key
                    value
                }
            }
        }
    }
    """
    data = graphql(headers, "PodTemplates query", query)
    if data is None:
        return False

    templates = (data.get("myself") or {}).get("podTemplates") or []
    template = next((t for t in templates if t.get("id") == template_id), None)
    if not template:
        print(f"❌ Template {template_id} not found")
        return False

    print(
        f"📦 Found template: {template['name']} (current image: {template['imageName']})"
    )

    # Every production deploy runs this; most change nothing in the
    # transcoder, and re-saving an unchanged template only churns workers.
    # Safe to skip by name because runpod-ci never pushes over a src- tag.
    current = template.get("imageName") or ""
    if current == new_image_name:
        print(f"✅ Template {template_id} already uses {new_image_name}")
        return True

    repository = new_image_name.rsplit(":", 1)[0]
    if not current.startswith(f"{repository}:src-"):
        print(
            f"::warning::Template image {current or '(none)'} was not set by a "
            f"production deploy; replacing it with {new_image_name}. Roll back "
            "with git revert on main: a console edit lasts until the next deploy."
        )

    mutation = """
    mutation saveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) {
            id
            name
            imageName
        }
    }
    """

    # saveTemplate replaces the template, so the fields this template uses are
    # sent back as read. Dropping `env` would delete the RunPod secret
    # mappings; dropping the registry auth would unlink its pull credentials.
    variables = {
        "input": {
            "id": template_id,
            "name": template["name"],
            "imageName": new_image_name,
            "containerDiskInGb": template.get("containerDiskInGb", 10),
            "volumeInGb": template.get("volumeInGb", 0),
            "dockerArgs": template.get("dockerArgs") or "",
            "env": template.get("env") or [],
            "isServerless": True,
        }
    }
    if template.get("containerRegistryAuthId"):
        variables["input"]["containerRegistryAuthId"] = template[
            "containerRegistryAuthId"
        ]

    data = graphql(headers, "saveTemplate", mutation, variables)
    if data is None:
        return False

    result = data.get("saveTemplate")
    if (
        not isinstance(result, dict)
        or result.get("id") != template_id
        or result.get("imageName") != new_image_name
    ):
        print(
            f"::error::saveTemplate did not apply {new_image_name} to template "
            f"{template_id}; RunPod answered {result!r}"
        )
        return False

    print(f"✅ Updated template {result['id']} to image: {result['imageName']}")
    # Swaps are rare (the inputs changed, or someone edited the console), so
    # every one is annotated: an overwritten console rollback shows up here.
    print(
        f"::notice title=Transcoder image replaced::{current or '(none)'} -> "
        f"{new_image_name}"
    )
    return True


def update_endpoint():
    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    docker_image_base = os.environ.get("DOCKER_IMAGE")
    image_tag = os.environ.get("IMAGE_TAG")

    # IMAGE_TAG has no default: a renamed workflow step id reads as '' with no
    # error, and `repo:` would then be written to the template.
    if not api_key or not endpoint_id or not docker_image_base or not image_tag:
        print(
            "❌ Missing required environment variables: RUNPOD_API_KEY, "
            "RUNPOD_ENDPOINT_ID, DOCKER_IMAGE, IMAGE_TAG"
        )
        sys.exit(1)

    full_image_name = f"{docker_image_base.lower()}:{image_tag}"
    print(f"🚀 Updating RunPod Endpoint {endpoint_id} to use image: {full_image_name}")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    endpoint = get_endpoint_details(headers, endpoint_id)
    if not endpoint:
        print(f"❌ Could not find endpoint {endpoint_id}")
        sys.exit(1)

    print(f"📍 Found endpoint: {endpoint['name']} (template: {endpoint['templateId']})")

    if not update_template(headers, endpoint["templateId"], full_image_name):
        sys.exit(1)

    print(f"✅ Endpoint {endpoint_id} will now use the updated template")


def config_warnings(endpoint):
    """Settings worth a warning; none of them stops a job from running."""
    warnings = []
    # v2 may omit either setting. Say so: a check that silently stops running
    # is worse than a warning that it could not run.
    idle = endpoint["idleTimeout"]
    if idle is None:
        warnings.append(
            "idleTimeout could not be read: the idle-cost check did not run."
        )
    elif idle > MAX_IDLE_TIMEOUT_S:
        warnings.append(
            f"idleTimeout is {idle} s: every job is followed by {idle} s of "
            "billed idle worker time (RunPod default 5 s)."
        )
    execution = endpoint["executionTimeoutMs"]
    if execution is None:
        warnings.append(
            "executionTimeoutMs could not be read: the check that long videos are not killed mid-encode did not run."
        )
    elif execution < MIN_EXECUTION_TIMEOUT_MS:
        warnings.append(
            f"executionTimeoutMs is {execution}: a long video is killed "
            f"mid-encode before {MIN_EXECUTION_TIMEOUT_MS} ms with no webhook."
        )
    return warnings


def _int_or_none(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _json_object(call, url, **kwargs):
    """The JSON object `call` answers with, or (None, why) when there is none."""
    try:
        response = call(url, **kwargs)
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as e:
        return None, str(e)
    if not isinstance(body, dict):
        return None, f"answer is not an object: {body!r}"
    return body, None


def _endpoint_env():
    """(api key, endpoint id), or None after naming what is missing."""
    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    if not api_key or not endpoint_id:
        print(
            "❌ Missing required environment variables: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID"
        )
        return None
    return api_key, endpoint_id


def read_endpoint(api_key, endpoint_id):
    """The endpoint's settings, or (None, why) when they could not be read.

    Flattened from REST v2's shape. Only workers.max is required: it is what
    says whether the endpoint is paused.
    """
    endpoint, why = _json_object(
        requests.get,
        f"{REST_URL}/serverless/{endpoint_id}",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    if endpoint is None:
        return None, why
    workers = endpoint.get("workers")
    workers = workers if isinstance(workers, dict) else {}
    workers_max = _int_or_none(workers.get("max"))
    if workers_max is None:
        return None, f"config lacks workers.max: {endpoint!r}"
    return {
        "workersMin": _int_or_none(workers.get("min")),
        "workersMax": workers_max,
        "idleTimeout": _int_or_none(workers.get("idleTimeout")),
        "executionTimeoutMs": _int_or_none(endpoint.get("timeout")),
    }, None


def check_endpoint_health():
    """Print the endpoint's live settings: 0 when it can take jobs.

    2 when it is paused, 3 when its settings could not be read. Both are red:
    the step runs last and blocks nothing, and a warning on a green step is
    how the 2026-10-23 pause went unseen.

    This reads configuration only, not whether a worker can start; the daily
    ping job is what proves that.
    """
    env = _endpoint_env()
    if env is None:
        return 1
    api_key, endpoint_id = env

    for attempt in range(1, HEALTH_READ_ATTEMPTS + 1):
        endpoint, why = read_endpoint(api_key, endpoint_id)
        if endpoint is not None:
            break
        print(f"⏳ Endpoint config read {attempt}/{HEALTH_READ_ATTEMPTS} failed: {why}")
        if attempt < HEALTH_READ_ATTEMPTS:
            time.sleep(2**attempt)
    else:
        print(
            f"::error::Could not read endpoint {endpoint_id}, health NOT checked: {why}"
        )
        return 3

    print(
        "⚙️  Live endpoint config: "
        f"workersMin={endpoint.get('workersMin')} "
        f"workersMax={endpoint['workersMax']} "
        f"idleTimeout={endpoint['idleTimeout']}s "
        f"executionTimeoutMs={endpoint['executionTimeoutMs']}"
        " (None = not reported for this scaling type)"
    )
    for warning in config_warnings(endpoint):
        print(f"::warning::{warning}")

    if endpoint["workersMax"] == 0:
        print(
            f"::error::Endpoint {endpoint_id} is PAUSED (workersMax=0): every "
            "transcode is rejected with 409 ENDPOINT_PAUSED. RunPod pauses an "
            "endpoint after 7 days without requests. Raise Max workers in the "
            "RunPod console (Serverless > endpoint > Edit)."
        )
        return 2
    return 0


def warm_transcoder():
    """Start a worker on the new image now: 0 once one answers a ping.

    A worker on a new image pulls it before its first job, which takes
    minutes; without this the first upload after a deploy waits for that
    (Codex-t359w). 4 when no worker answers within WARM_WAIT_S, or one ends
    the ping any way but COMPLETED: red, so a deploy whose image cannot
    start is seen at once rather than by a creator.
    """
    env = _endpoint_env()
    if env is None:
        return 1
    api_key, endpoint_id = env
    headers = {"Authorization": f"Bearer {api_key}"}

    sent, why = _json_object(
        requests.post,
        f"{JOBS_URL}/{endpoint_id}/run",
        json={"input": {"ping": True}, "policy": WARM_POLICY},
        headers=headers,
        timeout=30,
    )
    if sent is None:
        print(f"::error::The warm-up ping was not accepted: {why}")
        return 4
    job_id = sent.get("id")
    if not isinstance(job_id, str) or not job_id:
        print(f"::error::The warm-up ping was accepted without a job id: {sent!r}")
        return 4

    print(f"🔥 Warm-up ping {job_id} sent; waiting up to {WARM_WAIT_S // 60} min")
    deadline = time.monotonic() + WARM_WAIT_S
    state = None
    while time.monotonic() < deadline:
        time.sleep(WARM_POLL_S)
        job, why = _json_object(
            requests.get,
            f"{JOBS_URL}/{endpoint_id}/status/{job_id}",
            headers=headers,
            timeout=10,
        )
        if job is None:
            print(f"⏳ Status read failed, asking again: {why}")
            continue
        if job.get("status") != state:
            state = job.get("status")
            print(f"⏳ {state}")
        if state == "COMPLETED":
            delay_ms = _int_or_none(job.get("delayTime"))
            waited = (
                f"{delay_ms / 1000:.0f}s"
                if delay_ms is not None
                else "an unreported time"
            )
            print(
                f"✅ Transcoder warm: a worker answered after {waited} in RunPod's queue"
            )
            return 0
        if state in JOB_ENDED:
            print(
                f"::error::The warm-up ping ended {state}: "
                f"{str(job.get('error'))[:500]}. The new image may not start."
            )
            return 4

    print(
        f"::error::No worker answered the warm-up ping within {WARM_WAIT_S // 60} "
        f"minutes (last state: {state}). Uploads wait for one too: check the "
        "endpoint's workers in the RunPod console."
    )
    return 4


def main(argv):
    if argv == ["--health"]:
        return check_endpoint_health()
    if argv == ["--warm"]:
        return warm_transcoder()
    update_endpoint()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
