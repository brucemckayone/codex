# Platform Settings - Phase 1 TDD (Technical Design Document)

## System Overview

The Platform Settings system provides the Platform Owner with the ability to customize branding (logo, color scheme) and configure business information (platform name, contact details, timezone). It implements an intelligent theming system that generates a complete, accessible design system from a single primary color choice, with results cached in Cloudflare KV for instant global availability.

**Key Architecture Decisions**:

- **Intelligent Color Generation**: From one primary color, mathematically derive a full palette using HSL color space transformations.
- **Cloudflare KV for Theme Caching**: Store generated CSS custom properties in KV for edge-cached, instant loading.
- **R2 for Logo Storage**: Phase 1 uses shared bucket `codex-assets-production` with organization-scoped paths (`{organizationId}/branding/logo.{ext}`).
- **Organization-Scoped Schema**: Database uses `organization_id` as primary key for organization-level isolation.
- **Server-Side Rendering**: Settings loaded in SvelteKit layout and injected as CSS variables in document `<head>`.

> **Phase 1 Note**: This implementation uses a shared R2 bucket with organization-scoped paths for simplicity. Each organization's assets are isolated by path prefix (`{organizationId}/`). Future phases may migrate to separate buckets per organization if needed.

**Architecture Diagram**: See [Platform Settings Architecture](../_assets/platform-settings-architecture.png) (Placeholder for future diagram)

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#8-platform-settings) document for details on dependencies between features.

### Technical Prerequisites

1.  **Auth System**: The `requireAuth()` and `requirePlatformOwner()` guards are needed to protect the settings page. Auth context provides `organizationId` for scoping operations.
2.  **Content Management System**: The `R2Service` is required for logo uploads to organization-scoped paths.
3.  **Admin Dashboard System**: The settings page is part of the admin dashboard.

---

## Component List

### 1. Platform Settings Service (`packages/web/src/lib/server/platform-settings/service.ts`)

**Responsibility**: Centralized business logic for reading and updating platform settings, generating themes, and managing logo uploads.

**Interface**:

```typescript
export interface IPlatformSettingsService {
  /**
   * Retrieves the platform settings for a specific organization.
   * @param organizationId The ID of the organization.
   * @returns The platform settings or null if not found.
   */
  getSettings(organizationId: string): Promise<PlatformSettings | null>;

  /**
   * Updates platform settings for a specific organization.
   * @param organizationId The ID of the organization.
   * @param updates Partial settings to update.
   * @returns The updated platform settings.
   */
  updateSettings(
    organizationId: string,
    updates: PlatformSettingsUpdate
  ): Promise<PlatformSettings>;

  /**
   * Generates a complete theme from a primary color.
   * @param primaryColorHex The primary color in hex format (e.g., "#3B82F6").
   * @returns An object containing CSS custom properties for the theme.
   */
  generateTheme(primaryColorHex: string): ThemeColors;

  /**
   * Uploads a logo to R2 and returns the public URL.
   * @param organizationId The ID of the organization.
   * @param file The logo file (File object or buffer).
   * @param filename The original filename.
   * @returns The public URL of the uploaded logo.
   */
  uploadLogo(
    organizationId: string,
    file: ArrayBuffer | Uint8Array,
    filename: string
  ): Promise<string>;

  /**
   * Deletes the current logo from R2.
   * @param logoUrl The URL of the logo to delete.
   */
  deleteLogo(logoUrl: string): Promise<void>;

  /**
   * Caches the generated theme in Cloudflare KV.
   * @param organizationId The ID of the organization.
   * @param theme The theme colors object.
   */
  cacheTheme(organizationId: string, theme: ThemeColors): Promise<void>;

  /**
   * Retrieves a cached theme from Cloudflare KV.
   * @param organizationId The ID of the organization.
   * @returns The cached theme or null if not found.
   */
  getCachedTheme(organizationId: string): Promise<ThemeColors | null>;
}

export interface PlatformSettings {
  id: string;
  organizationId: string;
  logoUrl: string | null;
  primaryColorHex: string;
  platformName: string;
  contactEmail: string | null;
  businessName: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformSettingsUpdate {
  logoUrl?: string | null;
  primaryColorHex?: string;
  platformName?: string;
  contactEmail?: string | null;
  businessName?: string | null;
  timezone?: string;
}

export interface ThemeColors {
  cssVariables: string; // CSS custom properties as a string
  palette: {
    primary: ColorScale;
    surface: SurfaceColors;
    text: TextColors;
    border: BorderColors;
  };
}

export interface ColorScale {
  50: string; // HSL string
  100: string;
  200: string;
  300: string;
  400: string;
  500: string; // Original color
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface SurfaceColors {
  base: string; // white or near-white
  muted: string; // primary-50
  hover: string; // primary-100
}

export interface TextColors {
  primary: string; // near-black
  secondary: string; // gray
  muted: string; // light gray
  onPrimary: string; // white or black (contrast-checked)
}

export interface BorderColors {
  subtle: string; // primary-200
  default: string; // primary-300
  emphasis: string; // primary-600
}
```

