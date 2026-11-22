/**
 * The Showreel's motion effects. What `shaders:check` cannot see is pinned
 * here: the tables hold exactly the ids, each effect defines its own axis's
 * hook and lists exactly the uniforms it reads, an effect that flashes never
 * reads the real clock, and the fallbacks land where the plan says. That every
 * composed pass compiles is the gate's (scratch until the wiring registers
 * them).
 */
import { describe, expect, it } from 'vitest';
import { STILL_MOTION } from '../../__tests__/motion-fixtures';
import {
  assembleFilmPass,
  composeFilmPass,
  everyFilmPass,
} from '../effects/film-pass';
import {
  MOTION_GLSL,
  MOTION_GLSL_UNIFORMS,
  MOTION_HOOKS,
  type MotionEffect,
} from '../effects/motion';
import {
  INTO_IDS,
  OPENING_IDS,
  POINTER_IDS,
  TRANS_IDS,
} from '../effects/motion-ids';
import {
  INTOS,
  MOTION_EFFECTS,
  OPENINGS,
  POINTERS,
  planMotion,
  TRANS,
} from '../effects/motion-registry';
import {
  declareFilmPassUniforms,
  FILM_PASS_UNIFORMS,
  MOTION_UNIFORMS,
  restMotion,
  TRAIL_POINTS,
} from '../effects/motion-uniforms';

const TABLES = {
  'reel-trans': TRANS,
  'reel-pointer': POINTERS,
  'reel-opening': OPENINGS,
  'reel-film': INTOS,
} as const;

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
/** Every uniform name a GLSL text mentions. */
const readsOf = (glsl: string) =>
  new Set(stripComments(glsl).match(/\bu_[A-Za-z]+\b/g) ?? []);

const fallbackOf = (e: MotionEffect, kind: 'phone' | 'reduced') =>
  kind === 'phone' ? e.phoneFallback : e.reducedMotionFallback;

describe('motion effects', () => {
  it('hold exactly the ids the settings name, axis by axis', () => {
    expect(Object.keys(TRANS)).toEqual([...TRANS_IDS]);
    expect(Object.keys(POINTERS)).toEqual([...POINTER_IDS]);
    expect(Object.keys(OPENINGS)).toEqual([...OPENING_IDS]);
    expect(Object.keys(INTOS)).toEqual([...INTO_IDS]);
    expect(MOTION_EFFECTS).toHaveLength(
      TRANS_IDS.length +
        POINTER_IDS.length +
        OPENING_IDS.length +
        INTO_IDS.length
    );
  });

  it('files each effect under its own id and on its own axis', () => {
    for (const [axis, table] of Object.entries(TABLES)) {
      for (const [id, effect] of Object.entries(table)) {
        expect(effect.id).toBe(id);
        expect(effect.axis).toBe(axis);
      }
    }
  });

  it("defines its own axis's hook once, and no other axis's", () => {
    for (const effect of MOTION_EFFECTS) {
      const glsl = stripComments(effect.glsl);
      const own = `void ${MOTION_HOOKS[effect.axis]}(inout Motion mo, vec2 uv)`;
      expect(glsl.split(own), `${effect.axis}:${effect.id}`).toHaveLength(2);
      for (const hook of Object.values(MOTION_HOOKS)) {
        if (hook === MOTION_HOOKS[effect.axis]) continue;
        expect(glsl, `${effect.axis}:${effect.id}`).not.toMatch(
          new RegExp(`\\b${hook}\\b`)
        );
      }
    }
  });

  it('lists exactly the uniforms its own GLSL reads, each one settable', () => {
    for (const effect of MOTION_EFFECTS) {
      expect(
        [...readsOf(effect.glsl)].sort(),
        `${effect.axis}:${effect.id}`
      ).toEqual([...effect.uniforms].sort());
      for (const u of effect.uniforms) expect(FILM_PASS_UNIFORMS).toContain(u);
    }
    expect([...readsOf(MOTION_GLSL)].sort()).toEqual(
      [...MOTION_GLSL_UNIFORMS].sort()
    );
  });

  it('never gives the real clock to an effect that flashes (WCAG 2.3.1)', () => {
    const flashing = MOTION_EFFECTS.filter((e) => e.flashes);
    expect(flashing.map((e) => `${e.axis}:${e.id}`).sort()).toEqual([
      'reel-pointer:glitch',
      'reel-trans:glitch',
      'reel-trans:light-leak',
    ]);
    for (const effect of flashing)
      expect(effect.uniforms).not.toContain('u_time');
    // The only GLSL that reads the governed clock flashes, or is the shared
    // glitch it calls (`glitchedFilm`).
    for (const effect of MOTION_EFFECTS.filter((e) => !e.flashes))
      expect(effect.uniforms).not.toContain('u_flashTime');
    expect(stripComments(MOTION_GLSL)).not.toMatch(/\bu_time\b/);
  });

  it('falls back to an effect of its own axis, and stays there', () => {
    for (const effect of MOTION_EFFECTS) {
      const table: Record<string, MotionEffect> = TABLES[effect.axis];
      for (const kind of ['phone', 'reduced'] as const) {
        const next = table[fallbackOf(effect, kind)];
        expect(next, `${effect.axis}:${effect.id} ${kind}`).toBeDefined();
        expect(fallbackOf(next, kind)).toBe(next.id);
      }
    }
  });

  it('keeps every effect on a phone', () => {
    for (const effect of MOTION_EFFECTS)
      expect(effect.phoneFallback).toBe(effect.id);
  });

  it('under reduced motion: cuts fade, no opening, no glitch, no liquid, and the smoke still answers, static', () => {
    const reduced = (table: Record<string, MotionEffect>) =>
      Object.fromEntries(
        Object.values(table).map((e) => [e.id, e.reducedMotionFallback])
      );
    expect(reduced(TRANS)).toEqual({
      burn: 'fade',
      liquid: 'fade',
      glitch: 'fade',
      'light-leak': 'fade',
      fade: 'fade',
    });
    expect(reduced(POINTERS)).toEqual({
      // Its rings spread on after the pointer stops.
      liquid: 'none',
      smoke: 'smoke',
      glitch: 'none',
      none: 'none',
    });
    expect(reduced(OPENINGS)).toEqual({ name: 'none', none: 'none' });
    expect(reduced(INTOS)).toEqual({
      name: 'fade',
      smoke: 'fade',
      liquid: 'fade',
      fade: 'fade',
    });
  });

  it('marks exactly the effects that play the film through the name', () => {
    const named = MOTION_EFFECTS.filter((e) => e.throughName).map(
      (e) => `${e.axis}:${e.id}`
    );
    expect(named.sort()).toEqual(['reel-film:name', 'reel-opening:name']);
  });
});

