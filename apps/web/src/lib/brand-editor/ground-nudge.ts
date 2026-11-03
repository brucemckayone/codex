/**
 * The nudge org-brand.css gives a link, focus outline or focus halo, in
 * TypeScript, so the brand studio can say what it moved (Codex-mik4h).
 *
 * The owner chose "Adjust it, say so": keep the colour's hue and move it in
 * LINEAR light only as far as it needs to read on the page ground, the page
 * kit's move (`schemes.css`, "moved only as far as each floor needs"):
 *   - on a light ground (luminance at or above the 0.1791 pivot) the colour
 *     is darkened, its linear channels scaled down to the target luminance;
 *   - on a dark ground it is lightened, scaled up (each channel capped at 1)
 *     and then mixed toward white for whatever the cap left short.
 * A colour that already holds is drawn exactly. The target sits 2% past the
 * floor (4.5:1 text, 3:1 marks), as the kit's do, so an 8-bit rounding never
 * lands under it.
 *
 * This mirrors the stylesheet's fragments term for term, including their
 * linearisation (`pow((c + 0.055) / 1.055, 2.4)`, no low segment); the pin
 * test checks the constants against org-brand.css. A leaf on `ink.ts`.
 */
import { relativeLuminance, TEXT_ON_BRAND_LUMINANCE_PIVOT } from './ink';

/** 4.5:1 for text, plus the kit's 2%. */
export const LINK_FLOOR = 4.59;
/** 3:1 for a focus indicator (WCAG 1.4.11), plus 2%. */
export const MARK_FLOOR = 3.06;

type Channels = [number, number, number];

const linear = (c: number) =>
  ((Math.min(255, Math.max(0, c)) / 255 + 0.055) / 1.055) ** 2.4;
const encode = (c: number) =>
  Math.max(0, 255 * (1.055 * c ** (1 / 2.4) - 0.055));
const luminance = ([r, g, b]: Channels) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG contrast between two relative luminances. */
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The luminance a colour must reach on a ground: at most this on a light
 * ground, at least this on a dark one.
 */
export function targetLuminance(groundY: number, floor: number) {
  const lighten = groundY < TEXT_ON_BRAND_LUMINANCE_PIVOT;
  const target = lighten
    ? Math.min(1, floor * (groundY + 0.05) - 0.05)
    : Math.max(0, (groundY + 0.05) / floor - 0.05);
  return { target, lighten };
}

function parse(hex: string): Channels | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: Channels) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export interface Nudge {
  /** The colour the page paints, as #RRGGBB. */
  hex: string;
  /** WCAG contrast against the ground, as picked and as painted. */
  before: number;
  after: number;
  moved: boolean;
  /** Which way it moved (or would have). */
  lighten: boolean;
}

/** What the stylesheet paints for `hex` on a ground of luminance `groundY`. */
export function nudgeForGround(
  hex: string,
  groundY: number,
  floor: number
): Nudge | null {
  const rgb = parse(hex);
  if (!rgb) return null;
  const lin = rgb.map(linear) as Channels;
  const y = luminance(lin);
  const { target, lighten } = targetLuminance(groundY, floor);

  let out: Channels;
  if (lighten) {
    const scale = Math.max(1, target / Math.max(y, 1e-6));
    const capped = lin.map((c) => Math.min(1, c * scale)) as Channels;
    const yCapped = luminance(capped);
    const toWhite = Math.max(
      0,
      (target - yCapped) / Math.max(1 - yCapped, 1e-6)
    );
    out = capped.map((c) => encode(c + toWhite * (1 - c))) as Channels;
  } else {
    const scale = Math.min(1, target / Math.max(y, 1e-6));
    out = lin.map((c) => encode(c * scale)) as Channels;
  }

  const painted = toHex(out);
  const moved = out.some((v, i) => Math.round(v) !== rgb[i]);
  return {
    hex: painted,
    before: ratio(relativeLuminance(hex) ?? y, groundY),
    after: ratio(relativeLuminance(painted) ?? y, groundY),
    moved,
    lighten,
  };
}