**Implementation Notes**:

- `getSettings`: Query `platform_settings` table by `organization_id`.
- `updateSettings`: Update record in `platform_settings` table. If updating `primaryColorHex`, regenerate theme and cache in KV.
- `generateTheme`: Implements color generation algorithm (detailed below).
- `uploadLogo`: Uses `R2Service` to upload to shared bucket `codex-assets-production` with organization-scoped path `{organizationId}/branding/logo.{ext}`. Deletes old logo if it exists.
- `cacheTheme`: Stores theme in Cloudflare KV with key `theme:{organizationId}`.
- `getCachedTheme`: Retrieves theme from KV.

---

### 2. Theme Generation Service (`packages/web/src/lib/server/platform-settings/theme-generator.ts`)

**Responsibility**: Contains the pure logic for generating a complete color system from a single hex color.

**Implementation**:

```typescript
import { hexToHSL, hslToHex, hslToString } from './color-utils';
import { calculateContrast } from './contrast-utils';

export function generateTheme(primaryColorHex: string): ThemeColors {
  // 1. Convert hex to HSL
  const primaryHSL = hexToHSL(primaryColorHex);

  // 2. Generate color scale (50-900)
  const primaryScale = generateColorScale(primaryHSL);

  // 3. Generate functional colors
  const surface = generateSurfaceColors(primaryScale);
  const text = generateTextColors(primaryScale);
  const border = generateBorderColors(primaryScale);

  // 4. Build CSS variables string
  const cssVariables = buildCSSVariables({
    primary: primaryScale,
    surface,
    text,
    border,
  });

  return {
    cssVariables,
    palette: {
      primary: primaryScale,
      surface,
      text,
      border,
    },
  };
}

/**
 * Generates a 10-step color scale from a base HSL color.
 * Uses lightness adjustments to create perceptually uniform steps.
 */
function generateColorScale(baseHSL: HSL): ColorScale {
  const { h, s, l } = baseHSL;

  return {
    50: hslToString({ h, s, l: 95 }),
    100: hslToString({ h, s, l: 90 }),
    200: hslToString({ h, s, l: 80 }),
    300: hslToString({ h, s, l: 70 }),
    400: hslToString({ h, s, l: 65 }),
    500: hslToString({ h, s, l }), // Original color
    600: hslToString({ h, s, l: Math.max(l - 10, 20) }),
    700: hslToString({ h, s, l: Math.max(l - 20, 15) }),
    800: hslToString({ h, s, l: Math.max(l - 30, 10) }),
    900: hslToString({ h, s, l: Math.max(l - 40, 5) }),
  };
}

/**
 * Generates surface colors (backgrounds) from the primary scale.
 */
function generateSurfaceColors(primaryScale: ColorScale): SurfaceColors {
  return {
    base: 'hsl(0, 0%, 100%)', // white
    muted: primaryScale[50], // very light primary
    hover: primaryScale[100], // light primary
  };
}

/**
 * Generates text colors with automatic contrast checking.
 */
function generateTextColors(primaryScale: ColorScale): TextColors {
  // Determine if white or black text works better on primary-600 (button bg)
  const primary600HSL = parseHSL(primaryScale[600]);
  const onPrimary = getContrastingTextColor(primary600HSL);

  return {
    primary: 'hsl(0, 0%, 10%)', // near-black
    secondary: 'hsl(0, 0%, 40%)', // gray
    muted: 'hsl(0, 0%, 60%)', // light gray
    onPrimary, // white or black
  };
}

/**
 * Generates border colors from the primary scale.
 */
function generateBorderColors(primaryScale: ColorScale): BorderColors {
  return {
    subtle: primaryScale[200],
    default: primaryScale[300],
    emphasis: primaryScale[600],
  };
}

/**
 * Builds a CSS custom properties string from the theme palette.
 */
function buildCSSVariables(palette: ThemeColors['palette']): string {
  return `
    /* Primary Scale */
    --primary-50: ${palette.primary[50]};
    --primary-100: ${palette.primary[100]};
    --primary-200: ${palette.primary[200]};
    --primary-300: ${palette.primary[300]};
    --primary-400: ${palette.primary[400]};
    --primary-500: ${palette.primary[500]};
    --primary-600: ${palette.primary[600]};
    --primary-700: ${palette.primary[700]};
    --primary-800: ${palette.primary[800]};
    --primary-900: ${palette.primary[900]};

    /* Surface Colors */
    --surface-base: ${palette.surface.base};
    --surface-muted: ${palette.surface.muted};
    --surface-hover: ${palette.surface.hover};

    /* Text Colors */
    --text-primary: ${palette.text.primary};
    --text-secondary: ${palette.text.secondary};
    --text-muted: ${palette.text.muted};
    --text-on-primary: ${palette.text.onPrimary};

    /* Border Colors */
    --border-subtle: ${palette.border.subtle};
    --border-default: ${palette.border.default};
    --border-emphasis: ${palette.border.emphasis};

    /* Functional Colors (derived) */
    --button-bg: var(--primary-600);
    --button-bg-hover: var(--primary-700);
    --button-bg-active: var(--primary-800);
    --button-text: var(--text-on-primary);

    --link-color: var(--primary-600);
    --link-color-hover: var(--primary-700);

    --input-border: var(--border-default);
    --input-border-focus: var(--border-emphasis);
  `.trim();
}

/**
 * Determines whether white or black text provides better contrast on a given background.
 * Ensures WCAG AA compliance (4.5:1 contrast ratio).
 */
function getContrastingTextColor(backgroundColor: HSL): string {
  const whiteContrast = calculateContrast(backgroundColor, {
    h: 0,
    s: 0,
    l: 100,
  });
  const blackContrast = calculateContrast(backgroundColor, {
    h: 0,
    s: 0,
    l: 0,
  });

  return whiteContrast >= 4.5 ? 'hsl(0, 0%, 100%)' : 'hsl(0, 0%, 0%)';
}
```

