/**
 * GLSL source helpers shared by the shader gate (validate-shaders.mjs) and
 * its self-test (glsl-source.test.mjs). Pure text: no glslang, no browser.
 * Moved out of validate-shaders.mjs (Codex-1yd58 WP-11) so the smoothstep
 * check can be tested without running the gate.
 */

/**
 * Remove comments from TS or GLSL source before any textual presence test.
 *
 * Both directions of the coverage check need this, and both were wrong before
 * it existed:
 *  - the RENDERER side counted a uniform named in a comment as wired,
 *    including a commented-OUT upload call — the likeliest way real wiring
 *    gets disabled, so the check was blind to its own worst case;
 *  - the SHADER side counted a block-commented declaration as declared,
 *    because `^\s*uniform` matches the inner line of a `/* ... *\/` block.
 *
 * Block comments go FIRST: a `//` inside a block comment must not be treated
 * as a line comment and truncate the strip early.
 *
 * The `[^:]` guard on the line-comment pattern keeps `https://` intact, and
 * replacing with `$1` rather than `''` preserves the character before the
 * `//` — otherwise a trailing comment eats the `;` or `}` that precedes it,
 * which would break any assertion matching a statement terminator.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A GLSL float literal, signed: `0.95`, `.5`, `1.`, `-2`, `1e-3`. */
const GLSL_NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LITERAL_SMOOTHSTEP = new RegExp(
  String.raw`\bsmoothstep\s*\(\s*(${GLSL_NUMBER})\s*,\s*(${GLSL_NUMBER})\s*,`,
  'g'
);

/**
 * Each `smoothstep` whose two edges are literals and not rising (edge0 >=
 * edge1). GLSL ES 3.00 §8.3 leaves the result UNDEFINED for those: glslang
 * compiles it and a desktop driver happens to mirror the curve, but another
 * may return 0 or garbage (WP-8 review M1: the lab's light leak). Edges that
 * are expressions cannot be judged here and are left alone.
 */
export function reversedSmoothsteps(source) {
  return [...stripComments(source).matchAll(LITERAL_SMOOTHSTEP)]
    .filter(([, lo, hi]) => Number.parseFloat(lo) >= Number.parseFloat(hi))
    .map(([call]) => `${call}…)`);
}
