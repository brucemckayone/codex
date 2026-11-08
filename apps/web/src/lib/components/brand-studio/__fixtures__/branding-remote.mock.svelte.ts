/**
 * Reactive test double for `$lib/remote/branding.remote`, as the studio brand
 * page reads it (Codex-zskbp).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. The
 * branding read is one `$state` slot. A test answers or fails it with the
 * kit-shaped helpers the studio fixtures already share (`land`, `fail`,
 * `deferRefresh` in `studio/__fixtures__/subscription-remote.mock.svelte`),
 * and watches the page re-render, as in production. A slot nobody has
 * answered is still loading.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import type { BrandingSettingsResponse } from '@codex/shared-types';
import { vi } from 'vitest';
import type { QuerySlot } from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';

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

function loadingSlot(): QuerySlot<BrandingSettingsResponse> {
  const slot = $state<QuerySlot<BrandingSettingsResponse>>({
    current: undefined,
    error: undefined,
    loading: true,
    refresh: vi.fn(async () => {}),
  });
  return slot;
}

let branding = loadingSlot();

/** A fresh, still-loading branding read; the save command un-called. */
export function reset() {
  branding = loadingSlot();
  updateBrandingCommand.mockReset();
}

export const brandingSlot = () => branding;

// ── query() ─────────────────────────────────────────────────────────────
export const getBrandingSettings = vi.fn((_orgId: string) => branding);

// ── command() ───────────────────────────────────────────────────────────
export const updateBrandingCommand = vi.fn();
