// @vitest-environment node
/**
 * The face lookup (`faces.css`, Codex-61zsk.33): how many em a unit of word
 * weight takes in each display face, matched in CSS on the face the page
 * resolves.
 *
 * Every part of it fails silently. A sheet left behind its table, a face the
 * brand editor offers with no entry, a writer spelling a face in a way the
 * sheet does not match, a font stack respelled in `org-brand.css` or
 * `typography.css` (a style query compares the text exactly), or the sheet
 * not loaded: each leaves a
 * face on the widest face's scale, a smaller headline and no error anywhere.
 * And a Style whose tracking is not an em length makes the poster's size an
 * invalid one, which drops it to the body's. So each is held here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { darkTokenOverridesToCssVars } from '$lib/brand-editor/css-injection';
import { getBodyFonts, getHeadingFonts } from '$lib/brand-editor/font-catalog';
import { withFallback } from '$lib/brand-editor/font-fallbacks';
import { brandOverridesToCssVars } from '$lib/page-builder/render/brand-overrides';
import {
  FACE_SCALE,
  faceSpellings,
  facesSheet,
  GLYPH_WEIGHT,
  SANS_STACK_TAIL,
  widestScale,
} from '../model/faces';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(DIR, path), 'utf8');
const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the face lookup', () => {
  it('is the sheet its table writes (run scripts/write-faces-sheet.ts)', () => {
    expect(read('faces.css')).toBe(facesSheet());
  });

  it('knows every face the brand editor offers, and only those', () => {
    const offered = [
      ...new Set(
        [...getHeadingFonts(), ...getBodyFonts()].map((font) => font.family)
      ),
    ].sort();
    expect(Object.keys(FACE_SCALE).sort()).toEqual(offered);
  });

  // One face with a space in its name and one without, through each writer,
  // and Inter, which no writer follows with a fallback of its own.
  it.each([
    'Archivo Black',
    'Syne',
    'Inter',
  ])('matches %s as every writer spells it', (face) => {
    const written = [
      brandOverridesToCssVars({ fontHeading: face })['--brand-font-heading'],
      // The brand editor's dark emit and its live preview share one quoting.
      darkTokenOverridesToCssVars({ 'font-heading': face })[
        '--brand-font-heading-dark'
      ],
      // The org layout quotes it so.
      withFallback(face, `'${face}'`),
    ];
    for (const value of written) {
      // Every stack follows the written value with the tail.
      const resolved = `${value}, ${SANS_STACK_TAIL}`;
      expect(faceSpellings(face), resolved).toContain(resolved);
      expect(facesSheet()).toContain(`style(--lp-font-display: ${resolved})`);
    }
  });

  it('is right about how the org layout and the live preview quote a face', () => {
    expect(read('../../../../routes/_org/[slug]/+layout.svelte')).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts source text that contains a template literal
      "style:--brand-font-heading={brandFontHeading ? withFallback(brandFontHeading, `'${brandFontHeading}'`) : undefined}"
    );
    const injection = read('../../../brand-editor/css-injection.ts');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts source text that contains a template literal
    expect(injection).toContain("return withFallback(name, `'${name}'`);");
    expect(injection).toContain(
      'el.style.setProperty(prop, quoteFamily(family));'
    );
  });

  it('ends every stack the headings can resolve with the tail it matches', () => {
    const stacks = [
      '../../../styles/tokens/org-brand.css',
      '../../../styles/tokens/typography.css',
    ].flatMap((sheet) =>
      [
        ...uncomment(read(sheet)).matchAll(
          /--font-(?:sans|body|heading):\s*([^;]+);/g
        ),
      ].map(([, value]) => (value ?? '').trim())
    );
    // org-brand.css: --font-sans, and --font-body and --font-heading light and
    // dark; typography.css: --font-sans and --font-heading.
    expect(stacks).toHaveLength(7);
    for (const stack of stacks)
      expect(
        stack === 'var(--font-sans)' || stack.endsWith(`, ${SANS_STACK_TAIL}`),
        stack
      ).toBe(true);
  });

  it('matches on the face the headings are drawn in', () => {
    expect(read('kit.css')).toMatch(
      /\.lp \{[^}]*--lp-font-display: var\(--font-heading\);/
    );
    expect(read('../primitives/Heading.svelte')).toMatch(
      /\.lp-heading \{[^}]*font-family: var\(--lp-font-display\);/
    );
  });

  it('is loaded with the kit', () => {
    expect(read('../PageRenderer.svelte')).toContain(
      "import './styles/faces.css';"
    );
  });

  it('leaves an unknown face the widest scale, which no face exceeds', () => {
    const [caps, text] = widestScale();
    expect(facesSheet()).toContain(
      `.lp {\n  --lp-face-caps: ${caps};\n  --lp-face-text: ${text};\n}`
    );
    for (const [face, [faceCaps, faceText]] of Object.entries(FACE_SCALE)) {
      expect(faceCaps, face).toBeLessThanOrEqual(caps);
      expect(faceText, face).toBeLessThanOrEqual(text);
      expect(faceCaps, face).toBeGreaterThan(0.25);
      expect(faceText, face).toBeGreaterThan(0.25);
    }
  });

  it('weighs every letter, figure and mark a headline commonly draws', () => {
    for (const glyph of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,.'’-–—!?&:;")
      expect(GLYPH_WEIGHT[glyph], glyph).toBeGreaterThan(0);
    // Relative to an average lowercase letter: a W is wide, an i narrow.
    expect(GLYPH_WEIGHT.W).toBeGreaterThan(1.5);
    expect(GLYPH_WEIGHT.i).toBeLessThan(0.7);
  });
});

describe('the tracking the poster divides', () => {
  it('is an em length in the kit and in every Style', () => {
    const sheets = [
      'kit.css',
      ...[
        'bold',
        'clean',
        'soft',
        'cinematic',
        'path',
        'poster',
        'studio',
        'quiet',
      ].map((style) => `style-${style}.css`),
    ];
    let declared = 0;
    for (const sheet of sheets)
      for (const [, value] of uncomment(read(sheet)).matchAll(
        /--lp-tracking-display:\s*([^;]+);/g
      )) {
        declared++;
        expect(value.trim(), sheet).toMatch(/^-?\d*\.?\d+em$/);
      }
    expect(declared).toBeGreaterThanOrEqual(sheets.length);
  });
});
