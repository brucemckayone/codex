/**
 * Each preset keeps its own intensity, grain and vignette (Codex-1yd58 WP-1d,
 * owner 2026-11-19): the editor's sliders write `shader-<id>-*`, a brand saved
 * with the legacy shared keys is folded into its preset's keys as the editor
 * opens it, and a switch never carries one preset's tuning to another.
 */

import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { presetFxKey } from '$lib/components/ui/ShaderHero/preset-fx-defaults';
import { getShaderConfig } from '$lib/components/ui/ShaderHero/shader-config';
import { canonicalJson, hash } from '$lib/utils/fingerprint';
import { brandEditor } from './brand-editor-store.svelte';
import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from './css-injection';
import {
  type FxOverrideMaps,
  migrateSharedFx,
  selectPreset,
  updateOverride,
} from './hero-fx-helpers';
import {
  ALL_HERO_FX_SHADER_KEYS,
  HERO_FX_DEFAULTS,
  presetFxControls,
} from './hero-fx-presets';
import { ATMOSPHERE_AXES, atmosphereShaderTokens } from './preset-axes';
import type { BrandEditorState } from './types';

type OverrideMap = Record<string, string | null>;

/**
 * What a theme reads for `preset`'s setting, in getShaderConfig's order (the
 * dark theme: its own value for each key first, then the light one).
 */
function reads(
  maps: FxOverrideMaps,
  theme: 'light' | 'dark',
  preset: string,
  setting: 'intensity' | 'grain' | 'vignette'
): string | null {
  const light = maps.tokenOverrides;
  const dark = theme === 'dark' ? (maps.darkTokenOverrides ?? {}) : {};
  const at = (key: string) =>
    [dark[key], light[key]].find((v) => v != null && v !== '');
  return at(`shader-${preset}-${setting}`) ?? at(`shader-${setting}`) ?? null;
}

/**
 * What the page paints from a light override map: getShaderConfig over the
 * CSS the brand emits, optionally for another preset (the immersive player
 * passes its content's preset as `presetOverride`).
 */
function paint(map: OverrideMap, presetOverride?: string) {
  const el = document.createElement('div');
  el.className = 'org-layout';
  for (const [k, v] of Object.entries(tokenOverridesToCssVars(map))) {
    el.style.setProperty(k, v);
  }
  document.body.appendChild(el);
  const { intensity, grain, vignette } = getShaderConfig(el, presetOverride);
  return { intensity, grain, vignette };
}

afterEach(() => {
  document.body.innerHTML = '';
});

/** A theme's current preset, as the page resolves it. */
function presetOf(maps: FxOverrideMaps, theme: 'light' | 'dark'): string {
  const light = maps.tokenOverrides['shader-preset'];
  return (
    (theme === 'dark' ? maps.darkTokenOverrides?.['shader-preset'] : null) ??
    light ??
    'none'
  );
}

