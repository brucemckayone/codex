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
 *   node apps/web/scripts/validate-shaders.mjs flow ink  # only these
 *   node apps/web/scripts/validate-shaders.mjs compositor # only the
 *                                     # compositor's passes (Codex-1yd58.4)
 *                                     # and the Showreel's film passes,
 *                                     # every motion composed (Codex-1yd58.7)
 *
 * Exit code 0 means every shader compiled. Non-zero prints the offending
 * shader, the glslang diagnostic, and the source line it points at.
 *
 * Requires `glslangValidator` on PATH (`brew install glslang`; in CI,
 * `apt-get install glslang-tools`), and for the compositor's layers a
 * Chromium to RUN them in: `SHADERS_CHROME` (a path), else Playwright's
 * Chromium, else the system Chrome. Each must draw its input unchanged at
 * amount 0. With no browser it is skipped, loudly, except under `CI=true`,
 * where it fails.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredUniforms,
  reversedSmoothsteps,
  stripComments,
  uniformDeclarations,
} from './glsl-source.mjs';
import { loadEsbuild } from './load-esbuild.mjs';
import { bundleFilmPasses, filmGateProblems } from './shader-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHADER_DIR = path.resolve(
  HERE,
  '../src/lib/components/ui/ShaderHero/shaders'
);

