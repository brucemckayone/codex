import { afterEach, describe, expect, it, vi } from 'vitest';

// A stand-in renderer, so `loadRenderer` is proven to reach the SURVIVOR's
// module for a cut id without compiling any GLSL under jsdom.
vi.mock('../renderers/ether-renderer', () => ({
  createEtherRenderer: () => ({ stub: 'ether' }),
}));

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

import { loadRenderer } from '../load-renderer';
import {
  CUT_PRESET_ALIASES,
  getBrandPresetId,
  getShaderConfig,
  presetIsUnknown,
  resolvePresetId,
  warnUnknownPreset,
} from '../shader-config';

/**
 * The alias door for the 25 presets cut on 2026-11-19 (Codex-1yd58 WP-1c).
 *
 * A stored preset id outlives its preset — an org's `shader-preset` token and
 * `content.shader_preset` are free text — and before the door an unknown id
 * fell through to `'none'` and blanked the hero. These tests pin the owner's
 * map as a LITERAL rather than reading it back out of `CUT_PRESET_ALIASES`, so
 * an edit to the map that the owner did not approve fails here.
 */

/** The owner-approved map, cut id → survivor (2026-11-19). */
const OWNER_MAP: Record<string, string> = {
  warp: 'suture',
  silk: 'film',
  bismuth: 'film',
  pearl: 'film',
  ocean: 'caustic',
  nebula: 'aurora',
  rain: 'ripple',
  waves: 'ripple',
  turing: 'lenia',
  life: 'lenia',
  growth: 'lenia',
  frost: 'physarum',
  mycelium: 'physarum',
  spore: 'physarum',
  glow: 'ether',
  pollen: 'ether',
  vortex: 'ether',
  gyroid: 'ether',
  julia: 'ether',
  tunnel: 'ether',
  tendrils: 'flow',
  clouds: 'flow',
  vapor: 'flow',
  plasma: 'flow',
  geode: 'topo',
};

const SURVIVORS = [
  'flow',
  'suture',
  'ripple',
  'film',
  'caustic',
  'ether',
  'pulse',
  'ink',
  'topo',
  'glass',
  'flux',
  'lava',
  'physarum',
  'aurora',
  'lenia',
  'fracture',
];

/** A detached `.org-layout` carrying the given custom properties. */
function mountLayout(props: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'org-layout';
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  logger.warn.mockClear();
});

/** The `shader.unknown_preset` records logged so far, as `{ id, where }`. */
function unknownWarnings(): unknown[] {
  return logger.warn.mock.calls
    .filter(([event]) => event === 'shader.unknown_preset')
    .map(([, meta]) => meta);
}

describe('resolvePresetId', () => {
  it('maps every one of the 25 cut presets to its survivor', () => {
    expect(Object.keys(OWNER_MAP)).toHaveLength(25);
    for (const [cut, survivor] of Object.entries(OWNER_MAP)) {
      expect(resolvePresetId(cut), cut).toBe(survivor);
    }
  });

  it('holds exactly the owner map: no cut id missing, none extra', () => {
    expect(CUT_PRESET_ALIASES).toEqual(OWNER_MAP);
  });

  it('passes every survivor through as itself', () => {
    expect(SURVIVORS).toHaveLength(16);
    for (const id of SURVIVORS) expect(resolvePresetId(id), id).toBe(id);
  });

  it('never aliases a live id, and only ever onto a live one', () => {
    for (const [cut, survivor] of Object.entries(CUT_PRESET_ALIASES)) {
      expect(SURVIVORS, `${cut} is cut, so it is not live`).not.toContain(cut);
      expect(SURVIVORS, `${cut} → ${survivor}`).toContain(survivor);
    }
  });

  it("passes 'none' through", () => {
    expect(resolvePresetId('none')).toBe('none');
  });

  it('returns null for empty, missing or unknown ids, so the caller defaults', () => {
    expect(resolvePresetId('')).toBeNull();
    expect(resolvePresetId(null)).toBeNull();
    expect(resolvePresetId(undefined)).toBeNull();
    expect(resolvePresetId('bogus')).toBeNull();
    expect(resolvePresetId('   ')).toBeNull();
    // Matched exactly once trimmed: case is not folded.
    expect(resolvePresetId('Flow')).toBeNull();
  });

  it('trims before the lookup, as a CSS read already does', () => {
    // An API client may send padding; the brand var arrives trimmed.
    expect(resolvePresetId(' flow')).toBe('flow');
    expect(resolvePresetId('flow\n')).toBe('flow');
    expect(resolvePresetId('  glow ')).toBe('ether');
    expect(resolvePresetId(' none ')).toBe('none');
  });

  it('never resolves a name off Object.prototype', () => {
    for (const id of [
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
    ]) {
      expect(resolvePresetId(id), id).toBeNull();
    }
  });
});

