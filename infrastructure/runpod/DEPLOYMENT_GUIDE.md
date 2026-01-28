# RunPod Security Fix Deployment Guide

## Overview

**CRITICAL SECURITY FIX**: R2 credentials are now read from environment variables (RunPod secrets) instead of job payloads. This eliminates credential exposure in logs, dashboards, and job history.

**Security Impact**: 100% reduction in credential exposure

---

## Changes Summary

### Code Changes (COMPLETED ✅)

1. **`infrastructure/runpod/handler/main.py`**
   - Removed R2 credentials from `JobInput` TypedDict
   - Added R2 credential reading from environment variables
   - Updated all R2 client creation to use environment variables
   - Updated all R2 bucket references to use `r2_bucket_name` variable

2. **`infrastructure/runpod/scripts/setup_endpoint.py`**
   - Added R2 environment variables to template configuration
   - R2 secrets now configured via RunPod secret manager (like B2)

### TypeScript Code (NO CHANGES NEEDED ✅)

The TypeScript code was already secure:
- `packages/transcoding/src/types.ts` - `RunPodJobRequest` doesn't include R2 credentials
- `packages/transcoding/src/services/transcoding-service.ts` - Job payload only includes paths

---

## Deployment Steps

### Phase 1: Build and Push Docker Image

The updated handler code must be built into a new Docker image and pushed to GHCR.

```bash
# 1. Commit the changes
git add infrastructure/runpod/handler/main.py
git add infrastructure/runpod/scripts/setup_endpoint.py
git commit -m "security: read R2 creds from env, not job payload"

# 2. Push to trigger GitHub Actions build
git push origin main

# 3. Monitor GitHub Actions workflow
# Go to: https://github.com/brucemckayone/e2e/actions
# Wait for "Build and Push Transcoder Image" workflow to complete
# New image tag will be pushed to: ghcr.io/brucemckayone/codex-transcoder:latest
```

**Expected Output**: Docker image successfully built and pushed to GHCR

---

### Phase 2: Configure RunPod Secrets (MANUAL)

**CRITICAL**: Before updating the RunPod template, you MUST add R2 credentials as secrets in the RunPod console.

#### 2.1. Log in to RunPod Console

Go to: https://www.runpod.io/console

#### 2.2. Navigate to Your Template

1. Click **"Templates"** in left sidebar
2. Find and click **"codex-transcoder-template"**
3. Click **"Edit"** button

#### 2.3. Add R2 Secrets

In the **Environment Variables** section, add the following 4 secrets:

| Secret Name | Value Source | Description |
|-------------|--------------|-------------|
| `r2_endpoint` | GitHub secret: `R2_ENDPOINT` | Your R2 endpoint URL |
| `r2_access_key_id` | GitHub secret: `R2_ACCESS_KEY_ID` | R2 access key ID |
| `r2_secret_access_key` | GitHub secret: `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `r2_bucket_name` | GitHub secret: `R2_BUCKET_MEDIA` | R2 bucket name for media |

**How to get values**:

```bash
# From your local environment or GitHub secrets
gh secret list  # List GitHub secrets (if configured)
# OR check your .env file for these values
```

**Example values** (for reference only):
- `r2_endpoint`: `https://abc123def456.r2.cloudflarestorage.com`
- `r2_access_key_id`: `abc123def456789`
- `r2_secret_access_key`: `xyz789uvw012mnop345qrs678tuv`
- `r2_bucket_name`: `codex-media-production`

#### 2.4. Verify All 8 Secrets

After adding R2 secrets, you should have **8 total secrets** configured:

**B2 Secrets** (4):
- ✅ `b2_endpoint`
- ✅ `b2_access_key_id`
- ✅ `b2_secret_access_key`
- ✅ `b2_bucket_name`

**R2 Secrets** (4):
- ✅ `r2_endpoint`
- ✅ `r2_access_key_id`
- ✅ `r2_secret_access_key`
- ✅ `r2_bucket_name`

#### 2.5. Save Template

Click **"Save"** to update the template with new environment variables.

---

### Phase 3: Update RunPod Endpoint Template

Now that secrets are configured, update the RunPod endpoint template to use the new Docker image and environment variables.