describe("migrateSharedFx: the fold into the preset's own keys", () => {
  it('returns the maps themselves when there is nothing to fold', () => {
    const maps: FxOverrideMaps = {
      tokenOverrides: {
        'shader-preset': 'flow',
        'shader-flow-intensity': '1.1',
      },
      darkTokenOverrides: null,
    };
    expect(migrateSharedFx(maps)).toBe(maps);
  });

  it("moves the shared values to the light preset's keys and drops them", () => {
    const out = migrateSharedFx({
      tokenOverrides: {
        'shader-preset': 'flow',
        'shader-intensity': '0.75',
        'shader-grain': '0.05',
        'shader-vignette': '0.35',
      },
      darkTokenOverrides: null,
    });
    expect(out.tokenOverrides).toEqual({
      'shader-preset': 'flow',
      'shader-flow-intensity': '0.75',
      'shader-flow-grain': '0.05',
      'shader-flow-vignette': '0.35',
    });
    expect(out.darkTokenOverrides).toBeNull();
  });

  it('keeps a preset key that is already set, and still drops the shared one (else other presets would inherit it)', () => {
    const out = migrateSharedFx({
      tokenOverrides: {
        'shader-preset': 'flow',
        'shader-flow-intensity': '1.1',
        'shader-intensity': '0.75',
      },
      darkTokenOverrides: null,
    });
    expect(out.tokenOverrides).toEqual({
      'shader-preset': 'flow',
      'shader-flow-intensity': '1.1',
    });
  });

  it("folds the dark theme's shared values into ITS keys (production OBB: vignette 0.35 light, 0.25 dark)", () => {
    const out = migrateSharedFx({
      tokenOverrides: {
        'shader-preset': 'flow',
        'shader-intensity': '0.75',
        'shader-vignette': '0.35',
      },
      darkTokenOverrides: { 'shader-vignette': '0.25' },
    });
    expect(out.tokenOverrides).toEqual({
      'shader-preset': 'flow',
      'shader-flow-intensity': '0.75',
      'shader-flow-vignette': '0.35',
    });
    // Intensity: dark already reads the light key (0.75), so no dark entry.
    expect(out.darkTokenOverrides).toEqual({ 'shader-flow-vignette': '0.25' });
  });

  it('keeps a dark theme on another preset reading what it read', () => {
    const out = migrateSharedFx({
      tokenOverrides: { 'shader-preset': 'flow', 'shader-intensity': '0.75' },
      darkTokenOverrides: { 'shader-preset': 'suture' },
    });
    expect(out.tokenOverrides['shader-flow-intensity']).toBe('0.75');
    expect(out.darkTokenOverrides).toEqual({
      'shader-preset': 'suture',
      'shader-suture-intensity': '0.75',
    });
  });

  it("drops a theme's shared keys when it has no live preset: kept, the next preset picked would inherit them", () => {
    // Owner, 2026-11-19: each preset gets its own defaults. The "Still" look
    // wrote intensity 0 and vignette 0 with no shader.
    expect(
      migrateSharedFx({
        tokenOverrides: { 'shader-intensity': '0.75' },
        darkTokenOverrides: null,
      })
    ).toEqual({ tokenOverrides: {}, darkTokenOverrides: null });
    expect(
      migrateSharedFx({
        tokenOverrides: {
          'shader-preset': 'none',
          'shader-intensity': '0',
          'shader-vignette': '0',
        },
        darkTokenOverrides: { 'shader-grain': '0.04' },
      })
    ).toEqual({
      tokenOverrides: { 'shader-preset': 'none' },
      darkTokenOverrides: null,
    });
  });

  it('pins a light value a LIVE dark theme reads on dark before dropping it from a theme with no preset', () => {
    expect(
      migrateSharedFx({
        tokenOverrides: { 'shader-preset': 'none', 'shader-intensity': '0.9' },
        darkTokenOverrides: { 'shader-preset': 'lava' },
      })
    ).toEqual({
      tokenOverrides: { 'shader-preset': 'none' },
      darkTokenOverrides: {
        'shader-preset': 'lava',
        'shader-lava-intensity': '0.9',
      },
    });
  });

  it("reads a dark preset of '' as unset, as the page does: dark then paints light's preset", () => {
    const out = migrateSharedFx({
      tokenOverrides: { 'shader-preset': 'flow', 'shader-intensity': '0.75' },
      darkTokenOverrides: { 'shader-preset': '', 'shader-intensity': '0.5' },
    });
    expect(out.darkTokenOverrides).toEqual({
      'shader-preset': '',
      'shader-flow-intensity': '0.5',
    });
  });

  it("moves a cut preset's value to its survivor (nebula -> aurora)", () => {
    const out = migrateSharedFx({
      tokenOverrides: { 'shader-preset': 'nebula', 'shader-intensity': '0.8' },
      darkTokenOverrides: null,
    });
    expect(out.tokenOverrides['shader-aurora-intensity']).toBe('0.8');
    expect(out.tokenOverrides['shader-intensity']).toBeUndefined();
  });

  it('never changes what either theme renders for its current preset', () => {
    const cases: FxOverrideMaps[] = [
      {
        tokenOverrides: { 'shader-preset': 'flow', 'shader-intensity': '0.75' },
        darkTokenOverrides: { 'shader-intensity': '0.5' },
      },
      {
        tokenOverrides: { 'shader-preset': 'flow', 'shader-grain': '0.05' },
        darkTokenOverrides: {
          'shader-preset': 'suture',
          'shader-grain': '0.01',
        },
      },
      {
        tokenOverrides: {
          'shader-preset': 'ripple',
          'shader-ripple-vignette': '0.3',
          'shader-vignette': '0.1',
        },
        darkTokenOverrides: { 'shader-vignette': '0.4' },
      },
      {
        tokenOverrides: { 'shader-preset': 'none', 'shader-intensity': '0.9' },
        darkTokenOverrides: {
          'shader-preset': 'lava',
          'shader-intensity': '1.2',
        },
      },
      {
        tokenOverrides: { 'shader-intensity': '0.9' },
        darkTokenOverrides: { 'shader-preset': 'topo' },
      },
    ];
    for (const before of cases) {
      const after = migrateSharedFx(before);
      for (const theme of ['light', 'dark'] as const) {
        const preset = presetOf(before, theme);
        if (preset === 'none') continue;
        for (const setting of ['intensity', 'grain', 'vignette'] as const) {
          expect(
            reads(after, theme, preset, setting),
            `${theme} ${preset} ${setting}`
          ).toBe(reads(before, theme, preset, setting));
        }
      }
    }
  });
});

