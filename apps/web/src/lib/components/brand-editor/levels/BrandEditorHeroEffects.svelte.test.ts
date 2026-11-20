/**
 * The hero effect's intensity / grain / vignette sliders show what the page
 * paints (Codex-1yd58 WP-1d), on either theme, for a brand saved before each
 * preset had its own keys.
 *
 * "Paints" is getShaderConfig over the CSS the pending brand emits, the
 * function the hero itself calls. "Shows" is the value the slider's label
 * prints. A slider that disagrees with the page is a control that lies.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { brandEditor } from '$lib/brand-editor';
import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from '$lib/brand-editor/css-injection';
import { HERO_FX_PRESETS } from '$lib/brand-editor/hero-fx-presets';
import { ATMOSPHERE_AXES } from '$lib/brand-editor/preset-axes';
import type { BrandEditorState } from '$lib/brand-editor/types';
import { getShaderConfig } from '$lib/components/ui/ShaderHero/shader-config';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandEditorHeroEffects from './BrandEditorHeroEffects.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';
type OverrideMap = Record<string, string | null>;

function brand(
  tokenOverrides: OverrideMap,
  darkTokenOverrides: OverrideMap | null = null
): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides,
    darkOverrides: null,
    darkTokenOverrides,
    heroLayout: 'default',
  };
}

/** What the hero paints from the pending brand, on `theme`. */
function painted(theme: 'light' | 'dark') {
  const pending = brandEditor.pending;
  expect(pending).toBeTruthy();
  const vars: Record<string, string> = {
    ...tokenOverridesToCssVars(pending?.tokenOverrides ?? {}),
  };
  if (theme === 'dark') {
    Object.assign(
      vars,
      darkTokenOverridesToCssVars(pending?.darkTokenOverrides ?? {}),
      // org-brand.css sets this under [data-theme='dark'].
      { '--brand-shader-is-dark': '1' }
    );
  }
  const el = document.createElement('div');
  el.className = 'org-layout';
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  document.body.appendChild(el);
  const { intensity, grain, vignette } = getShaderConfig(el);
  el.remove();
  return { intensity, grain, vignette };
}

/** The value a slider's label prints, as a number. Null when not shown. */
function shown(key: string): number | null {
  const text = document.querySelector(
    `label[for="${key}"] .slider-field__value`
  )?.textContent;
  return text == null ? null : Number(text);
}

function clickPreset(id: string) {
  const index = HERO_FX_PRESETS.findIndex((p) => p.id === id);
  const cards = document.querySelectorAll<HTMLButtonElement>(
    '.hero-fx__preset-card'
  );
  cards[index].click();
  flushSync();
}

let component: ReturnType<typeof mount> | null = null;
function render() {
  component = mount(BrandEditorHeroEffects, { target: document.body });
  flushSync();
}

beforeEach(() => {
  brandEditor.close();
  sessionStorage.clear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  brandEditor.close();
  document.body.innerHTML = '';
});

describe('BrandEditorHeroEffects: the sliders show what the page paints', () => {
  test('a pre-WP-1d "Still" brand that then picks Flow paints the defaults its sliders show', () => {
    // What the Still atmosphere wrote before WP-1d: no shader, and the SHARED
    // keys at 0. Kept, they became Flow's fallback: it painted 0 / 0 while its
    // sliders read 0.65 / 0.2. The fold drops them on open (no live preset).
    const still = ATMOSPHERE_AXES.still;
    brandEditor.open(
      ORG_ID,
      brand({
        'shader-preset': still.shader,
        'shader-intensity': String(still.intensity),
        'shader-vignette': String(still.vignette),
      })
    );
    expect(brandEditor.pending?.tokenOverrides).toEqual({
      'shader-preset': 'none',
    });
    render();
    clickPreset('flow');

    const paint = painted('light');
    expect(shown('shader-flow-intensity')).toBe(paint.intensity);
    expect(shown('shader-flow-grain')).toBe(paint.grain);
    expect(shown('shader-flow-vignette')).toBe(paint.vignette);
    expect([paint.intensity, paint.vignette]).toEqual([0.65, 0.2]);
  });

  test('while editing the dark theme, they show what dark paints, falling back to light', () => {
    // Production OBB's shape: shared keys on flow, vignette diverged on dark.
    brandEditor.open(
      ORG_ID,
      brand(
        {
          'shader-preset': 'flow',
          'shader-intensity': '0.75',
          'shader-vignette': '0.35',
        },
        { 'shader-vignette': '0.25' }
      )
    );
    render();

    brandEditor.setEditingTheme('dark');
    flushSync();
    const dark = painted('dark');
    expect(shown('shader-flow-intensity')).toBe(dark.intensity);
    expect(shown('shader-flow-vignette')).toBe(dark.vignette);
    expect([dark.intensity, dark.vignette]).toEqual([0.75, 0.25]);

    brandEditor.setEditingTheme('light');
    flushSync();
    const light = painted('light');
    expect(shown('shader-flow-intensity')).toBe(light.intensity);
    expect(shown('shader-flow-vignette')).toBe(light.vignette);
    expect([light.intensity, light.vignette]).toEqual([0.75, 0.35]);
  });

  test("a dark theme on its own preset shows that preset's keys, at its tuned default", () => {
    brandEditor.open(
      ORG_ID,
      brand(
        { 'shader-preset': 'flow', 'shader-intensity': '0.75' },
        { 'shader-preset': 'suture' }
      )
    );
    render();
    brandEditor.setEditingTheme('dark');
    flushSync();

    expect(shown('shader-flow-intensity')).toBeNull();
    // Dark read the shared 0.75 before the fold, so it is pinned on dark.
    const dark = painted('dark');
    expect(shown('shader-suture-intensity')).toBe(dark.intensity);
    expect(dark.intensity).toBe(0.75);
    expect(shown('shader-suture-vignette')).toBe(dark.vignette);
    expect(dark.vignette).toBe(0.1);
  });
});
