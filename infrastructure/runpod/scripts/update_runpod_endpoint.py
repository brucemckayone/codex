"""Deploy a new transcoder image to the RunPod endpoint, and check its health.

    python update_runpod_endpoint.py           # swap the endpoint's image
    python update_runpod_endpoint.py --health  # read the endpoint's live settings

They are separate workflow steps so a paused endpoint turns the health step
red while the deploy step, which did its job, stays green.
"""

import os
import sys
import requests

GRAPHQL_URL = "https://api.runpod.io/graphql"
REST_URL = "https://rest.runpod.io/v1"

# An idle worker is billed while it waits for the next job.
MAX_IDLE_TIMEOUT_S = 60
# A job is killed at the endpoint's execution timeout, with no webhook.
MIN_EXECUTION_TIMEOUT_MS = 60 * 60 * 1000
HEALTH_FIELDS = ("workersMax", "idleTimeout", "executionTimeoutMs")


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

    mutation = """
    mutation saveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) {
            id
            name
            imageName
        }
    }
    """

    # saveTemplate replaces the template, so every field it holds is sent back
    # as read. Dropping `env` would delete the RunPod secret mappings.
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
    return True


def update_endpoint():
    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    docker_image_base = os.environ.get("DOCKER_IMAGE")
    image_tag = os.environ.get("IMAGE_TAG", "latest")

    if not api_key or not endpoint_id or not docker_image_base:
        print(
            "❌ Missing required environment variables: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, DOCKER_IMAGE"
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
    idle = endpoint["idleTimeout"]
    if idle > MAX_IDLE_TIMEOUT_S:
        warnings.append(
            f"idleTimeout is {idle} s: every job is followed by {idle} s of "
            "billed idle worker time (RunPod default 5 s)."
        )
    execution = endpoint["executionTimeoutMs"]
    if execution < MIN_EXECUTION_TIMEOUT_MS:
        warnings.append(
            f"executionTimeoutMs is {execution}: a long video is killed "
            f"mid-encode before {MIN_EXECUTION_TIMEOUT_MS} ms with no webhook."
        )
    return warnings


def check_endpoint_health():
    """Print the endpoint's live settings; 2 when it cannot take jobs, else 0.

    A settings read that fails is a warning, not a failure: the check could not
    run, which says nothing about the endpoint.
    """
    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    if not api_key or not endpoint_id:
        print(
            "❌ Missing required environment variables: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID"
        )
        return 1

    try:
        response = requests.get(
            f"{REST_URL}/endpoints/{endpoint_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        response.raise_for_status()
        endpoint = response.json()
    except (requests.RequestException, ValueError) as e:
        print(f"::warning::Could not read endpoint config, health NOT checked: {e}")
        return 0

    if not isinstance(endpoint, dict):
        print(
            f"::warning::Endpoint config is not an object, health NOT checked: {endpoint!r}"
        )
        return 0
    missing = [f for f in HEALTH_FIELDS if not isinstance(endpoint.get(f), int)]
    if missing:
        print(
            f"::warning::Endpoint config lacks {', '.join(missing)}, health NOT "
            f"checked: {endpoint!r}"
        )
        return 0

    print(
        "⚙️  Live endpoint config: "
        f"workersMin={endpoint.get('workersMin')} "
        f"workersMax={endpoint['workersMax']} "
        f"idleTimeout={endpoint['idleTimeout']}s "
        f"executionTimeoutMs={endpoint['executionTimeoutMs']}"
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


def main(argv):
    if argv == ["--health"]:
        return check_endpoint_health()
    update_endpoint()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