---

### 3. Color Utility Functions (`packages/web/src/lib/server/platform-settings/color-utils.ts`)

**Responsibility**: Pure utility functions for color conversion and manipulation.

**Implementation**:

```typescript
export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

/**
 * Converts a hex color to HSL.
 */
export function hexToHSL(hex: string): HSL {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // Find max and min values
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / delta + 2) / 6;
        break;
      case b:
        h = ((r - g) / delta + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Converts HSL to CSS string format.
 */
export function hslToString(hsl: HSL): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

/**
 * Parses an HSL string to HSL object.
 */
export function parseHSL(hslString: string): HSL {
  const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) throw new Error('Invalid HSL string');

  return {
    h: parseInt(match[1]),
    s: parseInt(match[2]),
    l: parseInt(match[3]),
  };
}
```

---

### 4. Contrast Utility Functions (`packages/web/src/lib/server/platform-settings/contrast-utils.ts`)

**Responsibility**: Calculate color contrast ratios for WCAG compliance.

**Implementation**:

```typescript
import { HSL } from './color-utils';

/**
 * Calculates the relative luminance of an HSL color.
 * Used for WCAG contrast ratio calculation.
 */
function getRelativeLuminance(hsl: HSL): number {
  // Convert HSL to RGB
  const { r, g, b } = hslToRGB(hsl);

  // Apply gamma correction
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  const r_linear =
    rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const g_linear =
    gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const b_linear =
    bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * r_linear + 0.7152 * g_linear + 0.0722 * b_linear;
}

/**
 * Calculates the contrast ratio between two colors.
 * Returns a value between 1 and 21.
 * WCAG AA requires minimum 4.5:1 for normal text.
 */
export function calculateContrast(color1: HSL, color2: HSL): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Helper: Convert HSL to RGB
 */
function hslToRGB(hsl: HSL): { r: number; g: number; b: number } {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}
```

