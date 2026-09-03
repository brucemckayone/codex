/**
 * GLSL compile gate for the ShaderHero presets.
 *
 * Imports every `*.frag.ts` / `*.vert.ts` shader-source module, resolves the
 * exported template literal (so shared chunks like `AUDIO_UNIFORMS` and
 * `MOTION_HELPERS` are interpolated exactly as at runtime), and runs each
 * result through `glslangValidator`.
 *
 * ## Why this exists
 *
 * A GLSL syntax error is invisible to `tsc`, `biome`, `svelte-check` and the
 * unit tests: the shader is just a string until `createProgram` compiles it in
 * a browser, where the failure surfaces as a silent black canvas. Nothing in
 * the existing gate can catch it. With shared GLSL chunks the blast radius is
 * worse — one bad line in `audio-glsl.ts` breaks every preset at once.
 *
 * ## Usage
 *
 *   node apps/web/scripts/validate-shaders.mjs            # all shaders
 *   node apps/web/scripts/validate-shaders.mjs vapor ink  # only these
 *
 * Exit code 0 means every shader compiled. Non-zero prints the offending
 * shader, the glslang diagnostic, and the source line it points at.
 *
 * Requires `glslangValidator` on PATH (`brew install glslang`).
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHADER_DIR = path.resolve(HERE, '../src/lib/components/ui/ShaderHero/shaders');

/**
 * esbuild is not a direct dependency of `apps/web` — it arrives transitively
 * through Vite. Resolving it via Vite's own require path avoids adding a
 * devDependency (and so avoids touching package.json / the lockfile) while
 * still using the exact esbuild the app builds with.
 */
async function loadEsbuild() {
  const req = createRequire(path.join(HERE, '../package.json'));
  const candidates = ['esbuild', 'vite'];
  for (const from of candidates) {
    try {
      const base =
        from === 'esbuild' ? req.resolve('esbuild') : req.resolve('vite');
      const inner = createRequire(base);
      return await import(`file://${inner.resolve('esbuild')}`);
    } catch {
      // Try the next resolution root.
    }
  }
  throw new Error(
    'Could not resolve esbuild (tried apps/web and via vite). Run `pnpm install`.'
  );
}

/**
 * `#version 300 es` shaders are ESSL3. glslang needs to be told the stage; it
 * infers the ES profile from the version directive itself.
 */
const STAGE_FOR_EXT = { frag: 'frag', vert: 'vert' };

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

/** Print the source with line numbers around a glslang-reported line. */
function context(source, lineNo, radius = 4) {
  const lines = source.split('\n');
  const from = Math.max(0, lineNo - radius - 1);
  const to = Math.min(lines.length, lineNo + radius);
  return lines
    .slice(from, to)
    .map((l, i) => {
      const n = from + i + 1;
      return `${n === lineNo ? '>>' : '  '} ${String(n).padStart(4)} | ${l}`;
    })
    .join('\n');
}

/** Extract the first line number glslang complains about, if any. */
function firstErrorLine(diagnostic) {
  const m = diagnostic.match(/ERROR: \d+:(\d+):/);
  return m ? Number(m[1]) : null;
}

const RENDERER_DIR = path.resolve(
  HERE,
  '../src/lib/components/ui/ShaderHero/renderers'
);

/**
 * Uniforms every renderer gets through the shared helpers rather than by
 * naming them. A renderer that spreads `AUDIO_UNIFORM_NAMES` and calls
 * `uploadAudioUniforms` covers all of these at once.
 */
const AUDIO_UNIFORMS = new Set([
  'u_audioActive',
  'u_bass',
  'u_mids',
  'u_treble',
  'u_level',
  'u_beatPulse',
  'u_energy',
  'u_flux',
  'u_centroid',
  'u_beatPhase',
  'u_beatSeed',
]);

/**
 * Uniforms GLSL itself provides or that the vertex stage owns — never uploaded
 * by a renderer, so their absence is not a defect.
 */
