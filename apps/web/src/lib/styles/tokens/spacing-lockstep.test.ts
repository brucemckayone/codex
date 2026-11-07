// @vitest-environment node
/**
 * The `:root` spacing scale and its `[data-org-brand]` re-declaration hold the
 * same rungs with the same formulas (spacing.css R12, Codex-1g5lh.6).
 *
 * A `:root` declaration substitutes `var(--space-unit)` once, at density 1,
 * and descendants inherit the resolved length; only the org-scope twin makes
 * a rung follow the org's density. A rung missing there ignores the density
 * dial (`--space-32` was a fixed 128px on every org page); a rung missing from
 * `:root` is invalid on every platform route (`--space-9`, `--space-14`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Every `--space-N: formula` built on `--space-unit`, comments removed. */
function rungs(file: string): Map<string, string> {
  const css = readFileSync(join(here, file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
  return new Map(
    [...css.matchAll(/(--space-\d[\w-]*)\s*:\s*([^;]+);/g)]
      .filter(([, , formula]) => formula.includes('--space-unit'))
      .map(([, name, formula]) => [name, formula.trim()])
  );
}

describe('spacing scale', () => {
  test('the org scope re-declares every :root rung, formula for formula', () => {
    const root = rungs('spacing.css');
    const org = rungs('org-brand.css');
    expect(root.size).toBeGreaterThan(20);
    expect(Object.fromEntries(org)).toEqual(Object.fromEntries(root));
  });
});
