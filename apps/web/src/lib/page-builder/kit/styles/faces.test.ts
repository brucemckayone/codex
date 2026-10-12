// @vitest-environment node
/**
 * The face lookup (`faces.css`, Codex-61zsk.33): how many em a unit of word
 * weight takes in each display face, matched in CSS on the face the page
 * resolves.
 *
 * Every part of it fails silently. A sheet left behind its table, a face the
 * brand editor offers with no entry, a writer spelling a face in a way the
 * sheet does not match, a sans stack respelled in `org-brand.css` (a style
 * query compares the text exactly), or the sheet not loaded: each leaves a
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

  // One face with a space in its name and one without, through each writer.
  it.each([
    'Archivo Black',
    'Syne',
  ])('matches %s as every writer spells it', (face) => {
    const written = [
      brandOverridesToCssVars({ fontHeading: face })['--brand-font-heading'],
      darkTokenOverridesToCssVars({ 'font-heading': face })[
        '--brand-font-heading-dark'
      ],
      // The org layout and the brand editor's live preview quote it so.
      `'${face}'`,
    ];
    for (const spelling of written) {
      expect(faceSpellings(face), spelling).toContain(spelling);
      expect(facesSheet()).toContain(`style(--lp-font-display: ${spelling})`);
    }
  });

  it('is right about how the org layout and the live preview quote a face', () => {
    expect(read('../../../../routes/_org/[slug]/+layout.svelte')).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts source text that contains a template literal
      "style:--brand-font-heading={brandFontHeading ? `'${brandFontHeading}'` : undefined}"
    );
    expect(read('../../../brand-editor/css-injection.ts')).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts source text that contains a template literal
      "el.style.setProperty(prop, `'${family}'`);"
    );
  });

  it('spells the org sans stack as org-brand.css writes it', () => {
    expect(read('../../../styles/tokens/org-brand.css')).toContain(
      `--font-sans: var(--brand-font-body, 'Inter'), ${SANS_STACK_TAIL};`
    );
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
