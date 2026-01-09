import os
import sys
import requests
import json

# Configuration
API_URL = "https://api.runpod.io/graphql"
TEMPLATE_NAME = "codex-transcoder-template"
ENDPOINT_NAME = "codex-transcoder-endpoint"
# Using 24GB VRAM GPU (RTX 3090 / A10G class)
GPU_ID = "AMPERE_24"
IMAGE_NAME = "ghcr.io/brucemckayone/codex-transcoder:latest"

def run_query(query, variables=None, api_key=None):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    response = requests.post(
        API_URL,
        json={"query": query, "variables": variables},
        headers=headers,
        timeout=30
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

def save_template(api_key):
    print(f"Creating Template: {TEMPLATE_NAME}...")
    query = """
    mutation saveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) {
            id
            name
        }
    }
    """
    variables = {
        "input": {
            "name": TEMPLATE_NAME,
            "imageName": IMAGE_NAME,
            "containerDiskInGb": 20,
            "volumeInGb": 0,
            "dockerArgs": "python3 -u handler/main.py",
            "env": [
                {"key": "RUNPOD_DEBUG", "value": "true"}
            ],
            "isServerless": True
        }
    }
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
            "workersMax": 5
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
        # 1. Find or Create Template
        templates = get_user_templates(api_key)
        template_id = None
        for t in templates:
            if t["name"] == TEMPLATE_NAME:
                template_id = t["id"]
                print(f"✅ Found existing template: {template_id}")
                break

        if not template_id:
            template = save_template(api_key)
            template_id = template["id"]
            print(f"✅ Created new template: {template_id}")

        # 2. Create Endpoint (RunPod API doesn't easily list endpoints by name in simple query,
        # usually you list all and filter. For safety we just create new or you'd manage IDs manually)
        # We will attempt to create one. If name constraint exists, it might fail or create duplicate.
        # RunPod allows duplicate names. We will create a new one to be sure.

        endpoint = save_endpoint(api_key, template_id)
        endpoint_id = endpoint["id"]

        print("\n🎉 Success!")
        print(f"RunPod Endpoint ID: {endpoint_id}")
        print("\n⚠️  IMPORTANT NEXT STEPS:")
        print("1. Go to RunPod Console -> Settings -> Container Registries.")
        print("2. Add your GitHub Container Registry credentials (GH PAT).")
        print(f"3. Go to Templates -> Edit '{TEMPLATE_NAME}'.")
        print("4. Select your new Registry Credential in the dropdown and Save.")
        print(f"5. Add the Endpoint ID to GitHub Secrets: gh secret set RUNPOD_ENDPOINT_ID --body \"{endpoint_id}\"")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
