/**
 * Unit tests for the pure-helper portion of logo-texture.ts.
 *
 * Scope: `ensureSVGDimensions` only — pure DOMParser/XMLSerializer logic
 * that runs under vitest's jsdom environment with no WebGL dependency.
 *
 * The WebGL portions (`loadLogoTexture`, `destroyLogoTexture`) and the
 * sibling JFA-SDF pipeline require @vitest/browser or visual regression and
 * are explicitly out of scope per Codex-lbu6.
 *
 * NOTE: The bead description references `apps/web/src/lib/brand-editor/
 * logo-texture.ts`. The file has since moved to its current location under
 * `components/ui/ShaderHero/`. The exported helper signature is unchanged.
 */

import { describe, expect, test } from 'vitest';
import { ensureSVGDimensions } from '../logo-texture';

/**
 * Parse a serialized SVG string and return the root <svg> element so tests
 * can assert on attributes without regex-matching string output.
 */
function parseSvg(svgText: string): SVGElement {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  return doc.documentElement as unknown as SVGElement;
}

describe('ensureSVGDimensions', () => {
  test('SVG with no viewBox and no dimensions gets default square dimensions (size × size)', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';

    const result = ensureSVGDimensions(input, 512);
    const svg = parseSvg(result);

    expect(svg.getAttribute('width')).toBe('512');
    expect(svg.getAttribute('height')).toBe('512');
    // Sanity: viewBox should remain absent (we only inject dimensions).
    expect(svg.getAttribute('viewBox')).toBeNull();
  });

  test('wide viewBox (aspect > 1) yields width=size, height=size/aspect', () => {
    // viewBox 0 0 200 100 → aspect 2 → width=size, height=size/2
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect /></svg>';

    const result = ensureSVGDimensions(input, 512);
    const svg = parseSvg(result);

    expect(svg.getAttribute('width')).toBe('512');
    expect(svg.getAttribute('height')).toBe('256');
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
  });

  test('tall viewBox (aspect < 1) yields height=size, width=size*aspect', () => {
    // viewBox 0 0 100 200 → aspect 0.5 → height=size, width=size/2
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect /></svg>';

    const result = ensureSVGDimensions(input, 512);
    const svg = parseSvg(result);

    expect(svg.getAttribute('height')).toBe('512');
    expect(svg.getAttribute('width')).toBe('256');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 200');
  });

  test('SVG that already has width and height attributes is left untouched', () => {
    // viewBox is present and aspect would imply different output, but the
    // existing width/height MUST win — the function only fills in missing dims.
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="84" viewBox="0 0 200 100"><rect /></svg>';

    const result = ensureSVGDimensions(input, 512);
    const svg = parseSvg(result);

    expect(svg.getAttribute('width')).toBe('42');
    expect(svg.getAttribute('height')).toBe('84');
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
  });
});
