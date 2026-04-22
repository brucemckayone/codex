/**
 * OKLCH Color Space Math
 *
 * Pure TypeScript implementation of OKLCH ↔ sRGB conversion.
 * No external dependencies.
 *
 * Conversion chain:
 *   OKLCH → OKLab → linear-sRGB → sRGB (gamma)
 *   sRGB (gamma) → linear-sRGB → OKLab → OKLCH
 *
 * References:
 * - https://bottosson.github.io/posts/oklab/
 * - CSS Color Level 4 spec
 */

interface OklchColor {
  l: number; // Lightness: 0 (black) to 1 (white)
  c: number; // Chroma: 0 (gray) to ~0.4 (most saturated)
  h: number; // Hue: 0 to 360 degrees
}

interface SrgbColor {
  r: number; // 0-255
  g: number;
  b: number;
}

// ── OKLCH → sRGB ──────────────────────────────────────────────────────────

/** Convert OKLCH to OKLab. */
function oklchToOklab(
  l: number,
  c: number,
  h: number
): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  return [l, c * Math.cos(hRad), c * Math.sin(hRad)];
}

/** Convert OKLab to linear sRGB. */
function oklabToLinearSrgb(
  L: number,
  a: number,
  b: number
): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Apply sRGB gamma correction (linear → gamma). */
function linearToGamma(c: number): number {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Convert OKLCH to sRGB (0-255). Returns clamped values. */
export function oklchToSrgb(l: number, c: number, h: number): SrgbColor {
  const [L, a, b] = oklchToOklab(l, c, h);
  const [lr, lg, lb] = oklabToLinearSrgb(L, a, b);
  return {
    r: Math.round(Math.max(0, Math.min(255, linearToGamma(lr) * 255))),
    g: Math.round(Math.max(0, Math.min(255, linearToGamma(lg) * 255))),
    b: Math.round(Math.max(0, Math.min(255, linearToGamma(lb) * 255))),
  };
}

// ── sRGB → OKLCH ──────────────────────────────────────────────────────────

/** Remove sRGB gamma correction (gamma → linear). */
function gammaToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return ((c + 0.055) / 1.055) ** 2.4;
}

/** Convert linear sRGB to OKLab. */
function linearSrgbToOklab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** Convert sRGB (0-255) to OKLCH. */
function srgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = gammaToLinear(r / 255);
  const lg = gammaToLinear(g / 255);
  const lb = gammaToLinear(b / 255);

  const [L, a, ob] = linearSrgbToOklab(lr, lg, lb);
  const c = Math.sqrt(a * a + ob * ob);
  let h = (Math.atan2(ob, a) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c, h: c < 0.0001 ? 0 : h };
}

// ── Hex conversion ────────────────────────────────────────────────────────

/** Parse a hex color string to sRGB. Accepts #RGB, #RRGGBB. */
function hexToSrgb(hex: string): SrgbColor | null {
  const clean = hex.replace(/^#/, '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

/** Convert sRGB (0-255) to hex string. */
export function srgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Convert hex to OKLCH. */
export function hexToOklch(hex: string): OklchColor | null {
  const rgb = hexToSrgb(hex);
  if (!rgb) return null;
  return srgbToOklch(rgb.r, rgb.g, rgb.b);
}

/** Convert OKLCH to hex. Clamps to sRGB gamut. */
export function oklchToHex(l: number, c: number, h: number): string {
  const clamped = clampToGamut(l, c, h);
  const rgb = oklchToSrgb(clamped.l, clamped.c, clamped.h);
  return srgbToHex(rgb.r, rgb.g, rgb.b);
}

// ── Gamut mapping ─────────────────────────────────────────────────────────

/** Check if an OKLCH color is within the sRGB gamut. */
export function isInGamut(l: number, c: number, h: number): boolean {
  const [L, a, b] = oklchToOklab(l, c, h);
  const [lr, lg, lb] = oklabToLinearSrgb(L, a, b);
  const check = (v: number) => v >= -0.001 && v <= 1.001;
  return check(lr) && check(lg) && check(lb);
}

/**
 * Clamp an OKLCH color to the sRGB gamut by reducing chroma.
 * Uses binary search for efficiency (~10 iterations).
 */
export function clampToGamut(l: number, c: number, h: number): OklchColor {
  if (isInGamut(l, c, h)) return { l, c, h };

  let lo = 0;
  let hi = c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut(l, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { l, c: lo, h };
}

/**
 * Get the maximum chroma for a given lightness and hue within sRGB gamut.
 * Used to render the canvas boundary.
 */
export function maxChromaForLH(l: number, h: number): number {
  if (l <= 0 || l >= 1) return 0;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut(l, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