// `loadEsbuild` lives in load-esbuild.mjs, shared with shader-gate.mjs.

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
 * Explain a bundle failure in terms of the cause, not the symptom.
 *
 * GLSL lives inside a TypeScript template literal, so two characters that are
 * ordinary in a shader comment are structural in TS:
 *
 *   `  terminates the template literal
 *   ${ starts an interpolation
 *
 * Either produces an esbuild parse error at a line that is often nowhere near
 * the real problem — `Expected ";" but found "elevation"` for a stray backtick
 * eight lines earlier. That misdirection has cost time three separate times
 * during this work, so the gate now points at the actual cause.
 */
function diagnoseBundleFailure(modPath, message) {
  if (!/Expected|Unexpected|Unterminated/.test(message)) return '';

  const src = readFileSync(modPath, 'utf8');
  const lines = src.split('\n');
  const templateStart = lines.findIndex((l) => /^export const \w+ = `/.test(l));
  if (templateStart < 0) return '';

  const suspects = [];
  for (let i = templateStart + 1; i < lines.length - 1; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('`')) continue; // the closing delimiter
    if (line.includes('`')) suspects.push([i + 1, 'unescaped backtick', line]);
    // ${ is legitimate for the shared chunks; flag it only inside a comment.
    if (/^\s*(\/\/|\*|\/\*).*\$\{/.test(line)) {
      suspects.push([i + 1, 'interpolation inside a comment', line]);
    }
  }

  if (suspects.length === 0) return '';
  return [
    '',
    '  LIKELY CAUSE — these lines sit INSIDE the template literal:',
    ...suspects.map(
      ([n, why, line]) => `    line ${n}: ${why}\n      ${line.trim()}`
    ),
    '  A backtick in a GLSL comment ends the template; write mix(a, b, t)',
    '  as plain prose rather than in backticks.',
  ].join('\n');
}

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
 * after rewriting the `-sim` and `-display` shaders of a two-pass preset
 * (since cut) to consume the shared audio block, but before wiring its
 * renderer to upload it. Every
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

  // Require an actual CALL, not a mention. `code.includes('uploadAudioUniforms')`
  // is satisfied by the IMPORT STATEMENT alone, so a renderer that imports the
  // helper and never calls it passed as "fully wired" — a false negative found
  // only because I happened to know the code was incomplete. The spread is
  // matched with its `...` for the same reason.
  const wiresAudioBlock =
    code.includes('...AUDIO_UNIFORM_NAMES') &&
    /uploadAudioUniforms\s*\(/.test(code);

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
  try {
    execFileSync('glslangValidator', ['--version'], { stdio: 'ignore' });
  } catch {
    fail(
      '\n✖ glslangValidator is not on PATH: `brew install glslang`, or `apt-get install glslang-tools`'
    );
    return;
  }
  const esbuild = await loadEsbuild();

  // `compositor` alone checks only the compositor's passes, the Showreel's
  // film passes among them.
  if (filter.length > 0 && filter.every((f) => f === 'compositor')) {
    await checkCompositor(esbuild);
    await checkFilmPasses(esbuild);
    return;
  }

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
   * Map a shader filename to its preset. `lenia-sim.frag.ts` and
   * `lenia-display.frag.ts` both belong to `lenia`, whose single renderer
   * uploads for both passes; `flow-init.frag.ts` (flow's seed) belongs to flow.
   */
  const presetOf = (file) =>
    file.replace(/\.(frag|vert)\.ts$/, '').replace(/-(sim|display|init)$/, '');

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
        fail(diagnoseBundleFailure(modPath, err.message));
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

        // WP-11: every preset source, as every compositor pass (one checker).
        const reversed = reversedSmoothsteps(source);
        if (reversed.length > 0) {
          failures.push(`${file}:${exportName}`);
          fail(
            `\n✖ ${file} → ${exportName}: smoothstep with edge0 >= edge1, undefined in GLSL ES 3.00 (§8.3): ${reversed.join(' ; ')}` +
              '\n  Write 1.0 - smoothstep(lo, hi, x) for a falling edge.'
          );
        }

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

  if (filter.length === 0 || filter.includes('compositor')) {
    await checkCompositor(esbuild);
    await checkFilmPasses(esbuild);
  }
}

const REGISTRY = path.resolve(
  HERE,
  '../src/lib/components/ui/ShaderHero/compositor/effects/registry.ts'
);
/**
 * 5 blends, 15 layers (WP-8), 4 frames and 4 passes over the media (WP-5b);
 * fewer means the registry moved or emptied.
 */
const MIN_EFFECTS = 28;

// `uniformDeclarations` and `declaredUniforms` live in glsl-source.mjs.

const WEBGL_UTILS = path.resolve(
  HERE,
  '../src/lib/components/ui/ShaderHero/webgl-utils.ts'
);
/** Short, and past 900 px tall: a layer that scales with the canvas there. */
const IDENTITY_SIZES = [
  [96, 64],
  [72, 1350],
];
/** Sixteen beats (glitch draws only on some), for a layer that reads the clock. */
const IDENTITY_TIMES = Array.from({ length: 16 }, (_, k) => 0.25 + k * 0.5);
/**
 * The push-in's `u_zoom` at amount 1 (its depth, `media-pass.ts`
 * PUSH_DEPTH); at amount 0 it is 1, so the push-in is judged as a layer is:
 * unchanged at 0, changed at 1.
 */
const PUSH_AT_ONE = 0.08;
/** Off-centre, and brand colours unlike each other and the picture. */
const IDENTITY_VALUES = {
  u_pointer: [0.37, 0.61],
  u_brandPrimary: [0.78, 0.12, 0.16],
  u_brandSecondary: [0.35, 0.38, 0.42],
  u_brandAccent: [0.95, 0.68, 0.2],
  u_bgColor: [0.96, 0.94, 0.9],
  u_rect: [0, 0, 1, 1],
  u_fade: 1,
  u_hasMedia: 0,
  // the surfaces' brand tint and duotone stops (WP-5b), unlike the picture
  u_tint: [0.78, 0.12, 0.16],
  u_toneDeep: [0.1, 0.05, 0.06],
  u_toneMid: [0.78, 0.12, 0.16],
  u_tonePale: [0.95, 0.81, 0.82],
};

/**
 * Runs in the page: draws each layer over a fixed noise picture at amount 0
 * and at 1, and reports the largest channel change (0-255) from its input.
 */
function renderLayers({
  vs,
  layers,
  sizes,
  times,
  values,
  units,
  PUSH_AT_ONE,
}) {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { noWebgl2: true };
  const shader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) ?? 'compile failed');
    return sh;
  };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  // Hashed noise over two ramps: every texel unlike its neighbours.
  const picture = (w, h, seed) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = (k) =>
          Math.imul(
            (x * 73856093) ^ (y * 19349663) ^ ((seed + k) * 83492791),
            2654435761
          ) >>> 24;
        const i = (y * w + x) * 4;
        data[i] = (n(1) + (x * 255) / w) / 2;
        data[i + 1] = (n(2) + (y * 255) / h) / 2;
        data[i + 2] = n(3);
        data[i + 3] = 255;
      }
    }
    return data;
  };
  // As the compositor's scene: RGBA8, linear, clamped.
  const texture = (w, h, data) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const targets = sizes.map(([w, h]) => {
    const scene = picture(w, h, 1);
    const target = texture(w, h, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      target,
      0
    );
    return {
      w,
      h,
      scene,
      sceneTex: texture(w, h, scene),
      secondTex: texture(w, h, picture(w, h, 7)),
      fbo,
    };
  });
  const results = [];
  for (const layer of layers) {
    const prog = gl.createProgram();
    try {
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, layer.fs));
    } catch (err) {
      results.push({ id: layer.id, error: String(err.message) });
      continue;
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      results.push({ id: layer.id, error: gl.getProgramInfoLog(prog) });
      continue;
    }
    gl.useProgram(prog);
    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const result = {
      id: layer.id,
      axis: layer.axis,
      atZero: 0,
      zeroAt: null,
      atOne: 0,
    };
    for (const t of targets) {
      const bind = (unit, tex) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      };
      bind(units.u_scene, t.sceneTex);
      bind(units.u_second, t.secondTex);
      bind(units.u_mask, t.sceneTex);
      bind(units.u_media, t.sceneTex);
      for (const time of layer.readsTime ? times : [times[0]]) {
        for (const amount of [0, 1]) {
          for (const [name, type] of layer.uniforms) {
            const loc = gl.getUniformLocation(prog, name);
            if (loc === null) continue;
            const v =
              name in units
                ? units[name]
                : name === 'u_resolution' || name === 'u_mediaSize'
                  ? [t.w, t.h]
                  : name === 'u_time'
                    ? time
                    : name === 'u_amount'
                      ? amount
                      : name === 'u_zoom'
                        ? 1 + amount * PUSH_AT_ONE
                        : values[name];
            if (v === undefined) throw new Error(`no test value for ${name}`);
            if (type === 'sampler2D') gl.uniform1i(loc, v);
            else if (type === 'float') gl.uniform1f(loc, v);
            else gl[`uniform${v.length}fv`](loc, v);
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
          gl.viewport(0, 0, t.w, t.h);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          const out = new Uint8Array(t.w * t.h * 4);
          gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
          let most = 0;
          let at = null;
          for (let i = 0; i < out.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(out[i + c] - t.scene[i + c]);
              if (d > most) {
                most = d;
                at = `${t.w}x${t.h} px ${(i / 4) % t.w},${Math.floor(i / 4 / t.w)} t=${time}`;
              }
            }
          }
          if (amount === 0 && most > result.atZero) {
            result.atZero = most;
            result.zeroAt = at;
          }
          if (amount === 1) result.atOne = Math.max(result.atOne, most);
        }
      }
    }
    results.push(result);
  }
  return { results };
}