---

### 5. Settings Page (`src/routes/admin/settings/+page.svelte` and `+page.server.ts`)

**Responsibility**: Admin interface for updating platform settings.

**`+page.server.ts` (Load Function & Form Actions)**:

```typescript
import type { PageServerLoad, Actions } from './$types';
import { requireAuth, requirePlatformOwner } from '$lib/server/auth/guards';
import { platformSettingsService } from '$lib/server/platform-settings/service';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
  // Require authenticated user with Platform Owner role
  const user = requireAuth(event);
  requirePlatformOwner(user);

  // Get organizationId from auth context
  const { organizationId } = user;

  // Load current settings
  const settings = await platformSettingsService.getSettings(organizationId);

  // If no settings exist, create defaults
  if (!settings) {
    const defaultSettings = await platformSettingsService.updateSettings(
      organizationId,
      {
        platformName: 'Codex Platform',
        primaryColorHex: '#3B82F6',
        timezone: 'UTC',
      }
    );
    return { settings: defaultSettings };
  }

  return { settings };
};

export const actions: Actions = {
  updateSettings: async (event) => {
    const user = requireAuth(event);
    requirePlatformOwner(user);
    const { organizationId } = user;
    const formData = await event.request.formData();

    const updates: PlatformSettingsUpdate = {
      platformName: formData.get('platformName') as string,
      primaryColorHex: formData.get('primaryColorHex') as string,
      contactEmail: formData.get('contactEmail') as string | null,
      businessName: formData.get('businessName') as string | null,
      timezone: formData.get('timezone') as string,
    };

    // Validate color format
    if (
      updates.primaryColorHex &&
      !/^#[0-9A-Fa-f]{6}$/.test(updates.primaryColorHex)
    ) {
      return fail(400, { error: 'Invalid color format' });
    }

    // Update settings
    await platformSettingsService.updateSettings(organizationId, updates);

    return { success: true };
  },

  uploadLogo: async (event) => {
    const user = requireAuth(event);
    requirePlatformOwner(user);
    const { organizationId } = user;
    const formData = await event.request.formData();
    const logoFile = formData.get('logo') as File;

    if (!logoFile || logoFile.size === 0) {
      return fail(400, { error: 'No file uploaded' });
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!allowedTypes.includes(logoFile.type)) {
      return fail(400, {
        error: 'Invalid file type. Only PNG, JPG, and SVG allowed.',
      });
    }

    // Validate file size (2MB max)
    if (logoFile.size > 2 * 1024 * 1024) {
      return fail(400, { error: 'File too large. Maximum size is 2MB.' });
    }

    // Get current settings to check for old logo
    const currentSettings = await platformSettingsService.getSettings(organizationId);

    // Upload new logo
    const arrayBuffer = await logoFile.arrayBuffer();
    const logoUrl = await platformSettingsService.uploadLogo(
      organizationId,
      arrayBuffer,
      logoFile.name
    );

    // Delete old logo if it exists
    if (currentSettings?.logoUrl) {
      await platformSettingsService.deleteLogo(currentSettings.logoUrl);
    }

    // Update settings with new logo URL
    await platformSettingsService.updateSettings(organizationId, { logoUrl });

    return { success: true, logoUrl };
  },
};
```

