/**
 * The effect registry (Codex-1yd58.4, plan §5.5): every effect a stack can
 * name, one file each. What `shaders:check` cannot see is pinned here: the
 * ids are unique and match `ids.ts` (which the stack parse reads without the
 * GLSL), each sits on its own axis, and each has both fallbacks, naming an
 * effect of its own axis.
 */
import { describe, expect, it } from 'vitest';
import {
  BLEND_AMOUNTS,
  LAYER_AMOUNTS,
  MOVING_LAYER_IDS,
} from '../effects/amounts';
import type { Effect } from '../effects/effect';
import { HEADER } from '../effects/header';
import {
  BLEND_IDS,
  FRAME_IDS,
  LAYER_IDS,
  SURFACE_ONLY_LAYER_IDS,
} from '../effects/ids';
import {
  assembleEffect,
  BLENDS,
  EFFECTS,
  FRAMES,
  LAYERS,
  SETTABLE_UNIFORMS,
} from '../effects/registry';
import { declareUniforms, UNIFORMS } from '../effects/uniforms';

const TABLES = { blend: BLENDS, layer: LAYERS, frame: FRAMES } as const;

describe('effect registry', () => {
  it('holds exactly the ids the stack parse reads, axis by axis', () => {
    expect(Object.keys(BLENDS)).toEqual([...BLEND_IDS]);
    expect(Object.keys(LAYERS)).toEqual([...LAYER_IDS]);
    expect(Object.keys(FRAMES)).toEqual([...FRAME_IDS]);
    expect(EFFECTS).toHaveLength(
      BLEND_IDS.length + LAYER_IDS.length + FRAME_IDS.length
    );
  });

  it('gives every effect a unique id across all axes (the pass cache key)', () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files each effect under its own id and on its own axis', () => {
    for (const [axis, table] of Object.entries(TABLES)) {
      for (const [id, effect] of Object.entries(table)) {
        expect(effect.id).toBe(id);
        expect(effect.axis).toBe(axis);
      }
    }
  });

  it.each(
    EFFECTS.map((e) => [e.id, e] as const)
  )('%s has both fallbacks, each naming an effect of its own axis', (_id, effect: Effect) => {
    const table: Record<string, Effect> = TABLES[effect.axis];
    for (const fallback of [
      effect.phoneFallback,
      effect.reducedMotionFallback,
    ]) {
      expect(fallback).not.toBeUndefined();
      // Only a layer may be dropped: a blend or a frame must draw something.
      if (fallback === null) expect(effect.axis).toBe('layer');
      else expect(table[fallback]?.axis).toBe(effect.axis);
    }
  });

  it.each(
    EFFECTS.map((e) => [e.id, e] as const)
  )('%s reads the picture so far, names a label and an amount in range', (_id, effect: Effect) => {
    expect(effect.uniforms).toContain('u_scene');
    expect(effect.label.trim()).not.toBe('');
    expect(effect.amount).toBeGreaterThanOrEqual(0);
    expect(effect.amount).toBeLessThanOrEqual(1);
    expect(effect.glsl).toMatch(/void main\(\)/);
    // Its uniforms are generated from its list; it declares none itself.
    expect(effect.glsl).not.toMatch(/^\s*uniform\s/m);
    // Only a blend has a second preset to read, and only a surface-only
    // layer is handed the shader's own picture there (WP-8).
    const surfaceOnly = (SURFACE_ONLY_LAYER_IDS as readonly string[]).includes(
      effect.id
    );
    expect(effect.uniforms.includes('u_second')).toBe(
      effect.axis === 'blend' || surfaceOnly
    );
  });

  it('assembles a pass as the header, its declarations, then its body', () => {
    const grain = LAYERS.grain;
    const source = assembleEffect(grain);
    expect(source.startsWith(HEADER)).toBe(true);
    expect(source.startsWith('#version 300 es\n')).toBe(true);
    const declared = [...source.matchAll(/^uniform (\w+) (\w+);$/gm)].map(
      (m) => [m[2], m[1]]
    );
    expect(declared).toEqual(
      grain.uniforms.map((name) => [name, UNIFORMS[name]])
    );
    expect(source.trimEnd().endsWith(grain.glsl)).toBe(true);
  });

  it('declares each uniform with the type the compositor sets it as', () => {
    expect(declareUniforms(['u_scene', 'u_time', 'u_pointer', 'u_rect'])).toBe(
      [
        'uniform sampler2D u_scene;',
        'uniform float u_time;',
        'uniform vec2 u_pointer;',
        'uniform vec4 u_rect;',
      ].join('\n')
    );
    expect(declareUniforms([])).toBe('');
  });

  it('tells shaders:check every uniform the compositor sets, and no other', () => {
    expect([...SETTABLE_UNIFORMS].sort()).toEqual(Object.keys(UNIFORMS).sort());
    for (const effect of EFFECTS) {
      for (const name of effect.uniforms)
        expect(SETTABLE_UNIFORMS).toContain(name);
    }
  });

  it("mirrors each layer's and blend's own amount for the parse and the editor", () => {
    for (const id of LAYER_IDS)
      expect(LAYER_AMOUNTS[id], id).toBe(LAYERS[id].amount);
    for (const id of BLEND_IDS)
      expect(BLEND_AMOUNTS[id], id).toBe(BLENDS[id].amount);
  });

  it('mirrors the layers reduced motion drops, for the editor to say so', () => {
    const dropped = LAYER_IDS.filter(
      (id) => LAYERS[id].reducedMotionFallback === null
    );
    expect([...MOVING_LAYER_IDS].sort()).toEqual([...dropped].sort());
  });

  it('classifies every effect that reads the clock, and marks only those that flash', () => {
    const readers = EFFECTS.filter((e) => e.uniforms.includes('u_time')).map(
      (e) => `${e.axis}:${e.id}`
    );
    expect(readers.sort()).toEqual(Object.keys(CLOCK_READERS).sort());
    for (const effect of EFFECTS) {
      const key = `${effect.axis}:${effect.id}`;
      expect(effect.flashes ?? false, key).toBe(
        CLOCK_READERS[key]?.flashes ?? false
      );
    }
  });
});

/**
 * Every effect that reads `u_time`, and whether it FLASHES: changes the
 * light of the picture over time, so `effectTime` holds its clock to 3 steps
 * a second (WCAG 2.3.1). One that only moves pixels is not a flash. A new
 * reader of the clock fails the test above until it is listed here, with its
 * reason.
 */
const CLOCK_READERS: Record<string, { flashes: boolean; why: string }> = {
  'layer:glitch': {
    flashes: true,
    why: 'a burst tears and splits whole bands at once, changing their light',
  },
  'layer:leak': {
    flashes: true,
    why: 'it adds light, drifting across the frame',
  },
  'layer:grain': {
    flashes: false,
    why: 'zero-mean noise per pixel: the light of any area holds',
  },
  'layer:liquid': {
    flashes: false,
    why: 'it moves pixels near the pointer, adding or taking no light',
  },
};