const IGNORED_UNIFORMS = new Set(['gl_DepthRange']);

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
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Check that every uniform a shader DECLARES is actually reachable from its
 * renderer.
 *
 * ## Why this is a separate check from compilation
 *
 * A uniform that is declared and read by the shader but never uploaded is
 * perfectly legal GLSL: it silently reads zero. So the compile gate passes,
 * `tsc` passes, `biome` passes, `svelte-check` passes, and the unit tests pass
 * — while the feature does nothing at all.
 *
 * This is not hypothetical. A subagent was killed mid-task by a spend limit
 * after rewriting `life-sim.frag.ts` and `life-display.frag.ts` to consume the
 * shared audio block, but before wiring `life-renderer.ts` to upload it. Every
 * gate in the repo was green and the preset's entire audio response was dead.
 * A cap kill leaves files that compile but are semantically incomplete, which
 * is exactly the case a type system cannot see.
 *
 * The check is deliberately textual and one-directional: it asks only whether
 * the renderer MENTIONS each declared uniform name. That catches the "never
 * wired at all" case, which is the one that actually happens, without trying
 * to prove a particular `gl.uniform*` call is reached at runtime.
 */
function checkUniformCoverage(preset, sources) {
  const rendererPath = path.join(RENDERER_DIR, `${preset}-renderer.ts`);
  let renderer;
  try {
    renderer = readFileSync(rendererPath, 'utf8');
  } catch (err) {
    // ONLY a genuinely absent renderer is a skip. Not every shader module maps
    // to a preset renderer (jfa-*, the shared vertex shader), and those are
    // reported as skipped rather than clean — counting an unchecked preset as
    // passing is how a coverage number stops meaning anything.
    //
    // Anything else rethrows. A bare `catch {}` here already bit once: with
    // `readFileSync` missing from the imports, every call threw ReferenceError,
    // was swallowed as "no renderer", and the gate printed a tick having
    // checked nothing at all.
    if (err.code !== 'ENOENT') throw err;
    return { skipped: true };
  }

  const code = stripComments(renderer);

  const wiresAudioBlock =
    code.includes('AUDIO_UNIFORM_NAMES') &&
    code.includes('uploadAudioUniforms');

  // The DECLARED side needs the same comment strip as the renderer side, for
  // the mirror-image reason. `^\s*uniform` anchors to the start of a line, so
  // a line-commented declaration is safely skipped — but a BLOCK-commented one
  // written across several lines puts a bare `uniform float u_x;` at the start
  // of its own line, which matches. That would report a uniform nobody
  // declares as unwired: a false positive rather than a miss, so it fails
  // noisily rather than silently, but it is still wrong.
  const declared = new Set();
  for (const source of sources) {
    for (const m of stripComments(source).matchAll(
      /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)/gm
    )) {
      declared.add(m[1]);
    }
  }

  const unwired = [];
  for (const name of declared) {
    if (IGNORED_UNIFORMS.has(name)) continue;
    // An audio uniform is wired either through the shared helper OR by being
    // named directly. Several presets (ether, ink, pulse, ripple, suture)
    // predate the shared block and hand-roll their own list — those are wired,
    // just not via the helper, and reporting them is a false positive.
    if (AUDIO_UNIFORMS.has(name)) {
      if (!wiresAudioBlock && !code.includes(name)) {
        unwired.push(`${name} (shared audio block)`);
      }
      continue;
    }
    if (!code.includes(name)) unwired.push(name);
  }

  return unwired.length > 0 ? { rendererPath, unwired, wiresAudioBlock } : null;
}

