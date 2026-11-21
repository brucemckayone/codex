/**
 * Tests for shaders:check's textual checks (shader-gate.mjs), above all the
 * Showreel's film passes (Codex-1yd58.7, WP-6).
 *
 * node:test rather than vitest, as for the other scripts/ gates: the thing
 * under test is a plain `.mjs`. No glslang: the compile is validate-shaders'
 * own, so this runs anywhere (`pnpm --filter web run shaders:gate:test`, and
 * a self-test step in static_analysis.yml).
 *
 * Every way a film pass could read a silent zero is planted and must fire;
 * a clean set of passes must not.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  declaredUniforms,
  filmPassProblems,
  MIN_FILM_PASSES,
  stripComments,
} from './shader-gate.mjs';

/** The assembly's shape: the declarations generated from `uniforms`. */
const assemble = (pass) =>
  `#version 300 es\nprecision highp float;\n${pass.uniforms
    .map((u) => `uniform float ${u};`)
    .join('\n')}\n${pass.glsl}\n`;

const SETTABLE = ['u_scene', 'u_reveal', 'u_trail', 'u_flashTime'];
const effect = (id, glsl = 'void reelPointer(inout Motion mo, vec2 uv) {}') => ({
  id,
  axis: 'reel-pointer',
  glsl,
});
const pass = (id, over = {}) => ({
  id,
  uniforms: ['u_scene', 'u_reveal'],
  glsl: 'void main() {}',
  ...over,
});
/** `n` clean passes, ids apart. */
const passes = (n) => Array.from({ length: n }, (_, i) => pass(`p${i}`));

const problems = (over = {}) =>
  filmPassProblems({
    passes: passes(3),
    assemble,
    settable: SETTABLE,
    effects: [effect('smoke')],
    minPasses: 3,
    ...over,
  });

describe('filmPassProblems', () => {
  test('passes a clean set', () => {
    assert.deepEqual(problems(), []);
  });

  test('wants the whole cross product: 320 passes by default', () => {
    assert.equal(MIN_FILM_PASSES, 320);
    const found = filmPassProblems({
      passes: passes(319),
      assemble,
      settable: SETTABLE,
      effects: [],
    });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /only 319 film pass\(es\), expected at least 320/);
    assert.deepEqual(
      filmPassProblems({
        passes: passes(320),
        assemble,
        settable: SETTABLE,
        effects: [],
      }),
      []
    );
  });

  test('fires on an effect whose hook declares a uniform of its own', () => {
    const found = problems({
      effects: [
        effect(
          'smoke',
          'uniform highp float u_puff;\nvoid reelPointer(inout Motion mo, vec2 uv) {}'
        ),
      ],
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'film:reel-pointer:smoke');
    assert.match(found[0].message, /declares uniform\(s\) of its own: u_puff/);
  });

  test('a declaration commented out is no declaration', () => {
    const found = problems({
      effects: [
        effect(
          'smoke',
          '/* uniform float u_old; */\n// uniform float u_older;\nvoid reelPointer(inout Motion mo, vec2 uv) {}'
        ),
      ],
    });
    assert.deepEqual(found, []);
  });

  test('fires on a pass that lists a uniform the compositor never sets', () => {
    const found = problems({
      passes: [pass('a'), pass('b', { uniforms: ['u_scene', 'u_wind'] }), pass('c')],
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'film:b');
    assert.match(found[0].message, /never sets: u_wind/);
  });

  test('fires on a declaration the assembly adds outside the list', () => {
    const found = problems({
      assemble: (p) => `${assemble(p)}uniform vec4 u_glow[4];\n`,
    });
    // Every pass: the assembly is shared.
    assert.equal(found.length, 3);
    for (const problem of found) assert.match(problem.message, /never sets: u_glow/);
  });

  test('fires on two passes with one id: the program cache would mix them', () => {
    const found = problems({ passes: [pass('a'), pass('b'), pass('a')] });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'film:a');
    assert.match(found[0].message, /shares its id/);
  });

  test('names each unset uniform once, however often it appears', () => {
    const found = problems({
      passes: [pass('a', { uniforms: ['u_wind', 'u_wind'] }), pass('b'), pass('c')],
    });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /never sets: u_wind$/m);
  });
});

describe('declaredUniforms', () => {
  test('reads plain, qualified and array declarations', () => {
    assert.deepEqual(
      declaredUniforms(
        'uniform float u_a;\n  uniform highp vec2 u_b;\nuniform vec4 u_trail[24];\nuniform sampler2D u_scene;'
      ),
      ['u_a', 'u_b', 'u_trail', 'u_scene']
    );
  });

  test('skips commented declarations', () => {
    assert.deepEqual(
      declaredUniforms('// uniform float u_a;\n/*\nuniform float u_b;\n*/\nuniform float u_c;'),
      ['u_c']
    );
  });
});

describe('stripComments', () => {
  test('keeps a URL and the character before a trailing comment', () => {
    assert.equal(
      stripComments('const a = "https://x"; // why\nb(); /* c */ d();'),
      'const a = "https://x"; \nb();   d();'
    );
  });
});