describe("the sliders write the active preset's own keys", () => {
  it('gives each preset its own three keys, defaulting to its own values', () => {
    const keys = presetFxControls('suture').map((c) => c.key);
    expect(keys).toEqual([
      'shader-suture-intensity',
      'shader-suture-grain',
      'shader-suture-vignette',
    ]);
    expect(keys.map((k) => HERO_FX_DEFAULTS[k])).toEqual([
      '1.6',
      '0.025',
      '0.1',
    ]);
    expect(HERO_FX_DEFAULTS['shader-flow-intensity']).toBe('0.65');
  });

  it("drops a key set back to its preset's default (the value a range input reports)", () => {
    const writes: Array<[string, string | null]> = [];
    updateOverride('shader-suture-intensity', '1.6', (k, v) =>
      writes.push([k, v])
    );
    updateOverride('shader-flow-vignette', '0.2', (k, v) =>
      writes.push([k, v])
    );
    updateOverride('shader-suture-intensity', '0.65', (k, v) =>
      writes.push([k, v])
    );
    expect(writes).toEqual([
      ['shader-suture-intensity', null],
      ['shader-flow-vignette', null],
      // 0.65 is flow's default, not suture's: kept.
      ['shader-suture-intensity', '0.65'],
    ]);
  });

  it("a switch picks up the new preset's values, and a switch back restores the old one's", () => {
    const map: OverrideMap = { 'shader-preset': 'flow' };
    const write = (k: string, v: string | null) => {
      if (v === null) delete map[k];
      else map[k] = v;
    };
    const intensityKey = (preset: 'flow' | 'suture') =>
      presetFxControls(preset)[0].key;

    updateOverride(intensityKey('flow'), '1.1', write);
    selectPreset('suture', write, map);
    // Suture does not inherit flow's 1.1: its slider reads its own default.
    expect(map[intensityKey('suture')]).toBeUndefined();
    expect(HERO_FX_DEFAULTS[intensityKey('suture')]).toBe('1.6');
    updateOverride(intensityKey('suture'), '2.2', write);

    selectPreset('flow', write, map);
    expect(map).toEqual({
      'shader-preset': 'flow',
      'shader-flow-intensity': '1.1',
      'shader-suture-intensity': '2.2',
    });
  });

  it('"None" clears every preset\'s keys too', () => {
    expect(ALL_HERO_FX_SHADER_KEYS).toContain('shader-suture-intensity');
    expect(ALL_HERO_FX_SHADER_KEYS).toContain('shader-lenia-grain');
    expect(ALL_HERO_FX_SHADER_KEYS).toContain('shader-intensity');
  });
});

