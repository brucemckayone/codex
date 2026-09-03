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
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    console.log(`✓ ${checked} shader sources compiled (${files.length} modules)`);
  }
}

await main();
