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
const src = join(here, '../../..');
const ROOTS = [join(src, 'lib'), join(src, 'routes')];

function styleFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return styleFiles(path);
    return name.endsWith('.css') || name.endsWith('.svelte') ? [path] : [];
  });
}

/** A stylesheet whole, or a Svelte component's `<style>` blocks. */
function styles(path: string): string {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.css')) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(([, css]) => css)
    .join('\n');
}

/** Every `--name: value` in CSS whose value names `--name` itself. */
function selfReferences(css: string): string[] {
  const found: string[] = [];
  for (const [, name, value] of css.matchAll(
    /(--[\w-]+)\s*:\s*([^;{}]*)[;}]/g
  )) {
    if (value.includes(`var(${name})`) || value.includes(`var(${name},`))
      found.push(name);
  }
  return found;
}

describe('custom properties', () => {
  test('the check sees a self-reference, with or without its semicolon', () => {
    expect(
      selfReferences('a { --x: var(--brand, var(--x)); --y: var(--x); }')
    ).toEqual(['--x']);
    expect(selfReferences('a { --y: 1px; --x: var(--x) }')).toEqual(['--x']);
  });

  test('the scan reads a component’s style blocks, not its markup', () => {
    const switchFile = join(src, 'lib/components/ui/Switch/Switch.svelte');
    expect(styleFiles(join(src, 'lib/components/ui/Switch'))).toContain(
      switchFile
    );
    const css = styles(switchFile);
    expect(css).toContain('.switch[data-state="checked"] .thumb');
    expect(css).not.toContain('<script');
  });

  test('none names itself, in any stylesheet or component style under lib and routes', () => {
    const files = ROOTS.flatMap(styleFiles);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((file) =>
      selfReferences(styles(file)).map(
        (name) => `${relative(src, file)} ${name}`
      )
    );
    expect(hits).toEqual([]);
  });
});
