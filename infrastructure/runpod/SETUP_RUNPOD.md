# RunPod & GHCR Setup Guide

Since our GitHub repository is private, the Docker image we publish to GitHub Container Registry (GHCR) is also private by default. Access must be granted to RunPod clearly.

## 1. Create a GitHub Personal Access Token (PAT)

RunPod needs a token to pull the image.

1.  Go to **GitHub Settings** -> **Developer Settings** -> **Personal Access Tokens (Classic)**.
2.  Click **Generate new token (classic)**.
3.  **Note**: `RunPod Puller`
4.  **Scopes**: select `read:packages`.
5.  **Generate** and copy the token (starts with `ghp_`).

## 2. Add Registry to RunPod

1.  Log in to the **RunPod Console**.
2.  Go to **Settings** (User Profile) -> **Container Registries**.
3.  Click **New Registry Secret**.
4.  **Provider**: GitHub Container Registry (ghcr.io)
5.  **Username**: Your GitHub username (e.g., `brucemckay`)
6.  **Password**: The PAT you just created (`ghp_...`).
7.  Click **Add Registry**.

## 3. Deployment Flow (First Time)

Before the CI/CD pipeline can *update* an endpoint, you must create it manually once so it exists.

1.  **Push the Image**: Trigger the GitHub Actions workflow manually or by pushing a change. This will build and push `ghcr.io/brucemckayone/codex-transcoder:latest` for the first time.
2.  **Create Endpoint**:
    -   Go to **Serverless** -> **New Endpoint**.
    -   **Container Image**: `ghcr.io/brucemckayone/codex-transcoder:latest`
    -   **Container Registry Credentials**: Select the secret you created in Step 2.
    -   **FlashBoot**: Enabled (recommended).
    -   **GPU**: Select desired tier (e.g., RTX 3090 / 4090).
    -   **Idle Timeout**: `600` (10 minutes) or as preferred.
    -   Click **Create**.
3.  **Get Endpoint ID**:
    -   Once created, copy the ID (e.g., `vllm-xxxxx` or similar formatted ID).
    -   Add this ID as a GitHub Secret named `RUNPOD_ENDPOINT_ID`.

## 4. Updates

Future updates are automated. When you push to `main`:
1.  GitHub Action builds new image `sha-xyz`.
2.  Pushes to GHCR.
3.  Updates RunPod Endpoint configuration to use `sha-xyz`.
4.  RunPod performs a rolling update to workers.