describe('atmospheres and CSS emission', () => {
  it("an atmosphere sets its shader's own keys, never the shared ones", () => {
    for (const atmos of Object.values(ATMOSPHERE_AXES)) {
      const tokens = atmosphereShaderTokens(atmos);
      expect(tokens['shader-intensity']).toBeUndefined();
      expect(tokens['shader-vignette']).toBeUndefined();
      expect(tokens['shader-grain']).toBeUndefined();
      if (atmos.shader === 'none') continue;
      expect(tokens[`shader-${atmos.shader}-intensity`]).toBe(
        String(atmos.intensity)
      );
      expect(tokens[`shader-${atmos.shader}-vignette`]).toBe(
        String(atmos.vignette)
      );
    }
  });

  it('emits a preset key as --brand-shader-<id>-* (and -dark)', () => {
    expect(
      tokenOverridesToCssVars({ 'shader-suture-intensity': '2' })[
        '--brand-shader-suture-intensity'
      ]
    ).toBe('2');
    expect(
      darkTokenOverridesToCssVars({ 'shader-suture-intensity': '2.5' })[
        '--brand-shader-suture-intensity-dark'
      ]
    ).toBe('2.5');
  });
});

describe('brandEditor.open folds a legacy brand', () => {
  const ORG_ID = '00000000-0000-4000-8000-000000000000';
  const legacy = (): BrandEditorState => ({
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides: {
      'shader-preset': 'flow',
      'shader-intensity': '0.75',
      'shader-vignette': '0.35',
    },
    darkOverrides: null,
    darkTokenOverrides: { 'shader-vignette': '0.25' },
    heroLayout: 'default',
  });

  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
  });

  it('into the saved brand and the draft, so it opens clean, and the first save carries it', () => {
    brandEditor.open(ORG_ID, legacy());
    flushSync();
    const folded = {
      'shader-preset': 'flow',
      'shader-flow-intensity': '0.75',
      'shader-flow-vignette': '0.35',
    };
    expect(brandEditor.saved?.tokenOverrides).toEqual(folded);
    expect(brandEditor.pending?.tokenOverrides).toEqual(folded);
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-flow-vignette': '0.25',
    });
    expect(brandEditor.isDirty).toBe(false);

    // Any edit, then Save: the payload is the folded brand plus the edit.
    brandEditor.setEditingTheme('light');
    brandEditor.setThemeTokenOverride(presetFxKey('suture', 'intensity'), '2');
    const sent = brandEditor.getSavePayload();
    expect(sent?.tokenOverrides).toEqual({
      ...folded,
      'shader-suture-intensity': '2',
    });
    expect(sent?.tokenOverrides['shader-intensity']).toBeUndefined();
  });

  it('leaves a brand with no shared keys exactly as saved', () => {
    const brand = {
      ...legacy(),
      tokenOverrides: { 'shader-preset': 'flow' },
      darkTokenOverrides: null,
    };
    brandEditor.open(ORG_ID, brand);
    expect(brandEditor.saved?.tokenOverrides).toEqual({
      'shader-preset': 'flow',
    });
    expect(brandEditor.isDirty).toBe(false);
  });

  const STORAGE_KEY = 'codex:brand-editor';
  /** The tab's crash-recovery row, as the editor wrote it. */
  const row = (): { baseline?: string } | null => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  };
  /**
   * The store's fingerprint of a brand already in the form the server hands
   * back (upper-case colours, a token map, a non-empty dark map, a layout):
   * there every normalisation it applies changes nothing. A row an editor
   * wrote before WP-1d carries this print of the UNFOLDED brand.
   */
  const serverPrint = (brand: BrandEditorState) =>
    hash(canonicalJson({ ...brand, logoUrl: undefined }));
  const edit = () => {
    brandEditor.setEditingTheme('light');
    brandEditor.setThemeTokenOverride(presetFxKey('suture', 'intensity'), '2');
    flushSync();
  };

  it('writes no recovery row for a legacy brand it opens: the fold is not an edit', () => {
    brandEditor.open(ORG_ID, legacy());
    flushSync();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the same baseline across opens, so its own draft comes back', () => {
    brandEditor.open(ORG_ID, legacy());
    edit();
    const first = row()?.baseline;
    expect(first).toBeTruthy();
    brandEditor.close();

    expect(brandEditor.open(ORG_ID, legacy())).toBe('restored');
    flushSync();
    expect(row()?.baseline).toBe(first);
    expect(brandEditor.pending?.tokenOverrides['shader-suture-intensity']).toBe(
      '2'
    );
  });

  it('(control) serverPrint is the baseline the editor writes for a brand in that form', () => {
    // Nothing to fold, so the editor's baseline is this brand's own print.
    const brand = {
      ...legacy(),
      tokenOverrides: { 'shader-preset': 'flow' },
      darkTokenOverrides: { 'shader-flow-vignette': '0.25' },
    };
    brandEditor.open(ORG_ID, brand);
    expect(brandEditor.saved).toEqual(brand);
    edit();
    expect(row()?.baseline).toBe(serverPrint(brand));
  });

  it('restores a draft kept before WP-1d, folding the shared keys it still holds', () => {
    // Its baseline is the print of the brand as the server sent it, unfolded;
    // the editor's own baseline is the folded brand's. The same brand: the
    // draft is safe, and a "brand has changed" discard would lose it.
    const server = legacy();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        orgId: ORG_ID,
        baseline: serverPrint(server),
        pending: { ...server, primaryColor: '#112233' },
        level: 'home',
      })
    );
    expect(brandEditor.open(ORG_ID, server)).toBe('restored');
    expect(brandEditor.pending?.primaryColor).toBe('#112233');
    expect(brandEditor.pending?.tokenOverrides).toEqual({
      'shader-preset': 'flow',
      'shader-flow-intensity': '0.75',
      'shader-flow-vignette': '0.35',
    });
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-flow-vignette': '0.25',
    });
  });

  it('still discards a draft kept against a brand someone has since saved over', () => {
    const server = legacy();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        orgId: ORG_ID,
        baseline: serverPrint({ ...server, primaryColor: '#445566' }),
        pending: { ...server, primaryColor: '#112233' },
        level: 'home',
      })
    );
    expect(brandEditor.open(ORG_ID, server)).toBe('discarded');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
  });
});

