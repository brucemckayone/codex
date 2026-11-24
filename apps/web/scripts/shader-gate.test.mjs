/**
 * Tests for the film passes' text checks (shader-gate.mjs; Codex-1yd58.7,
 * WP-6).
 *
 * node:test rather than vitest, as for the other scripts/ gates: the thing
 * under test is a plain `.mjs`. No glslang (the compile is shaders:check's),
 * so this runs anywhere: `pnpm --filter web run shaders:gate:test`, and a
 * self-test step in static_analysis.yml before the gate runs on the REAL
 * passes (`shaders:gate`).
 *
 * Every way a film pass could read a silent zero, draw as another pass, or
 * flash on the real clock is planted and must fire; a clean set must not.
 * The text helpers it uses (declaredUniforms, stripComments) are tested
 * where they live, glsl-source.test.mjs.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  filmGateProblems,
  filmPassProblems,
  flashClockProblems,
  MIN_FILM_PASSES,
} from './shader-gate.mjs';

/** The assembly's shape: the declarations generated from `uniforms`. */
const assemble = (pass) =>
  `#version 300 es\nprecision highp float;\n${pass.uniforms
    .map((u) => `uniform float ${u};`)
    .join('\n')}\n${pass.glsl}\n`;

const SETTABLE = ['u_scene', 'u_reveal', 'u_trail', 'u_flashTime', 'u_time'];
const HOOK = 'void reelPointer(inout Motion mo, vec2 uv) {}';
const effect = (id, glsl = HOOK, over = {}) => ({
  id,
  axis: 'reel-pointer',
  glsl,
  ...over,
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

  test('wants the whole cross product: 480 passes by default', () => {
    assert.equal(MIN_FILM_PASSES, 480);
    const found = filmPassProblems({
      passes: passes(479),
      assemble,
      settable: SETTABLE,
      effects: [],
    });
    assert.equal(found.length, 1);
    assert.match(
      found[0].message,
      /only 479 film pass\(es\), expected at least 480/
    );
    assert.deepEqual(
      filmPassProblems({
        passes: passes(480),
        assemble,
        settable: SETTABLE,
        effects: [],
      }),
      []
    );
  });

  test('fires on an effect whose hook declares a uniform of its own', () => {
    const found = problems({
      effects: [effect('smoke', `uniform highp float u_puff;\n${HOOK}`)],
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
          `/* uniform float u_old; */\n// uniform float u_older;\n${HOOK}`
        ),
      ],
    });
    assert.deepEqual(found, []);
  });

  test('fires on a pass that lists a uniform the compositor never sets', () => {
    const found = problems({
      passes: [
        pass('a'),
        pass('b', { uniforms: ['u_scene', 'u_wind'] }),
        pass('c'),
      ],
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
    for (const problem of found)
      assert.match(problem.message, /never sets: u_glow/);
  });

  test('fires on two passes with one id: the program cache would mix them', () => {
    const found = problems({ passes: [pass('a'), pass('b'), pass('a')] });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'film:a');
    assert.match(found[0].message, /shares its id/);
  });

  test('names each unset uniform once, however often it appears', () => {
    const found = problems({
      passes: [
        pass('a', { uniforms: ['u_wind', 'u_wind'] }),
        pass('b'),
        pass('c'),
      ],
    });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /never sets: u_wind$/m);
  });

  test('fires on a smoothstep whose literal edges fall (undefined in GLSL ES)', () => {
    const found = problems({
      passes: [
        pass('a'),
        pass('b', {
          glsl: 'void main() { float a = smoothstep(0.6, 0.0, 0.3); }',
        }),
        pass('c'),
      ],
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'film:b');
    assert.match(found[0].message, /smoothstep\(0\.6, 0\.0,/);
  });
});

describe('flashClockProblems', () => {
  const flashing = (glsl) => effect('glitch', glsl, { flashes: true });
  const hook = (body) =>
    `void reelPointer(inout Motion mo, vec2 uv) { ${body} }`;

  for (const [name, glsl] of [
    ['a read of the real clock', hook('float t = u_time;')],
    ['one inside an expression', hook('mo.glitch = fract(u_time*3.0);')],
    [
      'one after a commented line',
      `// steady\n${hook('float t = u_time + 1.0;')}`,
    ],
  ]) {
    test(`fires on ${name} in a flashing effect`, () => {
      const found = flashClockProblems([flashing(glsl)]);
      assert.equal(found.length, 1, glsl);
      assert.equal(found[0].name, 'film:reel-pointer:glitch');
      assert.match(found[0].message, /reads u_time/);
    });
  }

  for (const [name, item] of [
    ['the governed clock', flashing(hook('float t = u_flashTime;'))],
    [
      'u_time named only in comments',
      flashing(
        `// never u_time\n/* u_time */\n${hook('float t = u_flashTime;')}`
      ),
    ],
    ['a longer name that contains it', flashing(hook('float t = u_timeline;'))],
    [
      'an effect that does not flash',
      effect('smoke', hook('float t = u_time;')),
    ],
  ]) {
    test(`leaves alone ${name}`, () => {
      assert.deepEqual(flashClockProblems([item]), []);
    });
  }
});

describe('filmGateProblems', () => {
  test('runs the pass checks and the flash clock together', () => {
    const found = filmGateProblems({
      passes: [pass('a'), pass('a')],
      assemble,
      settable: SETTABLE,
      effects: [
        effect('glitch', 'void h() { float t = u_time; }', { flashes: true }),
      ],
      minPasses: 2,
    });
    assert.deepEqual(
      found.map((p) => p.name),
      ['film:a', 'film:reel-pointer:glitch']
    );
  });
});