describe('planMotion', () => {
  const choice = {
    trans: 'glitch',
    pointer: 'glitch',
    opening: 'name',
    into: 'name',
  } as const;
  const ids = (ctx: Parameters<typeof planMotion>[1]) => {
    const set = planMotion(choice, ctx);
    return [set.trans.id, set.pointer.id, set.opening.id, set.into.id];
  };
  const base = { phone: false, reducedMotion: false, hasMask: true };

  it('runs the choice as it is on a desktop with a name', () => {
    expect(ids(base)).toEqual(['glitch', 'glitch', 'name', 'name']);
  });

  it('runs the same on a phone', () => {
    expect(ids({ ...base, phone: true })).toEqual([
      'glitch',
      'glitch',
      'name',
      'name',
    ]);
  });

  it("runs each effect's reduced-motion fallback", () => {
    expect(ids({ ...base, reducedMotion: true })).toEqual([
      'fade',
      'none',
      'none',
      'fade',
    ]);
  });

  it('with no name to draw through: no opening, and the smoke into the film', () => {
    expect(ids({ ...base, hasMask: false })).toEqual([
      'glitch',
      'glitch',
      'none',
      'smoke',
    ]);
    expect(ids({ ...base, hasMask: false, reducedMotion: true })).toEqual([
      'fade',
      'none',
      'none',
      'fade',
    ]);
  });

  it('under reduced motion turns the liquid pointer off and keeps the smoke', () => {
    const reduced = { ...base, reducedMotion: true };
    const pointer = (id: 'liquid' | 'smoke') =>
      planMotion({ ...choice, pointer: id }, reduced).pointer.id;
    expect(pointer('liquid')).toBe('none');
    // The smoke stays: its trail is static under reduced motion (reel-trail).
    expect(pointer('smoke')).toBe('smoke');
    // Without reduced motion the liquid runs as chosen.
    expect(planMotion({ ...choice, pointer: 'liquid' }, base).pointer.id).toBe(
      'liquid'
    );
  });

  it('draws nothing moving for the still choice', () => {
    const set = planMotion(STILL_MOTION, base);
    expect(set.trans.id).toBe('fade');
    expect(set.pointer.id).toBe('none');
  });
});

