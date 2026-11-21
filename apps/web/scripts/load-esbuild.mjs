/**
 * The esbuild the app builds with, for the shader gates: validate-shaders.mjs
 * (shaders:check) and shader-gate.mjs (the film passes' text checks, which CI
 * runs without glslang). Moved out of validate-shaders.mjs (Codex-1yd58.7).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * esbuild is not a direct dependency of `apps/web` — it arrives transitively
 * through Vite. Resolving it via Vite's own require path avoids adding a
 * devDependency (and so avoids touching package.json / the lockfile) while
 * still using the exact esbuild the app builds with.
 */
export async function loadEsbuild() {
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
