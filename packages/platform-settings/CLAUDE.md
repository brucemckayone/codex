# @codex/platform-settings

Organization settings facade — branding (logo, colors, density), contact info, and feature toggles. All settings are org-scoped. Upsert pattern: creates on first write, updates on subsequent writes.

## Key Exports

- **`PlatformSettingsFacade`** — Primary facade (use this)
- **`BrandingSettingsService`** — Direct branding access (advanced use)
- **`ContactSettingsService`** — Direct contact access (advanced use)
- **`FeatureSettingsService`** — Direct features access (advanced use)
- **`FileTooLargeError`**, **`InvalidFileTypeError`**, **`SettingsUpsertError`** — Error classes

## PlatformSettingsFacade

**Constructor**:
```ts
new PlatformSettingsFacade({
  db: dbHttp | dbWs,
  environment: string,
  organizationId: string,    // required — all settings are org-scoped
  r2?: R2Service,            // optional — required for logo uploads
  r2PublicUrlBase?: string,  // optional — required for logo URL construction
})
```

In `procedure()` handlers, access via `ctx.services.settings` — `organizationId` is injected from org context automatically.

| Method | Purpose | Notes |
|---|---|---|
| `getAllSettings()` | Parallel fetch of all three categories | Returns `AllSettingsResponse` |
| `getBranding()` | Logo URL, primary color hex, density scale | Returns `BrandingSettingsResponse` |
| `updateBranding(input: UpdateBrandingInput)` | Update branding fields | Upserts |
| `getContact()` | Platform name, support email, timezone | Returns `ContactSettingsResponse` |
| `updateContact(input: UpdateContactInput)` | Update contact fields | Upserts |
| `getFeatures()` | `signupsEnabled`, `purchasesEnabled` | Returns `FeatureSettingsResponse` |
| `updateFeatures(input: UpdateFeaturesInput)` | Toggle features | Upserts |
| `uploadLogo(orgId, file)` | Validate + upload logo to R2 | Returns updated branding URL |

## Sub-Service Responsibilities

| Service | Storage | Scope |
|---|---|---|
| `BrandingSettingsService` | `branding_settings` table + R2 for logos | Per org |
| `ContactSettingsService` | `contact_settings` table | Per org |
| `FeatureSettingsService` | `feature_settings` table | Per org |

Logo R2 key: `logos/{orgId}/logo.{ext}` — 1-year immutable cache for raster, 1-hour for SVG.

## How Settings Flow Through the Platform

1. **Organization-api** reads/writes settings via `ctx.services.settings` (the facade)
2. **Identity-api** reads branding for injection into org layout server loads
3. **Web app** injects branding as CSS custom properties on the org layout:
   ```css
   --brand-primary-color: #hex;
   --brand-density-scale: 1.0;
   ```
4. **Notifications** injects `logoUrl` and `primaryColor` into email templates via `brandTokenResolver` in the service registry

## Strict Rules

- **MUST** scope all settings by `organizationId` — always passed in constructor
- **MUST** use upsert pattern — settings are 1:1 per org, never insert duplicates
- **MUST** validate setting values with Zod before persisting (input types from `@codex/validation`)
- **MUST** provide `r2` and `r2PublicUrlBase` for logo upload operations — facade will throw if missing
- **NEVER** hardcode branding values — always read from settings

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2), `@codex/service-errors`, `@codex/shared-types`, `@codex/validation`
- **Used by**: identity-api worker, organization-api worker, `@codex/notifications` (brand token resolver), service-registry in `@codex/worker-utils`

## Reference Files

- `packages/platform-settings/src/services/platform-settings-service.ts` — PlatformSettingsFacade
- `packages/platform-settings/src/services/branding-settings-service.ts`
- `packages/platform-settings/src/services/contact-settings-service.ts`
- `packages/platform-settings/src/services/feature-settings-service.ts`