/**
 * The layer render cannot run here: no browser, or no WebGL2. In CI
 * (`CI=true`, which GitHub Actions sets) that FAILS, so the check can never
 * pass there by not running; on a machine without a browser it is a loud
 * skip, and CI still runs it.
 */
function unavailable(why) {
  if (process.env.CI === 'true') {
    fail(`\n✖ layer identity\n  ${why}; in CI it must run, so it fails`);
    return;
  }
  console.warn(
    `⚠ layer identity SKIPPED: ${why}. CI runs it and fails closed; install Chrome, or \`pnpm --filter web exec playwright install chromium\`, to run it here.`
  );
}

/**
 * Every LAYER at amount 0 must draw its input unchanged (WP-8 review L1): a
 * brand's `glow:0` is a saved, valid stack, and `glitch:0` once still tore
 * bands. So must every pass over the media (WP-5b): a surface at 0, and the
 * push-in at `u_zoom` 1, its first frame. glslang compiles a pass but runs
 * nothing, so each layer is RUN here:
 * WebGL2 in headless Chromium on SwiftShader (no GPU, the same answer on any
 * machine), over a noise picture, at a short size and one past 900 px tall
 * (where a layer scaled with the canvas, as mosaic was, still pixelated at
 * 0), and at sixteen beats for one that reads the clock. Calibrated in the
 * same run: at amount 1 each must change its input, or the check proves
 * nothing. A largest change of 1/255 is allowed for rounding.
 */