describe('what the page paints after the fold', () => {
  const ORG_ID = '00000000-0000-4000-8000-000000000000';
  const brand = (tokenOverrides: OverrideMap): BrandEditorState => ({
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
    darkTokenOverrides: null,
    heroLayout: 'default',
  });
  /** The light override map the first Save would send. */
  const savedAfterOpen = (tokens: OverrideMap): OverrideMap => {
    brandEditor.open(ORG_ID, brand(tokens));
    return brandEditor.getSavePayload()?.tokenOverrides ?? {};
  };

  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
  });

  it("keeps a brand's tuning on its own preset, and gives its other surfaces each preset's tuned default", () => {
    // OWNER RULING (2026-11-19): "each preset's own defaults". Production OBB
    // set the shared keys on flow. Its flow hero paints the same after the
    // fold; a surface on another preset (here caustic content in the
    // immersive player) stops inheriting flow's 0.75 after the next save and
    // takes caustic's own default. Intended: not a regression to fix.
    const legacy = { 'shader-preset': 'flow', 'shader-intensity': '0.75' };
    const after = savedAfterOpen(legacy);
    expect(paint(after).intensity).toBe(0.75);
    expect(paint(after).intensity).toBe(paint(legacy).intensity);
    expect(paint(legacy, 'caustic').intensity).toBe(0.75);
    expect(paint(after, 'caustic').intensity).toBe(1.5);
  });

  it("counts a '0' as a value: an own 0 beats a shared one, and a shared 0 folds as 0", () => {
    expect(
      paint({
        'shader-preset': 'flow',
        'shader-flow-vignette': '0',
        'shader-vignette': '0.35',
      }).vignette
    ).toBe(0);
    const after = savedAfterOpen({
      'shader-preset': 'flow',
      'shader-vignette': '0',
    });
    expect(after).toEqual({
      'shader-preset': 'flow',
      'shader-flow-vignette': '0',
    });
    expect(paint(after).vignette).toBe(0);
    expect(brandEditor.isDirty).toBe(false);
  });
});
