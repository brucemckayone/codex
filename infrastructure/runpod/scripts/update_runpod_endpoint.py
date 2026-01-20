import os
import sys
import requests


def get_endpoint_details(url, headers, endpoint_id):
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

    response = requests.post(
        url,
        json={"query": query},
        headers=headers,
        timeout=30,
    )

    if response.status_code != 200:
        print(f"❌ Failed to query endpoints: {response.status_code} - {response.text}")
        return None

    data = response.json()
    if "errors" in data:
        print(f"❌ GraphQL Errors: {data['errors']}")
        return None

    endpoints = data.get("data", {}).get("myself", {}).get("endpoints", [])

    # Find the matching endpoint
    for endpoint in endpoints:
        if endpoint["id"] == endpoint_id:
            return endpoint

    print(f"❌ Endpoint {endpoint_id} not found in {len(endpoints)} endpoints")
    return None


def update_template(url, headers, template_id, new_image_name):
    """Update template with new Docker image."""
    # First get the template details
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

    response = requests.post(
        url,
        json={"query": query},
        headers=headers,
        timeout=30,
    )

    if response.status_code != 200:
        print(f"❌ Failed to query templates: {response.status_code} - {response.text}")
        return False

    data = response.json()
    templates = data.get("data", {}).get("myself", {}).get("podTemplates", [])

    # Find the matching template
    template = None
    for t in templates:
        if t["id"] == template_id:
            template = t
            break

    if not template:
        print(f"❌ Template {template_id} not found")
        return False

    print(
        f"📦 Found template: {template['name']} (current image: {template['imageName']})"
    )

    # Update the template with new image
    mutation = """
    mutation saveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) {
            id
            name
            imageName
        }
    }
    """

    # Convert env list to the format expected by the API
    env_vars = template.get("env") or []

    variables = {
        "input": {
            "id": template_id,
            "name": template["name"],
            "imageName": new_image_name,
            "containerDiskInGb": template.get("containerDiskInGb", 10),
            "volumeInGb": template.get("volumeInGb", 0),
            "dockerArgs": template.get("dockerArgs") or "",
            "env": env_vars,
            "isServerless": True,
        }
    }

    response = requests.post(
        url,
        json={"query": mutation, "variables": variables},
        headers=headers,
        timeout=30,
    )

    if response.status_code != 200:
        print(f"❌ API Request failed: {response.status_code} - {response.text}")
        return False

    data = response.json()
    if "errors" in data:
        print(f"❌ GraphQL Errors: {data['errors']}")
        return False

    result = data.get("data", {}).get("saveTemplate")
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

    url = "https://api.runpod.io/graphql"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # Get current endpoint details
    endpoint = get_endpoint_details(url, headers, endpoint_id)
    if not endpoint:
        print(f"❌ Could not find endpoint {endpoint_id}")
        sys.exit(1)

    print(f"📍 Found endpoint: {endpoint['name']} (template: {endpoint['templateId']})")

    # Update the template associated with this endpoint
    if not update_template(url, headers, endpoint["templateId"], full_image_name):
        sys.exit(1)

    print(f"✅ Endpoint {endpoint_id} will now use the updated template")


if __name__ == "__main__":
    update_endpoint()
