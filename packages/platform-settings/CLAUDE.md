# @codex/platform-settings

Organization settings management via Facade pattern. Manages branding, contact info, and feature toggles.

## API

### `PlatformSettingsFacade`
Unified access to all settings through a single facade:

| Method | Purpose | Notes |
|---|---|---|
| `getAllSettings(orgId)` | Parallel fetch of all settings | Returns branding + contact + features |
| `getBranding(orgId)` / `updateBranding(orgId, input)` | Logo URL, primary color, density | |
| `getContact(orgId)` / `updateContact(orgId, input)` | Email, name, timezone | |
| `getFeatures(orgId)` / `updateFeatures(orgId, input)` | Feature toggles (signups, purchases) | |
| `uploadLogo(orgId, file)` | Upload org logo to R2 | Returns URL |

## Sub-Services

| Service | Scope | Storage |
|---|---|---|
| **BrandingService** | Logo, primary color, density scale | `branding_settings` table + R2 for logos |
| **ContactService** | Platform name, email, timezone | `contact_settings` table |
| **FeatureService** | Signup enabled, purchases enabled | `feature_settings` table |

## Storage Patterns

- **Tables**: `platformSettings`, `branding_settings`, `contact_settings`, `feature_settings`
- **Pattern**: Upsert (INSERT ON CONFLICT UPDATE) — settings are always 1:1 per org
- **Logo storage**: R2 key `logos/{orgId}/logo.{ext}`, cache 1 year (immutable)

## How Settings Are Used

1. **Organization-api** reads/writes settings via this facade
2. **Identity-api** reads branding for injection into org layouts
3. **Web app** applies branding as CSS custom properties in org layout:
   ```css
   --org-brand-primary: var(--brand-primary-color);
   --org-brand-density: var(--brand-density-scale);
   ```
4. **Notifications** injects `logoUrl` and `primaryColor` into email templates

## Strict Rules

- **MUST** scope all settings operations by `organizationId` — settings are always org-scoped
- **MUST** use upsert pattern for all updates — creates if not exists, updates if exists
- **MUST** validate all setting values with Zod schemas before persisting
- **NEVER** hardcode branding values — always read from settings

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2 for logos)
- **Used by**: identity-api worker, organization-api worker, `@codex/notifications` (branding injection)

## Reference Files

- `packages/platform-settings/src/` — facade and sub-services
