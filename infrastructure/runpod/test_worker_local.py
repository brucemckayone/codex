import os
import sys
import shutil
import json
from unittest.mock import MagicMock, patch

# --- Mocking Libraries BEFORE import ---
# Prevent runpod.serverless.start from blocking
mock_runpod = MagicMock()
sys.modules["runpod"] = mock_runpod

# --- Import Handler ---
# Add /app to python path to mimic Docker environment
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from handler.main import handler
except ImportError:
    # If running locally outside docker, adjust path
    sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from handler.main import handler

# --- Configuration ---
INPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_assets/input")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_assets/output")
TEST_MEDIA_ID = "test-media-123"
TEST_CREATOR_ID = "user-123"

class LocalStorageClient:
    def __init__(self, name):
        self.name = name

    def download_file(self, bucket, key, local_path):
        # Simulate download from INPUT_DIR
        # Input key typically: "originals/uuid/video.mp4"
        # We'll map that to INPUT_DIR/video.mp4 for simplicity in this test
        filename = os.path.basename(key)
        source_path = os.path.join(INPUT_DIR, filename)

        print(f"[{self.name}] Downloading {source_path} -> {local_path}")
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source file not found: {source_path}")

        shutil.copy2(source_path, local_path)

    def upload_file(self, local_path, bucket, key, ExtraArgs=None):
        # Simulate upload to OUTPUT_DIR
        # Key: "user-123/hls/..."
        dest_path = os.path.join(OUTPUT_DIR, key)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        print(f"[{self.name}] Uploading {local_path} -> {dest_path}")
        shutil.copy2(local_path, dest_path)

# --- Test Execution ---
def run_test():
    print("=== Starting Local RunPod Worker Test ===")

    # 1. Mock External Services
    with patch("handler.main.create_s3_client") as mock_create_client, \
         patch("requests.post") as mock_post, \
         patch("handler.main.check_gpu_available", return_value=False):  # Force CPU mode

        # S3 Mocks return our LocalStorageClient
        mock_create_client.side_effect = lambda e, a, s: LocalStorageClient("R2" if "r2" in e else "B2")

        # Webhook Mock
        mock_post.return_value.status_code = 200

        # ... (rest of payload setup matches existing) ...
        # 2. Prepare Payload
        payload = {
            "input": {
                "mediaId": TEST_MEDIA_ID,
                "creatorId": TEST_CREATOR_ID,
                "type": "video",
                "inputKey": "originals/test/video.mp4",
                "webhookUrl": "http://localhost:3000/webhook",
                "webhookSecret": "test-secret",
                "r2Endpoint": "https://r2.example.com",
                "r2AccessKeyId": "dummy",
                "r2SecretAccessKey": "dummy",
                "r2BucketName": "codex-media",
                "b2Endpoint": "https://b2.example.com",
                "b2AccessKeyId": "dummy",
                "b2SecretAccessKey": "dummy",
                "b2BucketName": "codex-archive",
                "b2BucketName": "codex-archive",
            }
        }

        # 3. Run Handler
        print("\n--- Invoking Handler ---")
        try:
            result = handler(payload)
            print("\n--- Handler Finished ---")
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(f"\nFATAL: Handler failed: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

        # 4. Verify Webhooks
        print("\n--- Verifying Webhook ---")
        if mock_post.called:
            args, kwargs = mock_post.call_args
            print(f"Webhook URL: {args[0]}")

            # Extract payload from data (preferred) or json kwarg
            request_body = kwargs.get('data') or kwargs.get('json')
            if not request_body and len(args) > 1:
                request_body = args[1]

            print("Payload:")
            print(request_body)

            # Check for success
            try:
                data = json.loads(request_body) if isinstance(request_body, str) else request_body
                print(json.dumps(data, indent=2))

                if data['status'] == 'completed':
                    print("\n✅ SUCCESS: Transcoding completed successfully")
                else:
                    print(f"\n❌ FAILED: Transcoding status is {data['status']}")
                    print(f"Error: {data.get('error')}")
                    sys.exit(1)
            except Exception as e:
                 print(f"Failed to parse webhook body: {e}")
                 sys.exit(1)
        else:
            print("\n❌ FAILED: No webhook sent")
            sys.exit(1)

if __name__ == "__main__":
    run_test()
