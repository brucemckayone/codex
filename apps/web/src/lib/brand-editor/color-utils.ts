/**
 * Brand Editor Color Utilities
 *
 * Lightweight colour helpers used across brand editor level components.
 * Heavier OKLCH math lives in `./oklch-math.ts` — this module is for
 * format conversions that are plain RGB/HSL.
 */

/**
 * Convert a 6-digit hex colour to the space-delimited `H S% L%` string
 * used by the shadow token system (e.g. `--shadow-color: 220 10% 15%`).
 *
 * The shadow token syntax intentionally omits the `hsl()` wrapper so it
 * can be composed into `hsl(var(--shadow-color) / 0.2)` at the consumer.
 *
 * @param hex - 6-digit hex string starting with `#` (e.g. `#26262A`)
 * @returns HSL string formatted as `H S% L%` with integer components.
 *          Returns `0 0% 0%` if the input is malformed.
 */
export function hexToHslString(hex: string): string {
  if (!hex || hex.length < 7) return '0 0% 0%';

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return '0 0% 0%';
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
