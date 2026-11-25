/**
 * Reading an org's card style and its dials out of the branding
 * `tokenOverrides` map (Codex-7104r). Nothing on the server limits that map's
 * values, so these readers ARE the whitelist: an unknown style reads as
 * 'today', an unknown option as the dial's default, and a number is clamped
 * to the dial's range (whose minimum is the gallery's measured AA floor).
 *
 * Pure and dependency-light (only `@codex/validation` constants and the
 * registry), so the PUBLIC org layout bundle can import it.
 */
import {
  CARD_DIAL_KEY_PREFIX,
  CARD_STYLE_KEY,
  CARD_STYLES,
  type CardStyle,
  DEFAULT_CARD_STYLE,
} from '@codex/validation';
import {
  CARD_STYLE_REGISTRY,
  type CardDial,
  type ChoiceDial,
  type RangeDial,
} from './registry';

type Overrides = Readonly<Record<string, unknown>> | null | undefined;

function asMap(overrides: Overrides): Readonly<Record<string, unknown>> | null {
  // The layouts' JSON.parse hands on any JSON; only a plain object has keys.
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    return null;
  return overrides;
}

/**
 * The card style to draw from ONE overrides map. While the brand editor is
 * open the caller passes its pending map alone, as the WHOLE intended state:
 * a missing key there means 'today', never the saved value, or choosing Today
 * (which deletes the key) could not show until saved.
 */
export function resolveCardStyle(overrides: Overrides): CardStyle {
  const map = asMap(overrides);
  if (!map) return DEFAULT_CARD_STYLE;
  const value = map[CARD_STYLE_KEY];
  return CARD_STYLES.find((style) => style === value) ?? DEFAULT_CARD_STYLE;
}

/** The tokenOverrides key one style's dial is stored under. */
export function cardDialKey(style: CardStyle, dialId: string): string {
  return `${CARD_DIAL_KEY_PREFIX}${style}-${dialId}`;
}

/** A range dial's stored value, clamped; the default when it is not a number. */
export function readRangeDial(dial: RangeDial, raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n)) return dial.default;
  return Math.min(dial.max, Math.max(dial.min, n));
}

/** A choice dial's stored option id; the default when it is not one. */
export function readChoiceDial(dial: ChoiceDial, raw: unknown): string {
  return dial.options.some((o) => o.id === raw)
    ? (raw as string)
    : dial.default;
}

/** One dial's validated value: a number for a range, an option id otherwise. */
export function readDial(dial: CardDial, raw: unknown): number | string {
  return dial.kind === 'range'
    ? readRangeDial(dial, raw)
    : readChoiceDial(dial, raw);
}

/** The CSS a validated dial value writes, or null when it is the style's own. */
function dialCss(dial: CardDial, value: number | string): string | null {
  if (dial.kind === 'range') {
    return value === dial.default ? null : `${value}${dial.unit}`;
  }
  if (value === dial.default) return null;
  return dial.options.find((o) => o.id === value)?.css ?? null;
}

/**
 * The custom properties an org's dials set on every card in `style`: only the
 * dials it has moved off their default (the style's CSS declares the defaults
 * on `.sc` itself). StyledCard writes these INLINE on `article.sc`, which is
 * what lets them beat those declarations.
 */
export function cardStyleVars(
  style: CardStyle,
  overrides: Overrides
): Record<string, string> {
  const map = asMap(overrides);
  const vars: Record<string, string> = {};
  if (!map) return vars;
  for (const dial of CARD_STYLE_REGISTRY[style].dials) {
    const css = dialCss(dial, readDial(dial, map[cardDialKey(style, dial.id)]));
    if (css !== null) vars[dial.prop] = css;
  }
  return vars;
}
