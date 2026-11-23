/**
 * The effect registry: every effect a stack can name, one file each. What
 * `shaders:check` cannot see is pinned here: the ids are unique and match
 * `ids.ts` (which the stack parse reads without the GLSL), each sits on its own
 * axis, and each has both fallbacks, naming an effect of its own axis.
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
  BRAND_FRAME_IDS,
  FRAME_IDS,
  isBrandFrameId,
  LAYER_IDS,
  MEDIA_PASS_IDS,
  PASSTHROUGH_FRAME,
  SURFACE_ONLY_LAYER_IDS,
  SURFACE_PASS,
} from '../effects/ids';
import {
  assembleEffect,
  BLENDS,
  EFFECTS,
  FRAMES,
  LAYERS,
  MEDIA,
  SETTABLE_UNIFORMS,
} from '../effects/registry';
import { declareUniforms, UNIFORMS } from '../effects/uniforms';

const TABLES = {
  blend: BLENDS,
  layer: LAYERS,
  frame: FRAMES,
  media: MEDIA,
} as const;

describe('effect registry', () => {
  it('holds exactly the ids the stack parse reads, axis by axis', () => {
    expect(Object.keys(BLENDS)).toEqual([...BLEND_IDS]);
    expect(Object.keys(LAYERS)).toEqual([...LAYER_IDS]);
    expect(Object.keys(FRAMES)).toEqual([...FRAME_IDS]);
    expect(Object.keys(MEDIA)).toEqual([...MEDIA_PASS_IDS]);
    expect(EFFECTS).toHaveLength(
      BLEND_IDS.length +
        LAYER_IDS.length +
        FRAME_IDS.length +
        MEDIA_PASS_IDS.length
    );
  });

  it('draws each surface a Showreel may name with a media pass (5b)', () => {
    for (const [surface, id] of Object.entries(SURFACE_PASS)) {
      expect(MEDIA[id]?.axis, surface).toBe('media');
    }
    expect(Object.keys(SURFACE_PASS)).toEqual(['duotone', 'colour', 'grain']);
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
      // Only a layer or a pass over the media may be dropped (the push-in,
      // under reduced motion): a blend or a frame must draw something.
      if (fallback === null) expect(['layer', 'media']).toContain(effect.axis);
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
    // Only a blend has a second preset to read, and only a surface-only layer
    // is handed the shader's own picture there.
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

describe('the frames a brand may name', () => {
  it("are every frame but the Showreel's film frames, which FRAME_IDS still holds", () => {
    const film = ['film-fill', 'film-name', 'film-portrait'];
    expect(FRAME_IDS).toEqual(expect.arrayContaining(film));
    for (const id of film) {
      expect(BRAND_FRAME_IDS).not.toContain(id);
      expect(isBrandFrameId(id)).toBe(false);
    }
    expect([...BRAND_FRAME_IDS, ...film].sort()).toEqual([...FRAME_IDS].sort());
    for (const id of BRAND_FRAME_IDS) expect(isBrandFrameId(id)).toBe(true);
    expect(BRAND_FRAME_IDS).toContain(PASSTHROUGH_FRAME);
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
  'media:surface-grain': {
    flashes: false,
    why: "the grain layer's own GLSL, over the footage alone",
  },
  'layer:liquid': {
    flashes: false,
    why: 'it moves pixels near the pointer, adding or taking no light',
  },
};
