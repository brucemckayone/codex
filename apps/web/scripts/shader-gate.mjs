/**
 * The textual checks of `shaders:check` (validate-shaders.mjs), apart from
 * its CLI so node:test can plant bad sources in them without glslang
 * (`shader-gate.test.mjs`). The compile itself stays in validate-shaders.
 *
 * `filmPassProblems` is the Showreel's half (Codex-1yd58.7, WP-6): the film
 * frames composed with every motion effect, the passes the compositor can
 * draw (`everyFilmPass`).
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

/**
 * Every uniform a GLSL source declares (comments stripped first). An array
 * (`uniform vec4 u_trail[24];`) is its name.
 */
export function declaredUniforms(source) {
  return [
    ...stripComments(source).matchAll(
      /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)/gm
    ),
  ].map((m) => m[1]);
}

/**
 * The Showreel draws 2 film frames × 5 transitions × 4 pointers × 2 openings
 * × 4 ways into the film. Fewer means the motion registry moved or emptied.
 */
export const MIN_FILM_PASSES = 320;

/**
 * What is wrong with the Showreel's film passes, the compile aside. Each
 * problem is `{ name, message }`; none means the passes may be compiled.
 *
 * A pass reads a uniform nobody sets, and gets a silent zero, three ways:
 * an effect's hook declares one itself (the declarations are generated from
 * its `uniforms`); the pass lists or declares a name outside `settable`,
 * the names the compositor gives a value (`FILM_PASS_UNIFORMS`, which
 * `filmPassValues` covers); and two passes share an id, so the compositor's
 * program cache draws one as the other.
 *
 * @param {object} gate
 * @param {readonly {id: string, uniforms: readonly string[], glsl: string}[]} gate.passes
 *   `everyFilmPass()`.
 * @param {(pass: object) => string} gate.assemble `assembleFilmPass`.
 * @param {readonly string[]} gate.settable `FILM_PASS_UNIFORMS`.
 * @param {readonly {id: string, axis: string, glsl: string}[]} gate.effects
 *   `MOTION_EFFECTS`.
 * @param {number} [gate.minPasses]
 * @returns {{name: string, message: string}[]}
 */
export function filmPassProblems({
  passes,
  assemble,
  settable,
  effects,
  minPasses = MIN_FILM_PASSES,
}) {
  const problems = [];
  if (passes.length < minPasses) {
    problems.push({
      name: 'film passes',
      message: `only ${passes.length} film pass(es), expected at least ${minPasses}: the motion registry moved or emptied`,
    });
  }
  for (const effect of effects) {
    const own = declaredUniforms(effect.glsl);
    if (own.length > 0) {
      problems.push({
        name: `film:${effect.axis}:${effect.id}`,
        message:
          `its glsl declares uniform(s) of its own: ${own.join(', ')}` +
          "\n  List them in the effect's `uniforms`; the pass's declarations are generated from it.",
      });
    }
  }
  const sets = new Set(settable);
  const seen = new Set();
  for (const pass of passes) {
    const name = `film:${pass.id}`;
    if (seen.has(pass.id)) {
      problems.push({
        name,
        message:
          'shares its id with another pass: the compositor caches its programs by id, so one would draw as the other',
      });
    }
    seen.add(pass.id);
    const unset = [
      ...new Set([...declaredUniforms(assemble(pass)), ...pass.uniforms]),
    ].filter((u) => !sets.has(u));
    if (unset.length > 0) {
      problems.push({
        name,
        message:
          `reads uniform(s) the compositor never sets: ${unset.join(', ')}` +
          '\n  Add them to MOTION_UNIFORMS (compositor/effects/motion-uniforms.ts) and give them a value in filmPassValues (compositor/film-pass-values.ts).',
      });
    }
  }
  return problems;
}
