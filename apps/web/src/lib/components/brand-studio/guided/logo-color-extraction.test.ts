/**
 * Brand-from-logo colour extraction (Codex-cijzb · WP-1.7).
 *
 * Two layers, tested independently of any real canvas:
 *   - `extractDominantColors` — the PURE quantiser, asserted against synthetic
 *     pixel buffers with known colours (deterministic → exact assertions).
 *   - `extractColorsFromLogo` — the glue state machine, with the DOM/canvas
 *     steps injected so the taint / load-error / no-logo branches are exercised
 *     without a canvas (real rasterisation is a WP-1.8 visual check).
 */
import { describe, expect, it } from 'vitest';
import {
  extractColorsFromLogo,
  extractDominantColors,
  type LogoExtractionDeps,
  type PixelData,
} from './logo-color-extraction';

/** Build a flat RGBA buffer from [r,g,b,a] tuples. */
function pixels(
  colors: Array<[number, number, number, number]>
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return data;
}

function repeat(
  color: [number, number, number, number],
  n: number
): Array<[number, number, number, number]> {
  return Array.from({ length: n }, () => color);
}

describe('extractDominantColors (pure)', () => {
  it('picks the dominant chromatic colour as the seed', () => {
    const data = pixels([
      ...repeat([255, 0, 0, 255], 10), // red mark
      ...repeat([255, 255, 255, 255], 3), // white background
    ]);
    const result = extractDominantColors(data);
    expect(result).not.toBeNull();
    expect(result?.seed).toBe('#ff0000');
    expect(result?.dominant).toContain('#ffffff');
  });

  it('prefers a saturated colour over a MORE frequent near-white (weighting, not raw count)', () => {
    // White is the majority here — a naive most-frequent picker would return it.
    // This assertion fails if the chroma/luminance weighting is wrong.
    const data = pixels([
      ...repeat([255, 255, 255, 255], 6), // white (majority)
      ...repeat([0, 0, 255, 255], 4), // blue (minority, brand-worthy)
    ]);
    const result = extractDominantColors(data);
    expect(result?.seed).toBe('#0000ff');
  });

  it('returns null when every pixel is transparent', () => {
    const data = pixels(repeat([255, 0, 0, 0], 8));
    expect(extractDominantColors(data)).toBeNull();
  });

  it('falls back to the dominant grey for an achromatic logo (never null/crash)', () => {
    const data = pixels(repeat([128, 128, 128, 255], 12));
    const result = extractDominantColors(data);
    expect(result?.seed).toBe('#808080');
  });

  it('accepts a PixelData object (the real ImageData shape)', () => {
    const source: PixelData = {
      data: pixels([
        ...repeat([0, 128, 0, 255], 5), // green
        ...repeat([255, 255, 255, 255], 2), // white
      ]),
      width: 7,
      height: 1,
    };
    const result = extractDominantColors(source);
    expect(result?.seed).toBe('#008000');
  });
});

describe('extractColorsFromLogo (glue state machine)', () => {
  const okDeps: LogoExtractionDeps = {
    loadImage: async () => document.createElement('img'),
    toImageData: () => ({
      data: pixels(repeat([200, 30, 30, 255], 8)),
      width: 8,
      height: 1,
    }),
  };

  it('returns no-logo when there is no logo URL', async () => {
    expect(await extractColorsFromLogo(null, {}, okDeps)).toEqual({
      status: 'no-logo',
    });
    expect(await extractColorsFromLogo('', {}, okDeps)).toEqual({
      status: 'no-logo',
    });
  });

  it('returns load-error when the image fails to load', async () => {
    const deps: LogoExtractionDeps = {
      loadImage: async () => {
        throw new Error('404');
      },
      toImageData: () => {
        throw new Error('toImageData should not run after a load failure');
      },
    };
    expect(await extractColorsFromLogo('https://cdn/x.png', {}, deps)).toEqual({
      status: 'load-error',
    });
  });

  it('degrades to tainted (never crashes) on a cross-origin tainted canvas', async () => {
    const deps: LogoExtractionDeps = {
      loadImage: async () => document.createElement('img'),
      toImageData: () => {
        // getImageData throws exactly this on a tainted canvas.
        throw new DOMException('tainted canvas', 'SecurityError');
      },
    };
    expect(
      await extractColorsFromLogo('https://no-cors-cdn/x.png', {}, deps)
    ).toEqual({
      status: 'tainted',
    });
  });

  it('returns load-error for a non-security rasterisation failure', async () => {
    const deps: LogoExtractionDeps = {
      loadImage: async () => document.createElement('img'),
      toImageData: () => {
        throw new Error('boom');
      },
    };
    expect(await extractColorsFromLogo('https://cdn/x.png', {}, deps)).toEqual({
      status: 'load-error',
    });
  });

  it('returns load-error when no 2D context is available', async () => {
    const deps: LogoExtractionDeps = {
      loadImage: async () => document.createElement('img'),
      toImageData: () => null,
    };
    expect(await extractColorsFromLogo('https://cdn/x.png', {}, deps)).toEqual({
      status: 'load-error',
    });
  });

  it('returns ok with a derived palette on success', async () => {
    const result = await extractColorsFromLogo(
      'https://cdn/logo.png',
      {},
      okDeps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.colors.seed).toMatch(/^#[0-9a-f]{6}$/);
      expect(result.colors.dominant.length).toBeGreaterThan(0);
      expect(result.colors.seed).toBe(result.colors.dominant[0]);
    }
  });
});
