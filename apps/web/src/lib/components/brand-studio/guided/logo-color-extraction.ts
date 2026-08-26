/**
 * Brand-from-logo colour extraction (Codex-cijzb · WP-1.7 · Guided mode).
 *
 * The ONLY new colour code in Guided mode — presets and seed→palette both
 * reuse existing machinery (`BRAND_PRESETS` + `applyPreset`, and
 * `generateFullPalettes`). Here we pull a usable brand *seed* out of the org's
 * uploaded logo so "From logo" can hand that seed to the same palette
 * generator every other path uses.
 *
 * Two deliberately-separated layers:
 *   1. `extractDominantColors` — a PURE function (`PixelData | Uint8ClampedArray
 *      -> palette`). No DOM, no canvas: unit-testable against a synthetic pixel
 *      buffer with known colours.
 *   2. `extractColorsFromLogo` — the DOM/canvas GLUE (load <img>, draw to an
 *      offscreen canvas, `getImageData`). Its side-effecting steps are injected
 *      via `LogoExtractionDeps` so the taint / load-error / no-logo branches are
 *      testable WITHOUT a real canvas (real rasterisation is verified visually
 *      in WP-1.8).
 *
 * CORS / tainted-canvas safety: the logo is loaded with `crossOrigin =
 * 'anonymous'` (mirrors `ShaderHero/logo-texture.ts`, which already reads the
 * same CDN into a WebGL texture — a taint-sensitive op — so the CDN serves the
 * needed `Access-Control-Allow-Origin`). If a logo is ever served without CORS
 * headers, `getImageData` throws a `SecurityError` on the tainted canvas; we
 * catch it and degrade to a disabled feature with an explanation — never crash,
 * never silently no-op.
 */

/** A brand palette derived from a logo. `seed` is `dominant[0]`. */
export interface ExtractedColors {
  /** The chosen brand seed (most "brand-worthy" dominant colour), 6-digit hex. */
  seed: string;
  /** Ordered dominant colours (most→least brand-worthy), 6-digit hex; seed first. */
  dominant: string[];
}

/** Result of a logo-extraction attempt — a discriminated union of every outcome. */
export type LogoExtraction =
  | { status: 'ok'; colors: ExtractedColors }
  /** No logo uploaded — the feature is unavailable, not broken. */
  | { status: 'no-logo' }
  /** The image failed to load/decode (network, 404, dimensionless SVG…). */
  | { status: 'load-error' }
  /** Cross-origin image without CORS headers — canvas tainted, pixels unreadable. */
  | { status: 'tainted' };

export interface ExtractOptions {
  /** Sample every Nth pixel (>=1). Higher = faster, coarser. Default 1. */
  sampleStep?: number;
  /** Max colours to return in `dominant`. Default 6. */
  maxColors?: number;
  /** Alpha below this (0-255) is treated as transparent and skipped. Default 128. */
  alphaThreshold?: number;
  /** Bits kept per channel when bucketing (1-8). Default 4 → 16 levels/channel. */
  quantBits?: number;
}

/**
 * Minimal structural shape of the pixel data we read. `ImageData` is assignable
 * to this (it has `data`/`width`/`height`), so browser callers pass the real
 * `getImageData()` result and tests pass a plain literal — no `ImageData`
 * constructor needed in Node.
 */
export interface PixelData {
  readonly data: Uint8ClampedArray;
  readonly width?: number;
  readonly height?: number;
}

const DEFAULTS = {
  sampleStep: 1,
  maxColors: 6,
  alphaThreshold: 128,
  quantBits: 4,
} as const;

/** Largest working-canvas dimension — a histogram needs only a small sample. */
const MAX_SAMPLE_DIM = 128;

/** Min squared RGB distance between two colours kept in the `dominant` list. */
const DEDUPE_DISTANCE_SQ = 40 * 40;

function toPixels(source: Uint8ClampedArray | PixelData): Uint8ClampedArray {
  return source instanceof Uint8ClampedArray ? source : source.data;
}

