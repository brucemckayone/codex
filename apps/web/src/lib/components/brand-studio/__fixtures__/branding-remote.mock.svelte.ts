/**
 * Test double for `$lib/remote/branding.remote`, as the studio brand page
 * reads it (Codex-zskbp).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. The
 * branding read is a double of kit's query (`kitQuery`, in
 * `studio/__fixtures__/kit-query.mock.svelte`), so a Retry takes kit's real
 * path: the page is handed a new query, still loading. A test settles it with
 * `brandingRemote().land(…)` or `.fail(…)`. A read nobody has settled is still
 * loading.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import type { BrandingSettingsResponse } from '@codex/shared-types';
import { vi } from 'vitest';
import {
  type KitQuery,
  kitQuery,
} from '$lib/components/studio/__fixtures__/kit-query.mock.svelte';

/** A saved brand: a primary colour and the defaults for everything else. */
export const BRANDING: BrandingSettingsResponse = {
  logoUrl: null,
  primaryColorHex: '#4f46e5',
  secondaryColorHex: null,
  accentColorHex: null,
  backgroundColorHex: null,
  fontBody: null,
  fontHeading: null,
  radiusValue: 0.5,
  densityValue: 1,
  introVideoMediaItemId: null,
  tokenOverrides: null,
  darkModeOverrides: null,
  darkTokenOverrides: null,
  heroLayout: 'default',
  pricingFaq: null,
};

let branding: KitQuery<BrandingSettingsResponse> = kitQuery();

/** A fresh, still-loading branding read; the save command un-called. */
export function reset() {
  branding = kitQuery();
  updateBrandingCommand.mockReset();
}

export const brandingRemote = () => branding;

// ── query() ─────────────────────────────────────────────────────────────
export const getBrandingSettings = vi.fn((_orgId: string) => branding.get());

// ── command() ───────────────────────────────────────────────────────────
export const updateBrandingCommand = vi.fn();