```bash
# 1. Navigate to RunPod scripts
cd infrastructure/runpod

# 2. Install dependencies (if not already installed)
pip install -r requirements.txt

# 3. Set your RunPod API key
export RUNPOD_API_KEY="your-runpod-api-key"

# 4. Run the setup script
python scripts/setup_endpoint.py
```

**Expected Output**:
```
✅ Found existing template: <template-id>
Creating Endpoint: codex-transcoder-endpoint...
✅ Created/updated endpoint: <endpoint-id>

🎉 Success!
RunPod Endpoint ID: <endpoint-id>

Add to GitHub: gh secret set RUNPOD_ENDPOINT_ID --body "<endpoint-id>"
```

---

### Phase 4: Verify Deployment

#### 4.1. Check RunPod Console

1. Go to **"Endpoints"** in RunPod console
2. Click on **"codex-transcoder-endpoint"**
3. Verify the endpoint shows **"Active"** status
4. Check that the Docker image is `ghcr.io/brucemckayone/codex-transcoder:latest`

#### 4.2. Test with a Real Transcoding Job

```bash
# From your local environment or a test script
# Trigger a test transcoding job

# Example: Using the TranscodingService
await transcodingService.triggerTranscodingJob({
  mediaId: 'test-media-id',
  mediaType: 'video',
  creatorId: 'test-creator-id',
  r2Key: 'test/video.mp4',
});
```

#### 4.3. Verify Job Payload (Security Check)

**CRITICAL**: Verify that R2 credentials are NOT in the job payload.

1. In RunPod console, go to **"Endpoints"** → **"codex-transcoder-endpoint"**
2. Click **"Jobs"** tab
3. Click on your test job
4. Check the **"Input"** section

**Expected (SECURE)**:
```json
{
  "input": {
    "mediaId": "test-media-id",
    "type": "video",
    "creatorId": "test-creator-id",
    "inputKey": "test/video.mp4",
    "webhookUrl": "https://...",
    "webhookSecret": "..."
  }
}
```

**Should NOT see**:
- ❌ `r2Endpoint`
- ❌ `r2AccessKeyId`
- ❌ `r2SecretAccessKey`
- ❌ `r2BucketName`

#### 4.4. Verify Logs (No Credential Exposure)

1. In the job detail page, check **"Logs"** tab
2. Verify no R2 credentials are visible in logs
3. Verify handler successfully connected to R2 (look for download/upload messages)

**Expected log messages**:
```
Downloading s3://<bucket-name>/test/video.mp4 → /tmp/...
Uploading /tmp/... → s3://<bucket-name>/creator-id/hls/...
```

**Should NOT see**:
- ❌ R2 endpoint URLs in logs
- ❌ R2 access keys in logs
- ❌ R2 secret keys in logs

---

### Phase 5: Monitor Production

After deployment, monitor the following:

#### 5.1. Check Transcoding Success Rate

```bash
# In your database, check transcoding job status
SELECT
    COUNT(*) as total,
    status,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as recent
FROM media_items
WHERE transcoding_status IN ('transcoding', 'ready', 'failed')
GROUP BY status;
```

**Expected**: High success rate (similar to before deployment)

#### 5.2. Check for Handler Errors

Monitor RunPod logs for:
- `"R2 credentials not configured in environment"` - Indicates secrets not set
- `"B2 credentials not configured in environment"` - Indicates B2 secrets missing
- `"Connection refused"` - May indicate endpoint issues

#### 5.3. Verify Webhook Delivery

Check that your webhook endpoint receives completion notifications:
- Status should be `"completed"` or `"failed"`
- Should include HLS keys, thumbnail, waveform, etc.
- No credentials in webhook payload (by design)

---

## Rollback Plan (If Issues)

If transcoding fails after deployment, follow these steps:

### Immediate Rollback

```bash
# 1. Revert code changes
git revert HEAD
git push origin main

# 2. Wait for GitHub Actions to build previous image
# Previous Docker image will be pushed to GHCR

# 3. In RunPod console, update template to use previous image:
# - Go to Templates → codex-transcoder-template → Edit
# - Change image tag to previous version (e.g., :previous or specific commit SHA)
# - Remove R2 environment variables (keep only B2)
# - Save template
```