async function checkLayerIdentity(layers, assembleEffect) {
  const vs = readFileSync(WEBGL_UTILS, 'utf8').match(
    /export const VERTEX_SHADER = `([\s\S]*?)`;/
  )?.[1];
  if (!vs) {
    fail(`\n✖ layer identity\n  no VERTEX_SHADER found in ${WEBGL_UTILS}`);
    return;
  }
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('@playwright/test'));
  } catch (err) {
    fail(`\n✖ layer identity\n  cannot load @playwright/test: ${err.message}`);
    return;
  }
  // SwiftShader, ANGLE's CPU renderer: no GPU, the same pixels anywhere.
  // Recent Chrome will not fall back to it without the unsafe flag.
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // SHADERS_CHROME names the one browser to use (CI's system Chrome);
  // otherwise Playwright's own Chromium, else the system Chrome.
  const candidates = process.env.SHADERS_CHROME
    ? [{ executablePath: process.env.SHADERS_CHROME }]
    : [{}, { channel: 'chrome' }];
  let browser = null;
  let launchError = '';
  for (const candidate of candidates) {
    try {
      browser = await chromium.launch({ headless: true, args, ...candidate });
      break;
    } catch (err) {
      launchError = err.message.split('\n')[0];
    }
  }
  if (!browser) {
    unavailable(`no browser would launch (${launchError})`);
    return;
  }
  try {
    const page = await browser.newPage();
    const input = layers.map((effect) => {
      const fs = assembleEffect(effect);
      return {
        id: effect.id,
        axis: effect.axis,
        fs,
        readsTime: effect.uniforms.includes('u_time'),
        uniforms: uniformDeclarations(fs),
      };
    });
    let rendered;
    try {
      rendered = await page.evaluate(renderLayers, {
        vs,
        layers: input,
        sizes: IDENTITY_SIZES,
        times: IDENTITY_TIMES,
        values: IDENTITY_VALUES,
        PUSH_AT_ONE,
        // the harness's own units: it binds and sets each sampler itself
        units: { u_scene: 0, u_second: 1, u_mask: 2, u_media: 3 },
      });
    } catch (err) {
      rendered = { error: err.message.split('\n')[0] };
    }
    const { error, noWebgl2, results } = rendered;
    if (noWebgl2) {
      unavailable('the browser gave no WebGL2 context');
      return;
    }
    if (error) {
      fail(`\n✖ layer identity\n  ${error}`);
      return;
    }
    let bad = 0;
    for (const r of results) {
      const name = `compositor:${r.axis}:${r.id}`;
      if (r.error) {
        bad++;
        fail(`\n✖ ${name}: did not build in WebGL2: ${r.error}`);
      } else if (r.atZero > 1) {
        bad++;
        fail(
          `\n✖ ${name}: at amount 0 it changes its input by ${r.atZero}/255 (${r.zeroAt})` +
            '\n  Scale every change by u_amount (u_zoom for the push-in), so 0 draws the input unchanged.'
        );
      } else if (r.atOne < 8) {
        bad++;
        fail(
          `\n✖ ${name}: at amount 1 it changes its input by only ${r.atOne}/255, so its identity at 0 proves nothing`
        );
      }
    }
    if (bad === 0) {
      console.log(
        `✓ ${results.length} layers and media passes draw their input unchanged at amount 0 (run in WebGL2, SwiftShader)`
      );
    }
  } finally {
    await browser.close();
  }
}

/**
 * The compositor's passes (Codex-1yd58.4): each effect in the registry,
 * assembled exactly as the compositor assembles it at runtime
 * (`assembleEffect`), must compile, and must declare only uniforms the
 * compositor sets.
 *
 * The compositor sets every name in `UNIFORMS` (TypeScript makes its value
 * record complete, and each sampler has a fixed unit), and a pass's
 * declarations are generated from its effect's `uniforms` list. So the two
 * ways a pass could read a uniform nobody sets, and get a silent zero, are:
 * its body declares one itself, or its list names one outside the table
 * (past the type check, through a cast). Both fail here, as does a
 * smoothstep with literal edges not rising (`reversedSmoothsteps`). When all
 * compile, each layer is then run (`checkLayerIdentity`).
 */