async function main() {
  const filter = process.argv.slice(2);
  const esbuild = await loadEsbuild();

  let files = readdirSync(SHADER_DIR)
    .filter((f) => f.endsWith('.frag.ts') || f.endsWith('.vert.ts'))
    .sort();

  if (filter.length > 0) {
    files = files.filter((f) => filter.some((needle) => f.includes(needle)));
    if (files.length === 0) {
      fail(`No shader files matched: ${filter.join(', ')}`);
      return;
    }
  }

  const work = mkdtempSync(path.join(tmpdir(), 'glsl-gate-'));
  let checked = 0;
  const failures = [];
  /** preset name → every GLSL source belonging to it, for the coverage check. */
  const sourcesByPreset = new Map();

  /**
   * Map a shader filename to its preset. `life-sim.frag.ts` and
   * `life-display.frag.ts` both belong to `life`, whose single renderer
   * uploads for both passes.
   */
  const presetOf = (file) =>
    file
      .replace(/\.(frag|vert)\.ts$/, '')
      .replace(/-(sim|display)$/, '');

  try {
    for (const file of files) {
      const modPath = path.join(SHADER_DIR, file);
      let mod;
      try {
        // Bundle rather than import directly. The shader modules import shared
        // GLSL chunks with extensionless TypeScript specifiers ('../audio-glsl')
        // which Vite resolves but Node's ESM loader will not. esbuild resolves
        // them the same way the app build does, so what we validate is exactly
        // the string the browser receives.
        const bundled = path.join(work, `${file}.mjs`);
        await esbuild.build({
          entryPoints: [modPath],
          outfile: bundled,
          bundle: true,
          format: 'esm',
          platform: 'neutral',
          logLevel: 'silent',
        });
        mod = await import(`file://${bundled}`);
      } catch (err) {
        failures.push(file);
        fail(`\n✖ ${file}\n  could not bundle/import: ${err.message}`);
        continue;
      }

      // A shader module may export more than one source string (some export a
      // shared prelude alongside the shader). Validate every string export
      // that carries a #version directive — that is what makes it a shader.
      const sources = Object.entries(mod).filter(
        ([, v]) => typeof v === 'string' && v.includes('#version')
      );

      if (sources.length === 0) {
        failures.push(file);
        fail(`\n✖ ${file}\n  exports no string containing "#version"`);
        continue;
      }

      const preset = presetOf(file);
      const bucket = sourcesByPreset.get(preset) ?? [];
      bucket.push(...sources.map(([, src]) => src));
      sourcesByPreset.set(preset, bucket);

      const ext = file.endsWith('.vert.ts') ? 'vert' : 'frag';
      const stage = STAGE_FOR_EXT[ext];

      for (const [exportName, source] of sources) {
        const scratch = path.join(work, `${file}.${exportName}.${ext}`);
        writeFileSync(scratch, source, 'utf8');
        checked++;

        try {
          execFileSync('glslangValidator', ['-S', stage, scratch], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (err) {
          const diagnostic = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
          failures.push(`${file}:${exportName}`);
          fail(`\n✖ ${file} → ${exportName}\n${diagnostic}`);
          const line = firstErrorLine(diagnostic);
          if (line) fail(context(source, line));
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    fail(
      `\n${failures.length} of ${checked} shader sources FAILED to compile:\n  ${failures.join('\n  ')}`
    );
  } else {
    console.log(
      `✓ ${checked} shader sources compiled (${files.length} modules)`
    );
  }

  // ── Uniform coverage ────────────────────────────────────────────────
  // Runs even when compilation failed, since the two answer different
  // questions and a reader wants both.
  const unwiredPresets = [];
  const skipped = [];
  let covered = 0;
  for (const [preset, sources] of sourcesByPreset) {
    const result = checkUniformCoverage(preset, sources);
    if (result === null) {
      covered++;
      continue;
    }
    if (result.skipped) {
      skipped.push(preset);
      continue;
    }
    unwiredPresets.push(preset);
    fail(
      `\n✖ ${preset}: shader declares uniforms its renderer never uploads` +
        `\n  renderer: ${path.relative(process.cwd(), result.rendererPath)}` +
        `\n  unwired:  ${result.unwired.join(', ')}` +
        (result.wiresAudioBlock
          ? ''
          : '\n  hint:     spread ...AUDIO_UNIFORM_NAMES into UNIFORM_NAMES and' +
            '\n            call uploadAudioUniforms(gl, uniforms, a) after useProgram') +
        '\n  These read 0 at runtime. Legal GLSL, so nothing else catches it.'
    );
  }

  if (unwiredPresets.length > 0) {
    fail(
      `\n${unwiredPresets.length} preset(s) have unwired uniforms: ${unwiredPresets.join(', ')}`
    );
  } else {
    const note =
      skipped.length > 0
        ? ` (${skipped.length} skipped, no preset renderer: ${skipped.join(', ')})`
        : '';
    console.log(
      `✓ ${covered} presets have every declared uniform wired${note}`
    );
  }
}

await main();
