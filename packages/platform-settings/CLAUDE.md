# @codex/platform-settings

Org settings (Branding, Contact, Features). Facade pattern.

## API
### `PlatformSettingsFacade`
Unified access.
- **getAllSettings()**: Parallel fetch.
- **get/updateBranding()**: Logo, Color.
- **get/updateContact()**: Email, Name, Timezone.
- **get/updateFeatures()**: Toggles.
- **uploadLogo(file)**: R2 upload.

## Services
- **Branding**: R2 logo storage (`logos/{orgId}/logo.{ext}`). Cache 1yr.
- **Contact**: Platform details.
- **Feature**: Signups/Purchases toggles.

## Storage
- **Tables**: `platformSettings`, `branding_settings`, `contact_settings`, `feature_settings`.
- **Pattern**: Upsert (Insert on Conflict).

## Usage
```ts
const facade = new PlatformSettingsFacade(config);
await facade.updateBranding({ primaryColorHex: '#000' });
```