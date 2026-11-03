/**
 * The media library honours prefers-reduced-motion (Codex-71rf3, absorbed by
 * Codex-a6ofh.1.6 for the media surfaces; WCAG 2.3.3).
 *
 * A CSS transition or animation is reached by the global reduced-motion rule.
 * A Svelte `transition:` / `in:` / `out:` / `animate:` directive is not: it is
 * timed in JS, so it plays at full length for a reduced-motion user unless the
 * component gates it on the preference itself. JSDOM evaluates neither, so the
 * census reads the source, as reduced-motion-coverage.test.ts does for the nav.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const COMPONENTS = resolve(__dirname, '../..');
const MEDIA_LIBRARY = __dirname;

/** The markup and script only: a CSS `transition:` property is not a directive. */
function withoutStyles(source: string): string {
  return source.replace(/<style[\s\S]*?<\/style>/g, '');
}

const DIRECTIVE = /\b(?:transition|in|out|animate):[A-Za-z]/;

describe('Codex-71rf3: the media surfaces honour prefers-reduced-motion', () => {
  const files = readdirSync(MEDIA_LIBRARY).filter((file) =>
    file.endsWith('.svelte')
  );

  test('the census sees the library (calibration)', () => {
    expect(files).toContain('StudioMediaLibrary.svelte');
    expect(DIRECTIVE.test('<div transition:fly={{ y: 4 }}>')).toBe(true);
    expect(DIRECTIVE.test('<li animate:flip>')).toBe(true);
    expect(DIRECTIVE.test('transition: width var(--duration-normal);')).toBe(
      false
    );
  });

  test.each(
    files
  )('%s plays no JS-timed transition without the preference', (file) => {
    const source = withoutStyles(
      readFileSync(join(MEDIA_LIBRARY, file), 'utf8')
    );
    if (DIRECTIVE.test(source)) {
      expect(source).toContain('prefersReducedMotion');
    }
  });

  // The shared primitives the library mounts: the toolbar's menus and the
  // phone filter sheet.
  test("the toolbar's menus appear in place for a reduced-motion user", () => {
    const source = readFileSync(
      join(COMPONENTS, 'ui/DropdownMenu/DropdownMenuContent.svelte'),
      'utf8'
    );
    expect(source).toContain(
      "import { prefersReducedMotion } from 'svelte/motion'"
    );
    expect(source).toMatch(
      /prefersReducedMotion\.current\s*\?\s*\{[^}]*duration:\s*0/
    );
    expect(source).toMatch(/transition:fly=\{motion\}/);
  });

  test('the phone filter sheet stills its CSS slide', () => {
    const source = readFileSync(
      join(COMPONENTS, 'ui/FilterDrawer/FilterDrawer.svelte'),
      'utf8'
    );
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(DIRECTIVE.test(withoutStyles(source))).toBe(false);
  });
});
