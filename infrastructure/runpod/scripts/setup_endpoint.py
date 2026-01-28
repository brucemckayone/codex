import os
import sys
import requests

# Configuration
API_URL = "https://api.runpod.io/graphql"
TEMPLATE_NAME = "codex-transcoder-template"
ENDPOINT_NAME = "codex-transcoder-endpoint"
# Using 24GB VRAM GPU (RTX 3090 / A10G class)
GPU_ID = "AMPERE_24"
IMAGE_NAME = "ghcr.io/brucemckayone/codex-transcoder:latest"


def run_query(query, variables=None, api_key=None):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    response = requests.post(
        API_URL,
        json={"query": query, "variables": variables},
        headers=headers,
        timeout=30,
    )
    if response.status_code != 200:
        raise Exception(f"Query failed: {response.status_code} {response.text}")

    data = response.json()
    if "errors" in data:
        raise Exception(f"GraphQL Errors: {data['errors']}")

    return data["data"]


def get_user_templates(api_key):
    query = """
    query getUserTemplates {
        myself {
            podTemplates {
                id
                name
            }
        }
    }
    """
    data = run_query(query, api_key=api_key)
    return data["myself"]["podTemplates"]


def get_registry_auths(api_key):
    query = """
    query getUserRegistryAuths {
        myself {
            containerRegistryAuths {
                id
                username
                registryId
            }
        }
    }
    """
    try:
        data = run_query(query, api_key=api_key)
        return data["myself"]["containerRegistryAuths"]
    except Exception:
        print(
            "⚠️  Could not fetch registry auths (query might differ). Skipping auto-link."
        )
        return []


def save_template(api_key, registry_auth_id=None):
    print(f"Creating Template: {TEMPLATE_NAME}...")
    query = """
    mutation saveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) {
            id
            name
        }
    }
    """
    input_vars = {
        "name": TEMPLATE_NAME,
        "imageName": IMAGE_NAME,
        "containerDiskInGb": 20,
        "volumeInGb": 0,
        "dockerArgs": "python3 -u handler/main.py",
        "env": [
            {"key": "RUNPOD_DEBUG", "value": "true"},
            # B2 credentials from RunPod secret manager (not in job payload)
            {"key": "B2_ENDPOINT", "value": "{{ RUNPOD_SECRET_b2_endpoint }}"},
            {
                "key": "B2_ACCESS_KEY_ID",
                "value": "{{ RUNPOD_SECRET_b2_access_key_id }}",
            },
            {
                "key": "B2_SECRET_ACCESS_KEY",
                "value": "{{ RUNPOD_SECRET_b2_secret_access_key }}",
            },
            {"key": "B2_BUCKET_NAME", "value": "{{ RUNPOD_SECRET_b2_bucket_name }}"},
            # R2 credentials from RunPod secret manager (not in job payload)
            {"key": "R2_ENDPOINT", "value": "{{ RUNPOD_SECRET_r2_endpoint }}"},
            {
                "key": "R2_ACCESS_KEY_ID",
                "value": "{{ RUNPOD_SECRET_r2_access_key_id }}",
            },
            {
                "key": "R2_SECRET_ACCESS_KEY",
                "value": "{{ RUNPOD_SECRET_r2_secret_access_key }}",
            },
            {"key": "R2_BUCKET_NAME", "value": "{{ RUNPOD_SECRET_r2_bucket_name }}"},
        ],
        "isServerless": True,
    }

    if registry_auth_id:
        input_vars["containerRegistryAuthId"] = registry_auth_id

    variables = {"input": input_vars}

    data = run_query(query, variables, api_key)
    return data["saveTemplate"]


def save_endpoint(api_key, template_id):
    print(f"Creating Endpoint: {ENDPOINT_NAME}...")
    query = """
    mutation saveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) {
            id
            name
            gpuIds
        }
    }
    """
    variables = {
        "input": {
            "name": ENDPOINT_NAME,
            "templateId": template_id,
            "gpuIds": GPU_ID,
            "networkVolumeId": None,
            "locations": None,
            "idleTimeout": 600,
            "scalerType": "QUEUE_DELAY",
            "workersMin": 0,
            "workersMax": 5,
        }
    }
    data = run_query(query, variables, api_key)
    return data["saveEndpoint"]


def main():
    api_key = os.environ.get("RUNPOD_API_KEY")
    if not api_key:
        print("❌ Please set RUNPOD_API_KEY environment variable.")
        sys.exit(1)

    try:
        # 0. Find Registry Creds (Auto-detect)
        auths = get_registry_auths(api_key)
        registry_auth_id = None
        for auth in auths:
            # Look for explicit GHCR or just use the first/only one if user only has one
            # GitHub integration usually shows up as "ghcr.io" or "github" in registryId or similar
            # If manually added, it could be anything.
            print(f"Found Registry Auth: {auth['id']} ({auth.get('username')})")
            if "ghcr" in str(auth).lower() or "github" in str(auth).lower():
                registry_auth_id = auth["id"]
                print(f"✅ Auto-selected Registry Auth: {registry_auth_id}")
                break

        if not registry_auth_id and auths:
            # Fallback to first if only one exists
            registry_auth_id = auths[0]["id"]
            print(
                f"⚠️  No explicit 'ghcr' auth found, defaulting to: {registry_auth_id}"
            )

        # 1. Find or Create Template
        templates = get_user_templates(api_key)
        template_id = None
        for t in templates:
            if t["name"] == TEMPLATE_NAME:
                template_id = t["id"]
                print(f"✅ Found existing template: {template_id}")
                break

        if not template_id:
            template = save_template(api_key, registry_auth_id)
            template_id = template["id"]
            print(f"✅ Created new template: {template_id}")

        # 2. Create Endpoint
        endpoint = save_endpoint(api_key, template_id)
        endpoint_id = endpoint["id"]

        print("\n🎉 Success!")
        print(f"RunPod Endpoint ID: {endpoint_id}")

        if not registry_auth_id:
            print("\n⚠️  WARNING: No Container Registry Auth linked to Template.")
            print(
                "You MUST go to RunPod Console -> Templates -> Edit -> Select Registry -> Save."
            )

        print(
            f'\nAdd to GitHub: gh secret set RUNPOD_ENDPOINT_ID --body "{endpoint_id}"'
        )

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
