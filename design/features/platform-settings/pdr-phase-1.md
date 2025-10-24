# Platform Settings - Phase 1 PRD

## Feature Summary

This feature enables the Platform Owner to customize basic branding and business information for their platform. It provides a simple interface to upload a logo, set a single primary brand color (from which the entire theme is mathematically derived), configure the platform name, and manage essential business contact details.

**Key Concept**: The Platform Owner can establish their brand identity without touching code. The system generates a complete, cohesive design system from a single color choice, making the platform feel uniquely theirs while maintaining visual consistency and accessibility.

## Problem Statement

The Platform Owner needs to:
- Brand the platform with their logo and color to create a professional, cohesive appearance.
- Set the platform name that appears across the customer-facing site and emails.
- Configure business contact information displayed to customers.
- Make these changes instantly without developer assistance or code deployments.
- Have confidence that the color they choose will work well throughout the entire interface.

Without this feature, the platform would look generic and lack brand identity, making it difficult for Platform Owners to build trust and recognition with their customers.

## Goals / Success Criteria

### Primary Goals
1. **Logo Management**: Enable Platform Owners to upload and display their logo across the platform.
2. **Intelligent Color System**: Allow setting a single primary brand color that automatically generates a complete, accessible design system.
3. **Platform Identity**: Configure the platform name used in navigation, page titles, and email communications.
4. **Business Information**: Set contact email, business name, and timezone.
5. **Instant Application**: Changes take effect immediately across all pages without requiring restarts or deployments.
6. **Future-Ready Architecture**: Database and code structure supports future multi-tenant expansion without breaking changes.

### Success Metrics
- Platform Owner can upload a logo and see it reflected across the platform in < 2 minutes.
- Brand color changes are visible immediately on all pages with proper contrast and accessibility.
- Platform name appears consistently in navigation, email footers, and page titles.
- 100% of branding changes persist correctly across user sessions.
- Generated color system meets WCAG AA accessibility standards automatically.
- Settings page loads in < 1 second.

## Scope

### In Scope (Phase 1 MVP)
- **Logo Upload & Display**:
  - Upload logo image (PNG, JPG, SVG) up to 2MB.
  - Logo stored in Cloudflare R2 (`codex-assets-{ownerId}/branding/logo.{ext}`).
  - Logo displayed in navigation header and email footers.
  - Default logo used if none uploaded.
  - Old logo automatically deleted from R2 when replaced.
- **Intelligent Brand Color System**:
  - Single color picker for primary brand color (hex input or visual picker).
  - Mathematical generation of complete color palette:
    - Primary color shades (50, 100, 200, ..., 900)
    - Surface colors (backgrounds, cards, borders)
    - Text colors with automatic contrast checking
    - State colors (hover, active, disabled, focus)
  - Color system uses HSL color space for perceptually uniform variations.
  - Generated theme cached in Cloudflare KV for instant loading.
  - Preview color changes before saving.
- **Platform Name Configuration**:
  - Set platform name (e.g., "Acme Meditation Hub").
  - Name appears in browser title, navigation, and email subject lines.
  - Default to "Codex Platform" if not set.
- **Business Contact Information**:
  - Contact email (displayed in footer, used for customer support links).
  - Business name (used in legal footers, invoices).
  - Timezone setting (for scheduling and timestamps).
- **Single Settings Record per Owner**:
  - Database table structured for future multi-tenant support (includes `ownerId`).
  - Phase 1 uses single owner, but schema is ready for Phase 3 multi-tenant.
  - Settings loaded once per request and cached.

### Explicitly Out of Scope (Future Phases)
- **Multiple Platform Owners (Multi-Tenant)** (Phase 3)
  - Path-based routing (`/[ownerSlug]/...`)
  - Per-tenant theme switching
  - Subdomain/custom domain support
- **Advanced Theming** (Phase 3)
  - Custom fonts upload
  - Multiple brand colors (secondary, accent)
  - CSS custom editor
  - Dark mode toggle
- **Additional Branding Assets** (Phase 2)
  - Favicon upload
  - Open Graph social sharing images
  - Email banner images
- **SEO Settings** (Phase 2)
- **Social Media Links** (Phase 2)
- **Rich Email Template Editor** (Phase 2)
- **Legal Pages Editor** (Terms, Privacy) (Phase 2)

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#8-platform-settings) document for details.

---

## User Stories & Use Cases

### US-SETTINGS-001: Upload Platform Logo
**As a** Platform Owner,
**I want to** upload my business logo,
**so that** my platform has a professional branded appearance.

