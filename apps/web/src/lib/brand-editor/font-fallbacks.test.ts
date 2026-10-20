// @vitest-environment node
/**
 * Each brand face's own fallback (`font-fallbacks.ts`, Codex-61zsk.61).
 *
 * Every part of it fails silently: a sheet left behind its table, a face the
 * brand editor offers with no fallback, `typography.css`'s 'Inter-fallback'
 * drifting from Inter's row, or a writer spelling the fallback so the face no
 * longer reads back. Each draws the page in some other face until the brand
 * face lands, with no error anywhere. So each is held here; what the table's
 * numbers are worth is measured by `e2e/page-kit/font-fallbacks.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getBodyFonts, getHeadingFonts } from './font-catalog';
import {
  FACE_FALLBACK,
  FALLBACK_WEIGHTS,
  fallbackRules,
  fallbacksSheet,
  firstFamily,
  withFallback,
} from './font-fallbacks';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(DIR, path), 'utf8');

describe('the brand faces’ fallbacks', () => {
  it('are the sheet their table writes (run scripts/write-font-fallbacks-sheet.ts)', () => {
    expect(read('../styles/tokens/font-fallbacks.css')).toBe(fallbacksSheet());
  });

  it('cover every face the brand editor offers, and only those', () => {
    const offered = [...getHeadingFonts(), ...getBodyFonts()];
    expect(Object.keys(FACE_FALLBACK).sort()).toEqual(
      [...new Set(offered.map((font) => font.family))].sort()
    );
    // A monospace face is matched by Courier New, every other by Arial or Times.
    for (const font of offered)
      expect(
        FACE_FALLBACK[font.family]?.[0] === 'Courier New',
        font.family
      ).toBe(font.category === 'monospace');
  });

  it('size every weight the page asks for, within what a fallback can be', () => {
    for (const [face, [, rows]] of Object.entries(FACE_FALLBACK)) {
      expect(rows, face).toHaveLength(FALLBACK_WEIGHTS.length);
      expect(fallbackRules(face), face).toHaveLength(FALLBACK_WEIGHTS.length);
      for (const [bold, size, ascent, descent] of rows) {
        expect([0, 1], face).toContain(bold);
        expect(size, face).toBeGreaterThan(60);
        expect(size, face).toBeLessThan(160);
        expect(ascent, face).toBeGreaterThan(60);
        expect(descent, face).toBeGreaterThan(5);
      }
    }
  });

  it('are loaded on every org page', () => {
    expect(read('../../routes/_org/[slug]/+layout.svelte')).toContain(
      "import '$lib/styles/tokens/font-fallbacks.css';"
    );
  });

  it("keep typography.css's 'Inter-fallback' on Inter's row", () => {
    const sheet = read('../styles/tokens/typography.css');
    for (const rule of fallbackRules('Inter')) expect(sheet).toContain(rule);
    // Declared there for every page, so not again in the brand faces' sheet.
    expect(fallbacksSheet()).not.toContain("font-family: 'Inter-fallback'");
    expect(sheet.match(/font-family: 'Inter-fallback';/g)).toHaveLength(
      FALLBACK_WEIGHTS.length
    );
  });
});

describe('a face followed by its fallback', () => {
  it('names the fallback after the face, as its writer quotes it', () => {
    expect(withFallback('Bitter', "'Bitter'")).toBe(
      "'Bitter', 'Bitter-fallback'"
    );
    expect(withFallback('DM Sans', '"DM Sans"')).toBe(
      `"DM Sans", 'DM Sans-fallback'`
    );
  });

  it('leaves Inter, whose fallback ends every stack, and a face it does not know', () => {
    expect(withFallback('Inter', "'Inter'")).toBe("'Inter'");
    expect(withFallback('Comic Sans MS', "'Comic Sans MS'")).toBe(
      "'Comic Sans MS'"
    );
  });

  it('reads back as the face', () => {
    for (const face of ['Bitter', 'DM Sans', 'Source Sans 3', 'Inter'])
      for (const quoted of [`'${face}'`, `"${face}"`, face])
        expect(firstFamily(withFallback(face, quoted)), quoted).toBe(face);
    expect(firstFamily('  "Playfair Display" , serif')).toBe(
      'Playfair Display'
    );
    expect(firstFamily('')).toBe('');
  });
});