describe('composeFilmPass', () => {
  const still = planMotion(STILL_MOTION, {
    phone: false,
    reducedMotion: false,
    hasMask: true,
  });

  it('gives every combination its own pass id (the pass cache key)', () => {
    const passes = everyFilmPass();
    expect(passes).toHaveLength(
      // fill, name and portrait
      3 *
        TRANS_IDS.length *
        POINTER_IDS.length *
        OPENING_IDS.length *
        INTO_IDS.length
    );
    expect(new Set(passes.map((p) => p.id)).size).toBe(passes.length);
  });

  it('declares every uniform its GLSL reads, and nothing it does not', () => {
    for (const pass of everyFilmPass()) {
      expect([...readsOf(pass.glsl)].sort(), pass.id).toEqual(
        [...new Set(pass.uniforms)].sort()
      );
    }
  });

  it("runs each of its effects' hooks, in one pass", () => {
    const pass = composeFilmPass('film-fill', {
      ...still,
      trans: TRANS.burn,
      pointer: POINTERS.smoke,
    });
    expect(pass.id).toBe('film-fill+burn+smoke+none+fade');
    expect(pass.glsl).toContain(TRANS.burn.glsl);
    expect(pass.glsl).toContain(POINTERS.smoke.glsl);
    expect(pass.glsl.match(/void main\(\)/g)).toHaveLength(1);
  });

  it('weighs the name on the Corner and Wide layouts only when an effect plays through it', () => {
    const plain = composeFilmPass('film-fill', still);
    const named = composeFilmPass('film-fill', {
      ...still,
      into: INTOS.name,
    });
    expect(plain.uniforms).not.toContain('u_nameWeight');
    expect(named.uniforms).toContain('u_nameWeight');
    expect(plain.glsl).not.toContain('nameStreak(v_uv)');
    expect(named.glsl).toContain('nameStreak(v_uv)');
    // The Name layout always draws through its letters, and can always dive.
    const window = composeFilmPass('film-name', still);
    expect(window.glsl).toContain('float frame = nameVeil(v_uv, mo.warp);');
    expect(window.glsl).toContain('nameStreak(v_uv)');
    expect(window.uniforms).not.toContain('u_nameWeight');
  });

  it('declares the trail as an array the gate can read', () => {
    const source = assembleFilmPass(
      composeFilmPass('film-fill', { ...still, pointer: POINTERS.liquid })
    );
    expect(source).toContain(`uniform vec4 u_trail[${TRAIL_POINTS}];`);
    expect(source.startsWith('#version 300 es')).toBe(true);
  });
});

describe('motion uniforms', () => {
  it('rests every value the table names, with an empty trail', () => {
    const rest = restMotion();
    // All but the governed clock, which the compositor steps itself.
    expect(Object.keys(rest).sort()).toEqual(
      Object.keys(MOTION_UNIFORMS)
        .filter((name) => name !== 'u_flashTime')
        .sort()
    );
    expect(rest.u_trail).toHaveLength(TRAIL_POINTS * 4);
    expect([...rest.u_trail].every((v) => v === 0)).toBe(true);
    expect(rest).toMatchObject({
      u_reveal: 1,
      u_nameZoom: 1,
      u_nameAlpha: 1,
      u_nameWeight: 0,
      u_dive: 0,
      u_into: 0,
      u_fill: 0,
      u_pointerOn: 0,
    });
  });

  it('hands each call a trail of its own', () => {
    expect(restMotion().u_trail).not.toBe(restMotion().u_trail);
  });

  it('declares scalars, vectors and the trail array', () => {
    expect(
      declareFilmPassUniforms(['u_reveal', 'u_nameCentre', 'u_trail'])
    ).toBe(`uniform float u_reveal;
uniform vec2 u_nameCentre;
uniform vec4 u_trail[${TRAIL_POINTS}];`);
  });

  it('sets no motion uniform the compositor already names', () => {
    const own = Object.keys(MOTION_UNIFORMS);
    expect(new Set(FILM_PASS_UNIFORMS).size).toBe(FILM_PASS_UNIFORMS.length);
    for (const name of own) expect(FILM_PASS_UNIFORMS).toContain(name);
  });
});