**Flow:**
1. Platform Owner navigates to `/admin/settings`.
2. Sees current logo (or default placeholder) in Branding section.
3. Clicks "Upload New Logo" button.
4. Selects a logo file from their computer (PNG, JPG, or SVG, max 2MB).
5. Logo preview appears immediately showing how it will look.
6. Clicks "Save Changes" to apply the logo.
7. System uploads logo to R2 (`codex-assets-{ownerId}/branding/logo.{ext}`).
8. If an old logo exists, it's deleted from R2.
9. Logo URL is saved to `platform_settings.logo_url`.
10. Logo appears in navigation header immediately (KV cache updated).
11. Logo appears in all future email footers.

**Acceptance Criteria:**
- Accepts PNG, JPG, and SVG files up to 2MB.
- Validates image dimensions (min 100x100px, max 2000x2000px recommended).
- Logo preview shows before saving with realistic context (in navigation bar).
- Old logo is deleted from R2 when replaced (prevents storage bloat).
- Clear error messages if upload fails (file too large, invalid format, R2 error).
- Logo appears correctly across all pages immediately after save.

### US-SETTINGS-002: Set Primary Brand Color
**As a** Platform Owner,
**I want to** select a single primary brand color and have the entire design system adapt to it,
**so that** my platform matches my brand without worrying about which colors work together.

**Flow:**
1. Platform Owner navigates to `/admin/settings`.
2. Sees current brand color displayed as a color swatch in Branding section.
3. Clicks on color picker.
4. Selects a new color visually or enters a hex code (e.g., `#3B82F6`).
5. As they adjust the color, preview section shows:
   - Buttons in different states (default, hover, active)
   - Text on backgrounds (demonstrating contrast)
   - Cards and borders using derived colors
6. Clicks "Save Changes".
7. System generates complete color palette from the chosen color:
   - 10 shades from lightest (50) to darkest (900)
   - Background colors (surface, muted)
   - Border colors (subtle, default, emphasis)
   - Text colors (primary, secondary, muted) with WCAG AA contrast
8. Generated CSS custom properties are stored in Cloudflare KV (`theme:{ownerId}`).
9. All pages immediately reflect the new brand color system.

**Acceptance Criteria:**
- Color picker allows visual selection or direct hex input.
- Real-time preview shows buttons, text, and backgrounds using generated palette.
- System automatically ensures text has sufficient contrast (WCAG AA minimum).
- If chosen color would create poor contrast, system adjusts text colors automatically.
- Generated palette feels cohesive (uses HSL color space for uniform variations).
- Changes are instant (no page reload needed).
- Default color is used if none is set (e.g., `#3B82F6` - a neutral blue).

### US-SETTINGS-003: Configure Platform Name
**As a** Platform Owner,
**I want to** set my platform name,
**so that** customers see my business name throughout the site and in communications.

**Flow:**
1. Platform Owner navigates to `/admin/settings`.
2. Sees current platform name in "Platform Identity" section.
3. Updates the platform name field (e.g., "Acme Meditation Hub").
4. Clicks "Save Changes".
5. Platform name is saved to `platform_settings.platform_name`.
6. Name appears immediately in:
   - Browser tab title (`<title>`)
   - Navigation header (next to logo)
   - Email subject lines ("Welcome to {platformName}")
   - Email footers ("� 2025 {platformName}")

**Acceptance Criteria:**
- Platform name input accepts up to 100 characters.
- Input validates against special characters that could break HTML/email formatting.
- Name appears consistently in all specified locations.
- Changes take effect immediately without requiring logout/login.
- Defaults to "Codex Platform" if not set.

### US-SETTINGS-004: Set Business Contact Information
**As a** Platform Owner,
**I want to** configure my business contact details,
**so that** customers can reach me and see proper business information.

**Flow:**
1. Platform Owner navigates to `/admin/settings`.
2. Sees "Business Information" section with fields:
   - Contact Email
   - Business Name
   - Timezone
3. Enters or updates information:
   - Contact email: `support@acme.com`
   - Business name: `Acme Wellness LLC`
   - Timezone: `America/New_York`
4. Clicks "Save Changes".
5. Information is saved to `platform_settings` table.
6. Contact email appears in:
   - Site footer ("Contact us: {email}")
   - "Support" links (`mailto:{email}`)
7. Business name appears in:
   - Legal footers ("� 2025 {businessName}")
   - Invoice headers