async function checkCompositor(esbuild) {
  const work = mkdtempSync(path.join(tmpdir(), 'glsl-compositor-'));
  try {
    const bundled = path.join(work, 'registry.mjs');
    let mod;
    try {
      await esbuild.build({
        entryPoints: [REGISTRY],
        outfile: bundled,
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent',
      });
      mod = await import(`file://${bundled}`);
    } catch (err) {
      fail(
        `\n✖ compositor registry\n  could not bundle/import: ${err.message}`
      );
      return;
    }
    const { EFFECTS, assembleEffect, SETTABLE_UNIFORMS } = mod;
    if (
      !Array.isArray(EFFECTS) ||
      typeof assembleEffect !== 'function' ||
      !Array.isArray(SETTABLE_UNIFORMS)
    ) {
      fail(
        '\n✖ compositor registry\n  exports no EFFECTS / assembleEffect / SETTABLE_UNIFORMS'
      );
      return;
    }
    if (EFFECTS.length < MIN_EFFECTS) {
      fail(
        `\n✖ compositor registry\n  only ${EFFECTS.length} effect(s), expected at least ${MIN_EFFECTS}: it moved or emptied`
      );
      return;
    }
    const settable = new Set(SETTABLE_UNIFORMS);
    const failures = [];
    for (const effect of EFFECTS) {
      const name = `compositor:${effect.axis}:${effect.id}`;
      const source = assembleEffect(effect);
      const scratch = path.join(work, `${effect.id}.frag`);
      writeFileSync(scratch, source, 'utf8');
      try {
        execFileSync('glslangValidator', ['-S', 'frag', scratch], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const diagnostic = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
        failures.push(name);
        fail(`\n✖ ${name}\n${diagnostic}`);
        const line = firstErrorLine(diagnostic);
        if (line) fail(context(source, line));
      }
      const own = declaredUniforms(effect.glsl);
      if (own.length > 0) {
        failures.push(name);
        fail(
          `\n✖ ${name}: its glsl declares uniform(s) of its own: ${own.join(', ')}` +
            "\n  List them in the effect's `uniforms`; the declarations are generated from it."
        );
      }
      const reversed = reversedSmoothsteps(source);
      if (reversed.length > 0) {
        failures.push(name);
        fail(
          `\n✖ ${name}: smoothstep with edge0 >= edge1, undefined in GLSL ES 3.00 (§8.3): ${reversed.join(' ; ')}` +
            '\n  Write 1.0 - smoothstep(lo, hi, x) for a falling edge.'
        );
      }
      const unset = [
        ...new Set([...declaredUniforms(source), ...effect.uniforms]),
      ].filter((u) => !settable.has(u));
      if (unset.length > 0) {
        failures.push(name);
        fail(
          `\n✖ ${name}: reads uniform(s) the compositor never sets: ${unset.join(', ')}` +
            '\n  Add them to UNIFORMS (compositor/effects/uniforms.ts) and set them in the compositor.'
        );
      }
    }
    if (failures.length === 0) {
      console.log(
        `✓ ${EFFECTS.length} compositor passes compiled, every uniform set`
      );
      await checkLayerIdentity(
        EFFECTS.filter(
          (effect) => effect.axis === 'layer' || effect.axis === 'media'
        ),
        assembleEffect
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The Showreel's film passes (Codex-1yd58.7, WP-6): each film frame composed
 * with every motion effect (`everyFilmPass`, 480 passes), assembled exactly
 * as the compositor assembles it (`assembleFilmPass`), must pass the text
 * checks (`filmGateProblems`, shader-gate.mjs, which CI also runs without
 * glslang), then compile.
 */
async function checkFilmPasses(esbuild) {
  const work = mkdtempSync(path.join(tmpdir(), 'glsl-film-'));
  try {
    let film;
    try {
      film = await bundleFilmPasses(esbuild, work);
    } catch (err) {
      fail(`\n✖ film passes\n  could not bundle/import: ${err.message}`);
      return;
    }
    const problems = filmGateProblems(film);
    for (const { name, message } of problems) fail(`\n✖ ${name}: ${message}`);
    let failed = problems.length > 0;
    for (const pass of film.passes) {
      const source = film.assemble(pass);
      const scratch = path.join(
        work,
        `film-${pass.id.replace(/[^\w-]/g, '_')}.frag`
      );
      writeFileSync(scratch, source, 'utf8');
      try {
        execFileSync('glslangValidator', ['-S', 'frag', scratch], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const diagnostic = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
        failed = true;
        fail(`\n✖ film:${pass.id}\n${diagnostic}`);
        const line = firstErrorLine(diagnostic);
        if (line) fail(context(source, line));
      }
    }
    if (!failed) {
      console.log(
        `✓ ${film.passes.length} Showreel film passes compiled, every uniform set`
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
