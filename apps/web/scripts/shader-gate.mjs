/**
 * The Showreel's film passes, checked as text (Codex-1yd58.7, WP-6): each
 * film frame composed with every motion effect (`everyFilmPass`), the
 * passes the compositor can draw.
 *
 *   node apps/web/scripts/shader-gate.mjs   # the REAL passes, no glslang
 *
 * Run as a script it bundles the real registry with esbuild and runs every
 * check here on it, with no glslang, so CI runs it (static_analysis.yml).
 * shaders:check (validate-shaders.mjs) runs the same checks, then compiles
 * each pass with glslang, which only a machine with glslang can. The pure
 * checks are self-tested with planted passes in `shader-gate.test.mjs`.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredUniforms,
  reversedSmoothsteps,
  stripComments,
} from './glsl-source.mjs';
import { loadEsbuild } from './load-esbuild.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EFFECTS_DIR = path.resolve(
  HERE,
  '../src/lib/components/ui/ShaderHero/compositor/effects'
);

/**
 * The Showreel draws 3 film frames (fill, name, and WP-5b's portrait) × 5
 * transitions × 4 pointers × 2 openings × 4 ways into the film. Fewer means
 * the motion registry moved or emptied.
 */
export const MIN_FILM_PASSES = 480;

/**
 * What is wrong with the Showreel's film passes, the compile aside. Each
 * problem is `{ name, message }`; none means the passes may be compiled.
 *
 * A pass reads a uniform nobody sets, and gets a silent zero, three ways:
 * an effect's hook declares one itself (the declarations are generated from
 * its `uniforms`); the pass lists or declares a name outside `settable`,
 * the names the compositor gives a value (`FILM_PASS_UNIFORMS`, which
 * `filmPassValues` covers); and two passes share an id, so the compositor's
 * program cache draws one as the other. A smoothstep with literal edges
 * that do not rise is undefined in GLSL ES (`reversedSmoothsteps`).
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
    const source = assemble(pass);
    const unset = [
      ...new Set([...declaredUniforms(source), ...pass.uniforms]),
    ].filter((u) => !sets.has(u));
    if (unset.length > 0) {
      problems.push({
        name,
        message:
          `reads uniform(s) the compositor never sets: ${unset.join(', ')}` +
          '\n  Add them to MOTION_UNIFORMS (compositor/effects/motion-uniforms.ts) and give them a value in filmPassValues (compositor/film-pass-values.ts).',
      });
    }
    const reversed = reversedSmoothsteps(source);
    if (reversed.length > 0) {
      problems.push({
        name,
        message: `smoothstep with literal edges not rising (undefined in GLSL ES 3.00): ${reversed.join(', ')}`,
      });
    }
  }
  return problems;
}

const REAL_TIME = /\bu_time\b/;

/**
 * Each motion effect that flashes (`flashes: true`) but reads the real
 * clock. A flashing effect may change the picture's brightness only with
 * the governed clock, `u_flashTime` (3 changes a second, WCAG 2.3.1); its
 * GLSL must never name `u_time` (comments stripped first, so a note about
 * it is no read). A layer's `u_time` is governed for it, so this is the
 * motion effects' rule alone.
 *
 * @param {readonly {id: string, axis: string, glsl: string, flashes?: boolean}[]} effects
 *   `MOTION_EFFECTS`.
 * @returns {{name: string, message: string}[]}
 */
export function flashClockProblems(effects) {
  return effects
    .filter(
      (effect) =>
        effect.flashes === true && REAL_TIME.test(stripComments(effect.glsl))
    )
    .map((effect) => ({
      name: `film:${effect.axis}:${effect.id}`,
      message:
        'flashes but reads u_time, the real clock' +
        '\n  Read u_flashTime (the flash governor steps it to 3 changes a second, WCAG 2.3.1).',
    }));
}

/** Every text check on a set of film passes (`bundleFilmPasses`). */
export function filmGateProblems(film) {
  return [...filmPassProblems(film), ...flashClockProblems(film.effects)];
}

/**
 * The real film passes and what they are checked against, bundled from the
 * registry through a stdin entry that re-exports the four names from their
 * own modules (so no module exports them for this alone). `work` is a
 * scratch directory the caller removes.
 */
export async function bundleFilmPasses(esbuild, work) {
  const bundled = path.join(work, 'film-passes.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        "export { assembleFilmPass, everyFilmPass } from './film-pass';",
        "export { MOTION_EFFECTS } from './motion-registry';",
        "export { FILM_PASS_UNIFORMS } from './motion-uniforms';",
      ].join('\n'),
      resolveDir: EFFECTS_DIR,
      sourcefile: 'film-passes-entry.ts',
      loader: 'ts',
    },
    outfile: bundled,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const mod = await import(`file://${bundled}`);
  const {
    assembleFilmPass,
    everyFilmPass,
    MOTION_EFFECTS,
    FILM_PASS_UNIFORMS,
  } = mod;
  if (
    typeof assembleFilmPass !== 'function' ||
    typeof everyFilmPass !== 'function' ||
    !Array.isArray(MOTION_EFFECTS) ||
    !Array.isArray(FILM_PASS_UNIFORMS)
  ) {
    throw new Error(
      'exports no assembleFilmPass / everyFilmPass / MOTION_EFFECTS / FILM_PASS_UNIFORMS'
    );
  }
  return {
    passes: everyFilmPass(),
    assemble: assembleFilmPass,
    settable: FILM_PASS_UNIFORMS,
    effects: MOTION_EFFECTS,
  };
}

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), 'film-gate-'));
  try {
    let film;
    try {
      film = await bundleFilmPasses(await loadEsbuild(), work);
    } catch (err) {
      console.error(
        `\n✖ film passes\n  could not bundle/import: ${err.message}`
      );
      process.exitCode = 1;
      return;
    }
    const problems = filmGateProblems(film);
    for (const { name, message } of problems)
      console.error(`\n✖ ${name}: ${message}`);
    if (problems.length > 0) {
      process.exitCode = 1;
      return;
    }
    console.log(
      `✓ ${film.passes.length} Showreel film passes: ids apart, every uniform set, flashing effects on the governed clock (not compiled: shaders:check does that)`
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Run as a script, not imported: argv[1] through symlinks, as the other gates. */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMain()) await main();