**`+page.svelte` (Frontend Component)**:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import ColorPicker from '$lib/components/ColorPicker.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let { settings } = data;
  let previewColor = settings.primaryColorHex;
  let logoPreview: string | null = settings.logoUrl;

  function handleColorChange(newColor: string) {
    previewColor = newColor;
  }
</script>

<div class="settings-page">
  <h1>Platform Settings</h1>

  <!-- Branding Section -->
  <section class="settings-section">
    <h2>Branding</h2>

    <form
      method="POST"
      action="?/uploadLogo"
      enctype="multipart/form-data"
      use:enhance
    >
      <div class="form-group">
        <label for="logo">Platform Logo</label>
        {#if logoPreview}
          <img src={logoPreview} alt="Current logo" class="logo-preview" />
        {/if}
        <input
          type="file"
          id="logo"
          name="logo"
          accept=".png,.jpg,.jpeg,.svg"
        />
        <button type="submit">Upload Logo</button>
      </div>
    </form>

    <form method="POST" action="?/updateSettings" use:enhance>
      <div class="form-group">
        <label for="primaryColor">Primary Brand Color</label>
        <ColorPicker
          value={settings.primaryColorHex}
          on:change={(e) => handleColorChange(e.detail)}
        />
        <input type="hidden" name="primaryColorHex" value={previewColor} />

        <!-- Color Preview -->
        <div class="color-preview" style="--preview-color: {previewColor}">
          <button class="preview-button">Button</button>
          <button class="preview-button" disabled>Hover</button>
          <div class="preview-card">Sample Card</div>
        </div>
      </div>

      <!-- Platform Identity Section -->
      <h2>Platform Identity</h2>
      <div class="form-group">
        <label for="platformName">Platform Name</label>
        <input
          type="text"
          id="platformName"
          name="platformName"
          value={settings.platformName}
          maxlength="100"
          required
        />
      </div>

      <!-- Business Information Section -->
      <h2>Business Information</h2>
      <div class="form-group">
        <label for="contactEmail">Contact Email</label>
        <input
          type="email"
          id="contactEmail"
          name="contactEmail"
          value={settings.contactEmail || ''}
        />
      </div>

      <div class="form-group">
        <label for="businessName">Business Name</label>
        <input
          type="text"
          id="businessName"
          name="businessName"
          value={settings.businessName || ''}
          maxlength="200"
        />
      </div>

      <div class="form-group">
        <label for="timezone">Timezone</label>
        <select id="timezone" name="timezone" value={settings.timezone}>
          <option value="UTC">UTC</option>
          <option value="America/New_York">Eastern Time</option>
          <option value="America/Chicago">Central Time</option>
          <option value="America/Denver">Mountain Time</option>
          <option value="America/Los_Angeles">Pacific Time</option>
          <!-- Add more timezones as needed -->
        </select>
      </div>

      <button type="submit" class="save-button">Save Changes</button>
    </form>
  </section>
</div>

<style>
  .color-preview {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--border-default);
    border-radius: 8px;
  }

  .preview-button {
    background: var(--preview-color);
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    margin-right: 0.5rem;
  }

  .preview-button:hover {
    opacity: 0.9;
  }

  .logo-preview {
    max-width: 200px;
    max-height: 100px;
    margin-bottom: 1rem;
  }