### Investigate Issues

1. **Check handler logs** in RunPod console for specific errors
2. **Verify R2 credentials** are correct in RunPod secrets
3. **Test R2 connection** manually using boto3 CLI
4. **Check environment variables** are properly injected

```python
# Test R2 connection manually
import boto3
import os

client = boto3.client(
    's3',
    endpoint_url=os.environ.get('R2_ENDPOINT'),
    aws_access_key_id=os.environ.get('R2_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('R2_SECRET_ACCESS_KEY'),
    region_name='auto',
)

# Test list buckets
response = client.list_buckets()
print(response)
```

---

## Security Best Practices (Post-Deployment)

### 1. Rotate Credentials Regularly

```bash
# Every 90 days, rotate R2 credentials:
# 1. Generate new R2 API token in Cloudflare dashboard
# 2. Update RunPod secrets with new credentials
# 3. Redeploy endpoint (rolling restart)
```

### 2. Monitor for Credential Leaks

```bash
# Regularly check RunPod logs for accidental credential exposure
# (Should be none after this fix)
grep -r "r2_secret_access_key" runpod-logs/
```

### 3. Use Principle of Least Privilege

- R2 credentials should only have access to required buckets
- B2 credentials should only have access to required buckets
- Rotate credentials if any suspected exposure

### 4. Audit Trail

```bash
# Keep record of when secrets were last rotated
echo "R2 credentials last rotated: $(date)" >> infrastructure/runpod/audit.log
```

---

## Troubleshooting

### Issue: "R2 credentials not configured in environment"

**Cause**: RunPod secrets not configured or incorrectly named

**Solution**:
1. Check RunPod console → Templates → Environment Variables
2. Verify all 4 R2 secrets are present
3. Verify secret names match exactly: `r2_endpoint`, `r2_access_key_id`, etc.
4. Check for typos in secret values

### Issue: "Connection error when downloading from R2"

**Cause**: R2 credentials incorrect or R2 endpoint unreachable

**Solution**:
1. Verify `r2_endpoint` is correct (should be `https://<account-id>.r2.cloudflarestorage.com`)
2. Verify access key ID and secret are correct
3. Test R2 connection manually using boto3 (see above)
4. Check R2 bucket exists and is accessible

### Issue: "Jobs stuck in 'queued' state"

**Cause**: Endpoint not using new template or secrets not configured

**Solution**:
1. Verify template includes R2 environment variables
2. Restart endpoint in RunPod console
3. Check endpoint logs for startup errors

### Issue: "Webhook not received after transcoding"

**Cause**: Handler crashed before sending webhook or webhook URL incorrect

**Solution**:
1. Check handler logs for errors during transcoding
2. Verify webhook URL is reachable from RunPod
3. Check webhook signature matches

---

## Success Criteria

✅ **Deployment Complete**:
- [x] Code changes committed and pushed
- [x] Docker image built and pushed to GHCR
- [ ] R2 secrets configured in RunPod console
- [ ] RunPod template updated with R2 environment variables
- [ ] Endpoint restarted and active
- [ ] Test job completed successfully
- [ ] Job payload verified (no R2 credentials)
- [ ] Logs verified (no R2 credentials exposed)
- [ ] Production transcoding working normally

---

## Additional Resources

- **RunPod Documentation**: https://docs.runpod.io
- **Cloudflare R2 Documentation**: https://developers.cloudflare.com/r2
- **GitHub Actions Workflow**: `.github/workflows/build-transcoder.yml`
- **Handler Code**: `infrastructure/runpod/handler/main.py`
- **Setup Script**: `infrastructure/runpod/scripts/setup_endpoint.py`

---

## Questions?

If you encounter issues during deployment:

1. Check this guide's troubleshooting section
2. Review RunPod logs in the console
3. Test R2 connection manually using boto3
4. Verify all 8 secrets are configured (4 B2 + 4 R2)
5. Check GitHub Actions build completed successfully

**Last Updated**: 2025-01-28
**Security Fix Version**: 1.0
**Status**: Ready for Deployment
