import os
import sys
import requests


def update_endpoint():
    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    # Docker image is composed in workflow: username/repo:tag
    # We expect these to be passed or constructed.
    # The workflow passes IMAGE_TAG. We need the full image name.
    # Usually: docker_username/codex-transcoder:tag
    # For now, let's look for DOCKER_IMAGE env var + IMAGE_TAG
    docker_image_base = os.environ.get("DOCKER_IMAGE")  # e.g. "ghcr.io/owner/repo"
    image_tag = os.environ.get("IMAGE_TAG", "latest")

    if not api_key or not endpoint_id or not docker_image_base:
        print(
            "❌ Missing required environment variables: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, DOCKER_IMAGE"
        )
        sys.exit(1)

    # RunPod/Docker requires lowercase for image names
    full_image_name = f"{docker_image_base.lower()}:{image_tag}"
    print(f"🚀 Updating RunPod Endpoint {endpoint_id} to use image: {full_image_name}")

    url = "https://api.runpod.io/graphql"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # GraphQL Mutation
    # We update the imageId using saveEndpoint (RunPod API changed from updateEndpoint).
    # Note: RunPod might not pull if the tag string is identical unless we force it.
    # One trick is to toggle a dummy env var or rely on hash tags (which we are doing: sha-xxxx).

    mutation = """
    mutation saveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) {
            id
            name
            templateId
        }
    }
    """

    variables = {"input": {"id": endpoint_id, "templateId": full_image_name}}

    response = requests.post(
        url,
        json={"query": mutation, "variables": variables},
        headers=headers,
        timeout=30,
    )

    if response.status_code != 200:
        print(f"❌ API Request failed: {response.status_code} - {response.text}")
        sys.exit(1)

    data = response.json()
    if "errors" in data:
        print(f"❌ GraphQL Errors: {data['errors']}")
        sys.exit(1)

    result = data.get("data", {}).get("saveEndpoint")
    print(f"✅ Successfully updated endpoint {result['id']} to {result['templateId']}")


if __name__ == "__main__":
    update_endpoint()
