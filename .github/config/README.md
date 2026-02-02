# Infrastructure Configuration

This directory contains declarative configuration files for Codex platform infrastructure.

## R2 Infrastructure (`r2-infrastructure.json`)

Defines R2 bucket configuration for public media CDN:
- **Public access settings** - Custom domains and r2.dev URL control
- **DNS records** - CNAME configuration for CDN subdomains
- **Cache rules** - Cloudflare cache behavior and Smart Tiered Cache
- **Wrangler bindings** - Environment-specific R2_PUBLIC_URL_BASE values

### Configuration Structure

```json
{
  "buckets": {
    "codex-media-{env}": {
      "publicAccess": {
        "enabled": true,
        "customDomain": "cdn.revelations.studio",
        "minTls": "1.2",
        "disableR2DevUrl": true
      },
      "cache": {
        "enabled": true,
        "smartTieredCache": true,
        "ruleName": "Cache R2 Media Assets - Production"
      },
      "dns": {
        "subdomain": "cdn",
        "type": "CNAME",
        "proxied": true
      }
    }
  }
}
```

### How It Works

1. **Config Changes** - Push changes to `r2-infrastructure.json` on main branch
2. **CI Verification** - GitHub Actions workflow verifies current infrastructure state
3. **Auto-Apply** - If config differs from actual state, changes are applied automatically
4. **Idempotent** - Safe to run multiple times, only applies needed changes

### Management Script

`.github/scripts/manage-r2-infrastructure.sh` implements:

**Verify Mode** - Check current state matches config
```bash
./manage-r2-infrastructure.sh verify <API_TOKEN> <ZONE_ID> <ACCOUNT_ID>
```

**Apply Mode** - Apply configuration changes
```bash
./manage-r2-infrastructure.sh apply <API_TOKEN> <ZONE_ID> <ACCOUNT_ID>
```

### What It Manages

#### R2 Buckets (via wrangler CLI)
- ✅ Custom domain attachment
- ✅ r2.dev URL enable/disable
- ✅ Minimum TLS version

#### DNS Records (via Cloudflare API)
- ✅ CNAME records for custom domains
- ✅ Proxied status (orange cloud)
- ✅ TTL and comments

#### Cache Rules (via Cloudflare API)
- ✅ Cache everything for R2 assets
- ✅ Smart Tiered Cache (upper-tier datacenter)
- ✅ Per-environment configuration

### Local Development

⚠️ **This script requires Cloudflare API credentials and should NOT be run locally.**

Infrastructure changes are applied via CI/CD using GitHub secrets:
- `CLOUDFLARE_API_TOKEN` - Full account access
- `CLOUDFLARE_DNS_API_TOKEN` - DNS edit permission
- `CLOUDFLARE_ZONE_ID` - revelations.studio zone
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID

### Manual Trigger

To manually verify or apply infrastructure:

1. Go to **Actions** → **Sync R2 Infrastructure**
2. Click **Run workflow**
3. Select action: `verify` or `apply`
4. Click **Run workflow**

### Deployment Integration

The production deployment workflow (`deploy-production.yml`) automatically:
1. Verifies R2 infrastructure before deploying workers
2. Applies missing configuration if needed
3. Ensures workers use correct R2_PUBLIC_URL_BASE

### Adding New Environments

To add a new environment (e.g., staging):

1. **Update config** - Add bucket entry to `r2-infrastructure.json`:
   ```json
   "codex-media-staging": {
     "publicAccess": {
       "enabled": true,
       "customDomain": "cdn-staging.revelations.studio",
       "minTls": "1.2",
       "disableR2DevUrl": false
     },
     "cache": { "enabled": true, "smartTieredCache": true },
     "dns": { "subdomain": "cdn-staging", "type": "CNAME", "proxied": true }
   }
   ```

2. **Update wrangler bindings** - Add to `wranglerBindings.values`:
   ```json
   "staging": "https://cdn-staging.revelations.studio"
   ```

3. **Commit and push** - CI will automatically apply changes

4. **Update worker configs** - Add binding to wrangler.jsonc files:
   ```jsonc
   "env": {
     "staging": {
       "vars": {
         "R2_PUBLIC_URL_BASE": "https://cdn-staging.revelations.studio"
       }
     }
   }
   ```

### Troubleshooting

**Verification fails but no error** - Check Cloudflare credentials in GitHub secrets

**DNS record already exists** - Script will detect and skip, not an error

**Cache rule not created** - Requires zone-level cache rule permission in API token

**Custom domain fails to attach** - Verify CLOUDFLARE_ZONE_ID matches revelations.studio

### Architecture Notes

**Why custom domains over r2.dev?**
- r2.dev URLs are rate-limited and for development only
- Custom domains enable Cloudflare CDN edge caching
- Smart Tiered Cache provides upper-tier datacenter caching
- Production-ready with automatic SSL certificates

**Why same bucket for public and private?**
- Different paths: `/images/` (public) vs `/media/` (private HLS)
- Public URLs are direct CDN access
- Private URLs are time-limited presigned URLs
- Simpler architecture than separate buckets

**Why CNAME to base domain?**
- R2 custom domains use Cloudflare's routing
- CNAME points to zone apex, R2 intercepts
- Proxied (orange cloud) enables CDN features
- Standard Cloudflare pattern
