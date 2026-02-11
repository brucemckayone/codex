# RunPod Migration Notes

## ASSETS_BUCKET Credential Simplification

**Date**: 2026-02-11
**Affects**: All RunPod deployments

### What Changed

The ASSETS_BUCKET (for public CDN thumbnails) now uses the same R2 credentials as MEDIA_BUCKET instead of separate `ASSETS_R2_*` environment variables. Both buckets are in the same Cloudflare R2 account, so shared credentials work.

### Required Action

1. Add `ASSETS_BUCKET_NAME` as a new secret in the RunPod console
2. Ensure `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are set (these should already exist for MEDIA_BUCKET)

### Cleanup (Optional)

Remove these deprecated variables from RunPod secrets if they exist:
- `ASSETS_R2_ENDPOINT`
- `ASSETS_R2_ACCESS_KEY_ID`
- `ASSETS_R2_SECRET_ACCESS_KEY`
