/**
 * The stack's layers: the shader lab's twelve, the Showreel mock's reeded glass
 * and brand monotone, and the surface-only "through the shader". What
 * `shaders:check` cannot see is pinned here: each runs on any picture (the
 * stack's, or the Showreel's film in its surface slot), takes its colours from
 * the brand, and falls back as the plan says.
 */
import { describe, expect, it } from 'vitest';
import {
  LAYER_IDS,
  type LayerId,
  SURFACE_ONLY_LAYER_IDS,
} from '../effects/ids';
import { LAYERS } from '../effects/registry';
import type { UniformName } from '../effects/uniforms';
import { planStack } from '../plan';
import { BARE_STACK, type StackConfig } from '../stack-config';

const STACK_LAYERS = LAYER_IDS.filter(
  (id) => !SURFACE_ONLY_LAYER_IDS.includes(id)
);

/** Every stack layer once, at its own default strength. */
const everyLayer: StackConfig = {
  ...BARE_STACK,
  layers: STACK_LAYERS.map((id) => ({ id, amount: null })),
};

const planned = (ctx: { phone: boolean; reducedMotion: boolean }) =>
  planStack(everyLayer, {
    ...ctx,
    hasSecond: false,
    hasMask: false,
  }).layers.map((l) => [l.effect.id, l.amount]);

/** Where the film is: a layer that read these would only work on the stage. */
const STAGE_UNIFORMS: readonly UniformName[] = [
  'u_media',
  'u_mask',
  'u_rect',
  'u_fade',
  'u_mediaSize',
  'u_hasMedia',
];
const BRAND_UNIFORMS: readonly UniformName[] = [
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
];
/** The layers that paint in colour rather than move or relight the picture. */
const COLOURED: readonly LayerId[] = [
  'halftone',
  'leak',
  'duotone',
  'dither',
  'ink',
  'monotone',
];

describe('the layers', () => {
  it('are the lab twelve, the mock two and the surface-only one', () => {
    expect(LAYER_IDS).toHaveLength(15);
    expect(SURFACE_ONLY_LAYER_IDS).toEqual(['shader-light']);
  });

  it.each(
    LAYER_IDS.map((id) => [id])
  )('%s runs on any picture: it reads u_scene and nothing of the stage', (id) => {
    const { uniforms } = LAYERS[id];
    expect(uniforms).toContain('u_scene');
    for (const name of STAGE_UNIFORMS) expect(uniforms).not.toContain(name);
  });

  it.each(
    COLOURED.map((id) => [id])
  )('%s takes its colours from the brand', (id) => {
    expect(
      LAYERS[id].uniforms.some((name) => BRAND_UNIFORMS.includes(name))
    ).toBe(true);
  });

  it.each(
    LAYER_IDS.map((id) => [id])
  )('%s writes no colour of its own (only greys)', (id) => {
    const literals = [
      ...LAYERS[id].glsl.matchAll(
        /vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g
      ),
    ];
    for (const [literal, r, g, b] of literals) {
      expect(
        Number(r) === Number(g) && Number(g) === Number(b),
        `${id}: ${literal}`
      ).toBe(true);
    }
  });

  it("fills a curved screen's corners with the brand's ground, never black", () => {
    expect(LAYERS.crt.uniforms).toContain('u_bgColor');
    expect(LAYERS.crt.glsl).not.toMatch(/vec4\(\s*0\.0\s*,\s*0\.0\s*,\s*0\.0/);
  });

  it('hands a surface-only layer the shader picture beside the one it treats', () => {
    for (const id of SURFACE_ONLY_LAYER_IDS) {
      expect(LAYERS[id].uniforms).toEqual(
        expect.arrayContaining(['u_scene', 'u_second'])
      );
    }
  });
});

describe('the layers under the plan', () => {
  it('all run as themselves on a desktop with motion, and on a phone', () => {
    const all = STACK_LAYERS.map((id) => [id, LAYERS[id].amount]);
    expect(planned({ phone: false, reducedMotion: false })).toEqual(all);
    expect(planned({ phone: true, reducedMotion: false })).toEqual(all);
  });

  it('drop glitch and liquid under reduced motion, and keep the rest', () => {
    const kept = STACK_LAYERS.filter(
      (id) => id !== 'glitch' && id !== 'liquid'
    ).map((id) => [id, LAYERS[id].amount]);
    expect(planned({ phone: false, reducedMotion: true })).toEqual(kept);
    expect(planned({ phone: true, reducedMotion: true })).toEqual(kept);
  });

  it('keep the strength the brand asked for', () => {
    const stack: StackConfig = {
      ...BARE_STACK,
      layers: [
        { id: 'halftone', amount: 0.3 },
        { id: 'glitch', amount: 0.9 },
      ],
    };
    expect(
      planStack(stack, {
        phone: true,
        reducedMotion: false,
        hasSecond: false,
        hasMask: false,
      }).layers.map((l) => [l.effect.id, l.amount])
    ).toEqual([
      ['halftone', 0.3],
      ['glitch', 0.9],
    ]);
  });
});
