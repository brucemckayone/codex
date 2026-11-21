/**
 * Self-test for the shader gate's text checks (glsl-source.mjs; Codex-1yd58
 * WP-11): every planted smoothstep with literal edges that do not rise is
 * caught, rising and expression edges are left alone, and a commented-out
 * call is not code.
 *
 *   node --test apps/web/scripts/glsl-source.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { reversedSmoothsteps, stripComments } from './glsl-source.mjs';

const glsl = (body) =>
  `#version 300 es\nprecision highp float;\nvoid main() {\n${body}\n}\n`;

describe('reversedSmoothsteps catches', () => {
  for (const [name, call] of [
    ['a falling pair', 'float a = smoothstep(0.5, 0.0, d);'],
    ['equal edges', 'float a = smoothstep(0.5, 0.5, d);'],
    ['signed and short literals', 'float a = smoothstep(.5, -1., d);'],
    ['exponents', 'float a = smoothstep(1e-2, 1e-3, d);'],
    ['odd spacing', 'float a = smoothstep( 0.8 ,0.0 , d);'],
    ['inside a product', 'float a = u * smoothstep(0.4, 0.0, d) * 0.12;'],
  ]) {
    test(name, () => {
      assert.equal(reversedSmoothsteps(glsl(call)).length, 1, call);
    });
  }

  // The six the WP-11 pass fixed, as they were (ether, film x2, lava x2,
  // pulse-sim): the gate now runs on every preset source, so each would fail.
  test('the six pre-WP-11 preset lines', () => {
    const lines = [
      'float spotlight = smoothstep(1.2, 0.0, mouseDist) * 0.12;',
      'float w = u_ripple * smoothstep(0.5, 0.0, mouseDist) * 0.15;',
      'float b = u_burstStrength * smoothstep(0.8, 0.0, mouseDist) * 0.25;',
      'float mi = u_mouseActive * smoothstep(0.4, 0.0, mouseDist);',
      'float em = burstInfluence * smoothstep(0.5, 0.0, mouseDist);',
      'float ring = smoothstep(0.25, 0.15, dist) * smoothstep(0.0, 0.1, dist);',
    ];
    assert.equal(reversedSmoothsteps(glsl(lines.join('\n'))).length, 6);
  });
});

describe('reversedSmoothsteps leaves alone', () => {
  for (const [name, call] of [
    ['a rising pair', 'float a = smoothstep(0.0, 0.5, d);'],
    [
      'the falling edge written right',
      'float a = 1.0 - smoothstep(0.0, 0.5, d);',
    ],
    ['expression edges', 'float a = smoothstep(lo, hi, d);'],
    ['a literal and an expression', 'float a = smoothstep(0.5 - w, 0.5, p);'],
    ['a line comment', '// float a = smoothstep(0.5, 0.0, d);'],
    ['a block comment', '/* smoothstep(0.5, 0.0, d) */ float a = 1.0;'],
    ['another function', 'float a = mysmoothstep(0.5, 0.0, d);'],
  ]) {
    test(name, () => {
      assert.deepEqual(reversedSmoothsteps(glsl(call)), [], call);
    });
  }
});

describe('stripComments', () => {
  test('keeps a URL and the character before a trailing comment', () => {
    assert.equal(
      stripComments('const u = "https://x"; // note\nf(); /* b */ g();'),
      'const u = "https://x"; \nf();   g();'
    );
  });
});