</style>
```

---

### 6. Root Layout Theme Injection (`src/routes/+layout.server.ts`)

**Responsibility**: Load platform settings and theme on every request, inject CSS variables into HTML.

**Implementation**:

```typescript
import type { LayoutServerLoad } from './$types';
import { platformSettingsService } from '$lib/server/platform-settings/service';

export const load: LayoutServerLoad = async (event) => {
  // For Phase 1, use the single organization's ID
  // In future phases, this will be extracted from auth context or request path
  const organizationId = 'single-organization-id'; // Hardcoded for MVP, will be dynamic in later phases

  // Try to get cached theme from KV first
  let theme = await platformSettingsService.getCachedTheme(organizationId);

  if (!theme) {
    // Cache miss: load from database and generate theme
    const settings = await platformSettingsService.getSettings(organizationId);

    if (settings) {
      theme = platformSettingsService.generateTheme(settings.primaryColorHex);
      await platformSettingsService.cacheTheme(organizationId, theme);
    }
  }

  // Load basic settings for use in components (logo, platform name, etc.)
  const settings = await platformSettingsService.getSettings(organizationId);

  return {
    theme: theme?.cssVariables || '',
    platformSettings: settings,
  };
};
```

**`src/routes/+layout.svelte`**:

```svelte
<script lang="ts">
  import type { LayoutData } from './$types';

  export let data: LayoutData;
</script>