describe('getShaderConfig through the alias door', () => {
  it("paints a cut preset in the brand var as its survivor, not 'none'", () => {
    const el = mountLayout({ '--brand-shader-preset': 'glow' });
    expect(getShaderConfig(el).preset).toBe('ether');
  });

  it('reads the dark brand var through the door too', () => {
    const el = mountLayout({
      '--brand-shader-is-dark': '1',
      '--brand-shader-preset': 'flow',
      '--brand-shader-preset-dark': 'nebula',
    });
    expect(getShaderConfig(el).preset).toBe('aurora');
  });

  it('resolves a cut preset passed as the override', () => {
    const el = mountLayout({ '--brand-shader-preset': 'flow' });
    expect(getShaderConfig(el, 'warp').preset).toBe('suture');
  });

  it("falls back to the brand's preset when the override names none", () => {
    const el = mountLayout({ '--brand-shader-preset': 'lava' });
    expect(getShaderConfig(el, 'bogus').preset).toBe('lava');
    expect(getShaderConfig(el, null).preset).toBe('lava');
  });

  it("is 'none' when neither the override nor the brand names a preset", () => {
    expect(getShaderConfig(mountLayout({})).preset).toBe('none');
    const el = mountLayout({ '--brand-shader-preset': 'bogus' });
    expect(getShaderConfig(el).preset).toBe('none');
  });

  it("reads the survivor's own params for a cut id", () => {
    const el = mountLayout({
      '--brand-shader-preset': 'clouds',
      '--brand-shader-flow-curl': '0.9',
    });
    const cfg = getShaderConfig(el);
    expect(cfg.preset).toBe('flow');
    expect(cfg).toHaveProperty('curl', 0.9);
  });
});

describe('getBrandPresetId', () => {
  it("is the brand's preset, resolved", () => {
    expect(
      getBrandPresetId(mountLayout({ '--brand-shader-preset': 'ink' }))
    ).toBe('ink');
    expect(
      getBrandPresetId(mountLayout({ '--brand-shader-preset': 'geode' }))
    ).toBe('topo');
    expect(
      getBrandPresetId(mountLayout({ '--brand-shader-preset': 'none' }))
    ).toBe('none');
  });

  it('is null when the brand names no preset, or one that does not exist', () => {
    expect(getBrandPresetId(mountLayout({}))).toBeNull();
    expect(
      getBrandPresetId(mountLayout({ '--brand-shader-preset': 'bogus' }))
    ).toBeNull();
  });

  it('finds the org layout in the document when none is passed', () => {
    mountLayout({ '--brand-shader-preset': 'pollen' });
    expect(getBrandPresetId()).toBe('ether');
  });
});

describe('unknown ids: noticed, logged once, never resolved', () => {
  it('calls an id unknown only when it is set and names no preset', () => {
    expect(presetIsUnknown('bogus')).toBe(true);
    expect(presetIsUnknown(' bogus ')).toBe(true);
    expect(presetIsUnknown('flow')).toBe(false);
    expect(presetIsUnknown('glow')).toBe(false);
    expect(presetIsUnknown('none')).toBe(false);
    for (const unset of ['', '  ', null, undefined]) {
      expect(presetIsUnknown(unset), String(unset)).toBe(false);
    }
  });

  it('keeps resolvePresetId pure: resolving an unknown id logs nothing', () => {
    expect(resolvePresetId('quiet-unknown')).toBeNull();
    expect(presetIsUnknown('quiet-unknown')).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs an unknown id once per source per session', () => {
    warnUnknownPreset('once-only', 'content');
    warnUnknownPreset(' once-only ', 'content');
    warnUnknownPreset('once-only', 'studio');
    warnUnknownPreset('once-only', 'studio');
    expect(unknownWarnings()).toEqual([
      { id: 'once-only', where: 'content' },
      { id: 'once-only', where: 'studio' },
    ]);
  });

  it("logs an unknown override as 'override', and paints the brand's preset", () => {
    const el = mountLayout({ '--brand-shader-preset': 'ink' });
    expect(getShaderConfig(el, 'gone-override').preset).toBe('ink');
    expect(unknownWarnings()).toEqual([
      { id: 'gone-override', where: 'override' },
    ]);
  });

  it("logs an unknown brand preset as 'brand', on every path that reads it", () => {
    const el = mountLayout({ '--brand-shader-preset': 'gone-brand' });
    expect(getShaderConfig(el).preset).toBe('none');
    expect(getBrandPresetId(el)).toBeNull();
    expect(unknownWarnings()).toEqual([{ id: 'gone-brand', where: 'brand' }]);
  });

  it('logs nothing for an unset or cut id', () => {
    getShaderConfig(mountLayout({}), '');
    getShaderConfig(mountLayout({ '--brand-shader-preset': 'nebula' }), null);
    expect(unknownWarnings()).toEqual([]);
  });
});

describe('loadRenderer through the alias door', () => {
  it("loads the survivor's renderer for a cut id", async () => {
    await expect(loadRenderer('glow')).resolves.toEqual({ stub: 'ether' });
  });

  it("loads nothing for 'none', an unknown id or no id", async () => {
    await expect(loadRenderer('none')).resolves.toBeNull();
    await expect(loadRenderer('bogus')).resolves.toBeNull();
    await expect(loadRenderer(null)).resolves.toBeNull();
    await expect(loadRenderer(undefined)).resolves.toBeNull();
  });
});