function clampByte(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * "Brand-worthiness" score for a colour bucket. Rewards frequency and chroma
 * (a saturated colour is a better brand seed than a grey), and penalises the
 * luminance extremes that are usually noise rather than identity:
 *   - near-white (>0.94): almost always the logo's background/paper → heavy cut.
 *   - near-black (<0.06): often the mark/type → mild cut, still eligible.
 * The `0.12` chroma floor keeps low-saturation brands (muted navy, olive) in the
 * running so an all-but-greyscale logo still yields its darkest mark rather than
 * collapsing to nothing.
 */
function brandScore(r: number, g: number, b: number, count: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = (max - min) / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  let luminanceWeight = 1;
  if (luminance > 0.94) luminanceWeight = 0.03;
  else if (luminance < 0.06) luminanceWeight = 0.35;

  return count * (0.12 + chroma) * luminanceWeight;
}

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * PURE. Quantise an RGBA pixel buffer into a colour histogram, then rank the
 * buckets by brand-worthiness. Returns the top colours (deduped by RGB
 * distance) with the winner as `seed`, or `null` when there are no usable
 * (non-transparent) pixels.
 *
 * Deterministic — same pixels always yield the same palette — so it can be
 * asserted exactly in tests.
 */
export function extractDominantColors(
  source: Uint8ClampedArray | PixelData,
  options: ExtractOptions = {}
): ExtractedColors | null {
  const sampleStep = Math.max(
    1,
    Math.floor(options.sampleStep ?? DEFAULTS.sampleStep)
  );
  const maxColors = Math.max(
    1,
    Math.floor(options.maxColors ?? DEFAULTS.maxColors)
  );
  const alphaThreshold = options.alphaThreshold ?? DEFAULTS.alphaThreshold;
  const quantBits = Math.min(
    8,
    Math.max(1, options.quantBits ?? DEFAULTS.quantBits)
  );

  const px = toPixels(source);
  const shift = 8 - quantBits;
  const stride = 4 * sampleStep;

  // Accumulate a sum of true RGB per quantised bucket so the reported colour is
  // the bucket's average (more faithful than the bucket-centre value).
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i + 3 < px.length; i += stride) {
    const a = px[i + 3];
    if (a < alphaThreshold) continue;

    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];

    const key =
      ((r >> shift) << (quantBits * 2)) |
      ((g >> shift) << quantBits) |
      (b >> shift);

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  if (buckets.size === 0) return null;

  const scored = Array.from(buckets.values()).map((bucket) => {
    const r = bucket.r / bucket.count;
    const g = bucket.g / bucket.count;
    const b = bucket.b / bucket.count;
    return { r, g, b, score: brandScore(r, g, b, bucket.count) };
  });

  scored.sort((a, b) => b.score - a.score);

  // Walk the ranked buckets, keeping colours that are visually distinct from
  // those already chosen, until we have `maxColors`.
  const dominant: string[] = [];
  const picked: Array<{ r: number; g: number; b: number }> = [];
  for (const entry of scored) {
    const isDistinct = picked.every((p) => {
      const dr = p.r - entry.r;
      const dg = p.g - entry.g;
      const db = p.b - entry.b;
      return dr * dr + dg * dg + db * db >= DEDUPE_DISTANCE_SQ;
    });
    if (!isDistinct) continue;
    picked.push({ r: entry.r, g: entry.g, b: entry.b });
    dominant.push(rgbToHex(entry.r, entry.g, entry.b));
    if (dominant.length >= maxColors) break;
  }

  return { seed: dominant[0], dominant };
}

/**
 * Side-effecting steps of logo extraction, injected so the state machine in
 * `extractColorsFromLogo` is testable without a real DOM/canvas.
 */
export interface LogoExtractionDeps {
  /** Resolve with a loaded image element; reject on network/decode failure. */
  loadImage(url: string): Promise<HTMLImageElement>;
  /**
   * Rasterise the image and read its pixels. MUST throw a `SecurityError`
   * (`DOMException`) when the canvas is tainted by a cross-origin image without
   * CORS headers. Returns `null` when a 2D context is unavailable
   * (privacy-hardened browsers), which callers treat as "cannot extract".
   */
  toImageData(image: HTMLImageElement): PixelData | null;
}

function defaultLoadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    // Ask the CDN for CORS-approved pixels. Without this the canvas taints and
    // getImageData throws; with it (and the CDN's ACAO header) pixels are
    // readable — the same contract ShaderHero/logo-texture.ts relies on.
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('logo image failed to load'));
    el.src = url;
  });
}

function defaultToImageData(image: HTMLImageElement): PixelData | null {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  // Dimensionless (e.g. an SVG with no intrinsic size) → nothing to sample.
  if (!w || !h) return null;

  // Downscale into a small working canvas — a histogram doesn't need full res.
  const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, cw, ch);
  // Throws SecurityError (DOMException) if the canvas is tainted.
  return ctx.getImageData(0, 0, cw, ch);
}

const defaultDeps: LogoExtractionDeps = {
  loadImage: defaultLoadImage,
  toImageData: defaultToImageData,
};

/** Read `name` off an unknown thrown value without unsafe casts. */
function errorName(err: unknown): string | undefined {
  if (err instanceof DOMException || err instanceof Error) return err.name;
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = err.name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/**
 * Orchestrate logo → palette, mapping every failure mode to an explicit status
 * so the UI can explain itself instead of silently doing nothing:
 *   - `no-logo`     — nothing uploaded yet.
 *   - `load-error`  — image didn't load/decode, or held no usable pixels.
 *   - `tainted`     — cross-origin logo without CORS → canvas unreadable.
 *   - `ok`          — a palette was derived.
 */
export async function extractColorsFromLogo(
  logoUrl: string | null | undefined,
  options: ExtractOptions = {},
  deps: LogoExtractionDeps = defaultDeps
): Promise<LogoExtraction> {
  if (!logoUrl) return { status: 'no-logo' };

  let image: HTMLImageElement;
  try {
    image = await deps.loadImage(logoUrl);
  } catch {
    return { status: 'load-error' };
  }

  let pixels: PixelData | null;
  try {
    pixels = deps.toImageData(image);
  } catch (err) {
    if (errorName(err) === 'SecurityError') return { status: 'tainted' };
    return { status: 'load-error' };
  }

  if (!pixels) return { status: 'load-error' };

  const colors = extractDominantColors(pixels, options);
  if (!colors) return { status: 'load-error' };

  return { status: 'ok', colors };
}