8. Timezone is used for:
   - Timestamp displays (converts UTC to owner's timezone)
   - Scheduling interfaces (future: offerings)

**Acceptance Criteria:**
- Contact email is validated for proper email format.
- Business name accepts up to 200 characters.
- Timezone dropdown includes all standard IANA timezones.
- Contact email appears in site footer.
- Business name appears in legal footers and invoices.
- Changes persist across sessions.

### US-SETTINGS-005: Preview Changes Before Saving
**As a** Platform Owner,
**I want to** preview how my branding changes will look,
**so that** I can make sure they look good before applying them.

**Flow:**
1. Platform Owner makes changes to logo and/or color.
2. Preview section on settings page shows:
   - Logo in navigation context (actual size and position)
   - Sample buttons with new color
   - Sample cards with new color scheme
   - Text on colored backgrounds (demonstrating contrast)
3. Platform Owner can adjust color until satisfied.
4. Only when "Save Changes" is clicked do changes apply site-wide.

**Acceptance Criteria:**
- Preview updates in real-time as changes are made.
- Preview accurately represents how changes will look on the actual site.
- Changes are not visible to customers until saved.
- Platform Owner can cancel changes (reverts to current saved settings).

---

## Design System Architecture (Technical Overview)

### Color Generation Algorithm

From a single primary color (hex), the system generates:

**1. HSL Conversion**
```
Input: #3B82F6 (hex)
Convert to: HSL(217, 91%, 60%)
```

**2. Shade Generation (50-900 scale)**
```
Primary-50:  HSL(217, 91%, 95%)  // Very light
Primary-100: HSL(217, 91%, 90%)
Primary-200: HSL(217, 91%, 80%)
Primary-300: HSL(217, 91%, 70%)
Primary-400: HSL(217, 91%, 65%)
Primary-500: HSL(217, 91%, 60%)  // Original color
Primary-600: HSL(217, 91%, 50%)
Primary-700: HSL(217, 91%, 40%)
Primary-800: HSL(217, 91%, 30%)
Primary-900: HSL(217, 91%, 15%)  // Very dark
```

**3. Functional Color Assignments**
```css
/* Buttons */
--button-bg: var(--primary-600);
--button-bg-hover: var(--primary-700);
--button-bg-active: var(--primary-800);
--button-text: white; /* or black, based on contrast check */

/* Backgrounds */
--surface: white;
--surface-muted: var(--primary-50);
--surface-hover: var(--primary-100);

/* Text */
--text-primary: hsl(0, 0%, 10%); /* near black */
--text-secondary: hsl(0, 0%, 40%);
--text-on-primary: white; /* or black, contrast checked */

/* Borders */
--border-subtle: var(--primary-200);
--border-default: var(--primary-300);
--border-emphasis: var(--primary-600);
```

**4. Contrast Checking (WCAG AA)**
```typescript
// Ensure text on colored backgrounds meets 4.5:1 contrast ratio
function getContrastingText(backgroundColor: HSL): string {
  const whiteContrast = calculateContrast(backgroundColor, WHITE);
  const blackContrast = calculateContrast(backgroundColor, BLACK);
  return whiteContrast > 4.5 ? 'white' : 'black';
}
```

This approach ensures:
-  Cohesive color palette (all derived from one source)
-  Accessible contrast ratios
-  Predictable hover/active states
-  Professional appearance without color theory knowledge

---

## Database Schema Extension Strategy

### Phase 1 Schema (Single Owner)
```sql
CREATE TABLE platform_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) UNIQUE, -- Ready for multi-tenant

  -- Branding
  logo_url TEXT,                -- https://r2.example.com/codex-assets-{ownerId}/branding/logo.png
  primary_color_hex VARCHAR(7) NOT NULL DEFAULT '#3B82F6',

  -- Identity
  platform_name VARCHAR(100) NOT NULL DEFAULT 'Codex Platform',

  -- Business Info
  contact_email VARCHAR(255),
  business_name VARCHAR(200),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for future multi-tenant queries
CREATE INDEX idx_platform_settings_owner_id ON platform_settings(owner_id);
```

### Phase 3 Extension (Multi-Tenant)
No schema changes needed! To support multiple tenants:

1. **Routing**: Add `owner_slug` column to `users` table
2. **Middleware**: Extract slug from path (`/[ownerSlug]/...`)
3. **Query**: `SELECT * FROM platform_settings WHERE owner_id = (SELECT id FROM users WHERE owner_slug = $1)`
4. **Theme Loading**: KV key becomes `theme:{ownerSlug}` instead of single theme

**Why this works:**
- `owner_id` column already exists
- `UNIQUE` constraint ensures one settings record per owner
- Index already exists for efficient queries
- No breaking changes to existing code

---

## Related Documents

- **TDD**: [Platform Settings Technical Design](./ttd-dphase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth PRD](../auth/pdr-phase-1.md)
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md)
  - [Content Management PRD](../content-management/pdr-phase-1.md) (R2Service)
  - [Notifications PRD](../notifications/pdr-phase-1.md)
- **Infrastructure**:
  - [Infrastructure Plan](../../infrastructure/infraplan.md)
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-23
**Status**: Draft - Awaiting Review