<svelte:head>
  {#if data.theme}
    <style>
      :root {
        {data.theme}
      }
    </style>
  {/if}
  <title>{data.platformSettings?.platformName || 'Codex Platform'}</title>
</svelte:head>

<div class="app">
  <slot />
</div>
```

---

## Data Models / Schema

### 1. `platform_settings` Table

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const platformSettings = pgTable(
  'platform_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull()
      .unique(),

    // Branding
    // Logo stored in shared R2 bucket at: {organizationId}/branding/logo.{ext}
    logoUrl: text('logo_url'),
    primaryColorHex: varchar('primary_color_hex', { length: 7 })
      .notNull()
      .default('#3B82F6'),

    // Identity
    platformName: varchar('platform_name', { length: 100 })
      .notNull()
      .default('Codex Platform'),

    // Business Info
    contactEmail: varchar('contact_email', { length: 255 }),
    businessName: varchar('business_name', { length: 200 }),
    timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Index for efficient organization lookups
    organizationIdIdx: index('idx_platform_settings_organization_id').on(table.organizationId),
  })
);
```

---

## Cloudflare KV Integration

### KV Namespace Setup

**`wrangler.jsonc`**:

```toml
[[kv_namespaces]]
binding = "THEMES_KV"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

### KV Operations

**Storing Theme**:

```typescript
// In PlatformSettingsService
async cacheTheme(organizationId: string, theme: ThemeColors): Promise<void> {
  const kvKey = `theme:${organizationId}`;
  await platform.env.THEMES_KV.put(kvKey, JSON.stringify(theme), {
    expirationTtl: 86400 // 24 hours (theme rarely changes)
  });
}
```

**Retrieving Theme**:

```typescript
async getCachedTheme(organizationId: string): Promise<ThemeColors | null> {
  const kvKey = `theme:${organizationId}`;
  const cached = await platform.env.THEMES_KV.get(kvKey);

  if (!cached) return null;

  return JSON.parse(cached) as ThemeColors;
}
```

**Invalidating Cache on Update**:

```typescript
async updateSettings(organizationId: string, updates: PlatformSettingsUpdate): Promise<PlatformSettings> {
  // Update database
  const updated = await db.update(platformSettings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(platformSettings.organizationId, organizationId))
    .returning();

  // If color changed, regenerate and cache theme
  if (updates.primaryColorHex) {
    const theme = this.generateTheme(updates.primaryColorHex);
    await this.cacheTheme(organizationId, theme);
  }

  return updated[0];
}
```

---

## R2 Logo Upload Flow

### Upload Implementation

```typescript
// In PlatformSettingsService
async uploadLogo(
  organizationId: string,
  file: ArrayBuffer | Uint8Array,
  filename: string
): Promise<string> {
  const bucketName = 'codex-assets-production'; // Shared bucket for Phase 1
  const fileExt = filename.split('.').pop();
  const key = `${organizationId}/branding/logo.${fileExt}`; // Organization-scoped path

  // Upload to R2 using R2Service
  await r2Service.uploadFile(bucketName, key, file, {
    contentType: getContentType(fileExt)
  });

  // Return public URL
  return `https://r2.example.com/${bucketName}/${key}`;
}

async deleteLogo(logoUrl: string): Promise<void> {
  // Extract bucket and key from URL
  const url = new URL(logoUrl);
  const [bucketName, ...keyParts] = url.pathname.slice(1).split('/');
  const key = keyParts.join('/');

  // Delete from R2
  await r2Service.deleteFile(bucketName, key);
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml'
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}
```

---

## Testing Strategy

### Unit Tests

- **Color Generation**: Test `generateTheme` with various input colors, verify palette correctness.
- **Contrast Checking**: Test `calculateContrast` and `getContrastingTextColor` for WCAG compliance.
- **Color Conversion**: Test `hexToHSL`, `hslToString`, `parseHSL` utilities.

### Integration Tests

- **Settings CRUD**: Test `getSettings` and `updateSettings` with database.
- **Logo Upload**: Test `uploadLogo` and `deleteLogo` with R2 mock.
- **Theme Caching**: Test KV cache hit/miss scenarios.

### E2E Tests

- **Settings Update Flow**: Platform Owner logs in → navigates to settings → changes color → saves → verifies color appears site-wide.
- **Logo Upload Flow**: Upload logo → verify appears in navigation → upload new logo → verify old logo deleted from R2.

---

## Performance Considerations

### Cloudflare KV Edge Caching

- **Theme CSS** cached globally at Cloudflare edge locations.
- **Cache hit**: Theme loads in <5ms (from edge).
- **Cache miss**: Theme generated and cached, subsequent requests are fast.

### CSS Custom Properties

- **No CSS file compilation** needed.
- Variables injected in `<style>` tag in HTML `<head>`.
- Browser-native, instant updates.

### R2 Logo Delivery

- Logos served via Cloudflare CDN (R2 custom domain).
- Cached at edge, fast global delivery.

---

## Future Extensions (Multi-Organization Support)

### Phase 1 Foundation:

Phase 1 already implements organization-scoped architecture:
- Database uses `organization_id` for isolation
- R2 uses organization-scoped paths in shared bucket
- KV keys include `organizationId`
- All service methods accept `organizationId` parameter

### What Changes in Future Phases:

1. **Dynamic Organization Resolution**: Extract `organizationId` from request context (domain, path, or subdomain) instead of hardcoded value.
2. **Multi-Organization Support**: Support multiple organizations with proper isolation and routing.
3. **Per-Organization Themes**: Load different themes based on current organization context.
4. **Organization Slug Support**: Optionally use organization slugs for routing (`/[orgSlug]/...`).

### What Stays the Same:

- Database schema (already organization-scoped).
- Theme generation logic.
- Logo upload logic (already uses organization-scoped paths).
- KV caching strategy (already uses `theme:{organizationId}` keys).
- Service interfaces (already accept `organizationId`).

**Migration Path**: The organization-scoped architecture is already in place. Future phases only need to add dynamic organization resolution and multi-organization routing.

---

## Related Documents

- **PRD**: [Platform Settings PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth TDD](../auth/ttd-dphase-1.md)
  - [Admin Dashboard TDD](../admin-dashboard/ttd-dphase-1.md)
  - [Content Management TDD](../content-management/ttd-dphase-1.md)
  - [Notifications TDD](../notifications/ttd-dphase-1.md)
- **Infrastructure**:
  - [Infrastructure Plan](../../infrastructure/infraplan.md)
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-23
**Status**: Draft - Awaiting Review
