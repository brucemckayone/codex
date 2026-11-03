// @vitest-environment node
/**
 * No custom property names itself (Codex-mik4h). `--x: var(--a, var(--x))` is
 * a dependency cycle even when the fallback is never used: WebKit computes
 * the property EMPTY, Chrome resolves it. `--color-primary-500` was written
 * that way in org-brand.css, so every direct `var(--color-primary-500)` on an
 * org page painted nothing in Safari.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, '../..');
const ROOTS = [join(lib, 'styles'), join(lib, 'page-builder')];

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

/** Every `--name: value;` in a stylesheet whose value names `--name` itself. */
function selfReferences(css: string): string[] {
  const found: string[] = [];
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*);/g)) {
    if (value.includes(`var(${name})`) || value.includes(`var(${name},`))
      found.push(name);
  }
  return found;
}

describe('custom properties', () => {
  test('the check sees a self-reference', () => {
    expect(
      selfReferences('a { --x: var(--brand, var(--x)); --y: var(--x); }')
    ).toEqual(['--x']);
  });

  test('none names itself, in any stylesheet the app and the page kit ship', () => {
    const files = ROOTS.flatMap(cssFiles);
    expect(files.length).toBeGreaterThan(5);
    const hits = files.flatMap((file) =>
      selfReferences(readFileSync(file, 'utf8')).map(
        (name) => `${relative(lib, file)} ${name}`
      )
    );
    expect(hits).toEqual([]);
  });
});
