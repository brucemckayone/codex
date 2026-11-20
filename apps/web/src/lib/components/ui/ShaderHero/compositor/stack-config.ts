/**
 * The brand's shader STACK (Codex-1yd58.4, plan §5.8), read from its CSS
 * custom properties as `shader-config.ts` reads the base preset's:
 *
 *   --brand-shader-second        a second preset id (through `resolvePresetId`)
 *   --brand-shader-blend         how it meets the base: mix | screen |
 *                                multiply | difference | smoke-key
 *   --brand-shader-blend-amount  0-1
 *   --brand-shader-layers        passes in order, `id:amount` (plan §3; the
 *                                amount optional, and `id amount` read
 *                                too), comma separated: `grain:0.4, halftone`
 *   --brand-shader-frame         shader-only | through-name | name-glows
 *
 * each with a `-dark` twin the dark theme prefers, as every shader key has.
 *
 * Anything it cannot use is dropped, never an error: an unknown or repeated
 * second (the base itself) means no second, an unknown layer is skipped (and
 * logged once, so a typo or a cut layer never draws the bare base unseen), a
 * repeated layer keeps its first place and amount (also logged once: each
 * layer is a full pass, so a stack is at most six DISTINCT ones), an
 * unknown blend or frame is the default, amounts are clamped to 0-1. A stack
 * that comes out as the base alone is BARE (`isBareStack`), and a bare stack
 * takes today's path: no compositor, no framebuffer, the canvas at today's
 * size.
 *
 * Its own file, not `shader-config.ts`, and it reads ids only (`effects/ids`),
 * so a bare stack's hero loads none of the compositor or its GLSL.
 */
import { logger } from '$lib/observability';
import {
  type LivePresetId,
  presetIsUnknown,
  resolvePresetId,
  type ShaderPresetId,
  shaderIsDark,
  warnUnknownPreset,
} from '../shader-config';
import { LAYER_AMOUNTS } from './effects/amounts';
import {
  type BlendId,
  type FrameId,
  isBlendId,
  isFrameId,
  isLayerId,
  type LayerId,
  PASSTHROUGH_FRAME,
  SURFACE_ONLY_LAYER_IDS,
} from './effects/ids';

/** The five brand keys a stack is read from (each also `-dark`). */
export const STACK_TOKEN_KEYS = [
  'shader-second',
  'shader-blend',
  'shader-blend-amount',
  'shader-layers',
  'shader-frame',
] as const;
export type StackTokenKey = (typeof STACK_TOKEN_KEYS)[number];

/** Layers past this many are dropped: each is a full-scene pass. */
export const MAX_LAYERS = 6;

export interface StackLayer {
  readonly id: LayerId;
  /** 0-1, or null for the layer's own default. */
  readonly amount: number | null;
}

export interface StackConfig {
  /** The second preset, never the base itself. */
  readonly second: LivePresetId | null;
  readonly blend: BlendId;
  /** 0-1, or null for the blend's own default. */
  readonly blendAmount: number | null;
  readonly layers: readonly StackLayer[];
  readonly frame: FrameId;
}

/** The lab's own defaults (WP-1b): screen, no layers, shader only. */
export const BARE_STACK: StackConfig = Object.freeze({
  second: null,
  blend: 'screen',
  blendAmount: null,
  layers: Object.freeze([]),
  frame: PASSTHROUGH_FRAME,
});

/** The base alone: nothing for a compositor to do. */
export function isBareStack(stack: StackConfig): boolean {
  return (
    stack.second === null &&
    stack.layers.length === 0 &&
    stack.frame === PASSTHROUGH_FRAME
  );
}

/**
 * Whether the hero needs a compositor (owner, 2026-11-19): for a stack that
 * is more than its base, or for a film to show (WP-5's Showreel). A film
 * plays even with no base preset, on a plain ground of the brand's
 * background. With neither, today's path: the base alone, or, with no base,
 * nothing at all. A stack over no base draws nothing without a film.
 */
export function needsCompositor(
  stack: StackConfig,
  base: ShaderPresetId,
  hasMedia: boolean
): boolean {
  if (hasMedia) return true;
  return base !== 'none' && !isBareStack(stack);
}

/** A number clamped to 0-1, or null when the text is not one. */
function amountOf(text: string | undefined | null): number | null {
  if (text == null || text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Why a layer item was skipped, as `shader.unknown_layer` reports it. */
export type SkippedLayerReason =
  | 'unknown'
  | 'surface-only'
  | 'repeat'
  | 'over-cap';

/**
 * The most skip lines a session logs: a token of junk would otherwise log one
 * per distinct item for every visitor (a 199-character one, 70). The first
 * few say the token is wrong; the rest say nothing new.
 */
const MAX_SKIP_WARNINGS = MAX_LAYERS;

/** `${reason}:${id}` pairs logged this session: the poll reads ~2x a second. */
const warnedLayers = new Set<string>();

/**
 * Log, once per id and reason per session and at most `MAX_SKIP_WARNINGS`
 * times, a layer item the stack skips (`shader.unknown_layer`), as
 * `warnUnknownPreset` logs a preset's, in production too. The reason tells a
 * stale, cut or mistyped id (`unknown`) from a layer only the Showreel's
 * surface runs (`surface-only`), one already in the stack (`repeat`) and one
 * past the cap (`over-cap`). Without the line the hero draws something the
 * token did not say and nobody learns why. The parse runs on the config
 * poll, never in the render loop.
 */
function warnSkippedLayer(id: string, reason: SkippedLayerReason): void {
  const key = `${reason}:${id}`;
  if (warnedLayers.has(key) || warnedLayers.size >= MAX_SKIP_WARNINGS) return;
  warnedLayers.add(key);
  logger.warn('shader.unknown_layer', { id, where: 'brand', reason });
}

/**
 * A layers token of `none` is an explicit empty list: the dark theme's way to
 * say "no layers" over a light theme that has some (an absent dark key falls
 * back to the light one).
 */
export const NO_LAYERS = 'none';

/**
 * A layer as the editor writes it back: `text` is the item as the token held
 * it, kept while the layer is untouched, so an edit of one layer never
 * rewrites another (`grain:0.125` stays, never `grain:0.13`).
 */
export interface EditedLayer extends StackLayer {
  readonly text?: string;
}

/** One item of a layers token, as the stack judges it. */
export type LayerItem =
  | {
      readonly kind: 'layer';
      readonly id: LayerId;
      /** 0-1, or null for the layer's own default. */
      readonly amount: number | null;
      /** The item as the token holds it (trimmed, lower case). */
      readonly text: string;
    }
  | {
      readonly kind: 'skipped';
      readonly id: string;
      readonly reason: SkippedLayerReason;
      /** The item as the token holds it (trimmed, lower case). */
      readonly text: string;
    };

/**
 * Every item of a layers token in order, judged as the stack reads it:
 * `id:amount` or `id amount`, comma separated, the amount optional. A
 * repeated id is skipped before it takes a place, so the cap counts distinct
 * layers (`glow, glow, ink` is two passes, not three), and a layer that would
 * run past the cap is skipped too, never cut off unseen. PURE: the brand
 * editor reads a token with it (a retired layer shows as a row) without the
 * log lines `parseStack` writes.
 */
export function readLayerItems(text: string | null): LayerItem[] {
  const items: LayerItem[] = [];
  const taken = new Set<string>();
  for (const raw of (text ?? '').split(',')) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    const [id, amount] = item.split(/[\s:]+/);
    // An item with no id is unset, not unknown, and `none` says so outright.
    if (!id || id === NO_LAYERS) continue;
    const skip = (reason: SkippedLayerReason) =>
      items.push({ kind: 'skipped', id, reason, text: item });
    if (!isLayerId(id)) skip('unknown');
    else if (SURFACE_ONLY_LAYER_IDS.includes(id)) skip('surface-only');
    else if (taken.has(id)) skip('repeat');
    else if (taken.size === MAX_LAYERS) skip('over-cap');
    else {
      taken.add(id);
      items.push({ kind: 'layer', id, amount: amountOf(amount), text: item });
    }
  }
  return items;
}

/** An amount as a token writes it: clamped to 0-1, at most two decimals. */
export function formatAmount(amount: number): string {
  return String(Math.round(Math.min(1, Math.max(0, amount)) * 100) / 100);
}

/**
 * The layers token for `layers`, in order: a layer's stored `text` while it
 * is untouched, else `id` at the layer's own strength (null, or equal to
 * `LAYER_AMOUNTS`), else `id:amount`. Null for no layers, so the key is
 * removed. `readLayerItems` reads it back to the same layers.
 */
export function serialiseLayers(layers: readonly EditedLayer[]): string | null {
  if (layers.length === 0) return null;
  return layers
    .map(
      ({ id, amount, text }) =>
        text ??
        (amount === null || amount === LAYER_AMOUNTS[id]
          ? id
          : `${id}:${formatAmount(amount)}`)
    )
    .join(',');
}

/** The stack and every layer item, as `readStack` reads them. */
export interface StackReading {
  readonly stack: StackConfig;
  readonly items: readonly LayerItem[];
}

/**
 * The stack the tokens describe over `base`, and every layer item as it was
 * judged. `read` returns a key's raw value, or null when unset. PURE: the
 * brand editor reads with this; the hero reads with `parseStack`, which logs.
 */
export function readStack(
  read: (key: StackTokenKey) => string | null,
  base: ShaderPresetId
): StackReading {
  const resolved = resolvePresetId(read('shader-second'));
  const second =
    base !== 'none' &&
    resolved !== null &&
    resolved !== 'none' &&
    resolved !== base
      ? resolved
      : null;
  const blend = read('shader-blend')?.toLowerCase() ?? '';
  const frame = read('shader-frame')?.toLowerCase() ?? '';
  const items = readLayerItems(read('shader-layers'));
  const layers: StackLayer[] = [];
  for (const item of items) {
    if (item.kind === 'layer')
      layers.push({ id: item.id, amount: item.amount });
  }
  return {
    stack: {
      second,
      blend: isBlendId(blend) ? blend : BARE_STACK.blend,
      blendAmount: amountOf(read('shader-blend-amount')),
      layers,
      frame: isFrameId(frame) ? frame : BARE_STACK.frame,
    },
    items,
  };
}

/**
 * The stack the tokens describe over `base`, as `readStack` reads it, but for
 * two log lines, each once per id per session: a second id that names no
 * preset (`shader.unknown_preset`, as the base's is) and a layer item the
 * stack skips (`shader.unknown_layer`, with its reason: unknown,
 * surface-only, a repeat or over the cap).
 */
export function parseStack(
  read: (key: StackTokenKey) => string | null,
  base: ShaderPresetId
): StackConfig {
  const secondRaw = read('shader-second');
  if (secondRaw && presetIsUnknown(secondRaw)) {
    warnUnknownPreset(secondRaw, 'brand');
  }
  const { stack, items } = readStack(read, base);
  for (const item of items) {
    if (item.kind === 'skipped') warnSkippedLayer(item.id, item.reason);
  }
  return stack;
}

/** `readBrandVar` (shader-config.ts): the `-dark` value first when dark. */
function brandVar(
  style: CSSStyleDeclaration,
  key: string,
  isDark: boolean
): string | null {
  if (isDark) {
    const dark = style.getPropertyValue(`--brand-${key}-dark`).trim();
    if (dark) return dark;
  }
  return style.getPropertyValue(`--brand-${key}`).trim() || null;
}

/**
 * The brand's stack over `base`, from the org layout (or `el`). No layout,
 * no stack: bare.
 */
export function getStackConfig(
  el: Element | null | undefined,
  base: ShaderPresetId
): StackConfig {
  const layout = el ?? document.querySelector('.org-layout');
  if (!layout) return BARE_STACK;
  const style = getComputedStyle(layout);
  const isDark = shaderIsDark(style);
  return parseStack((key) => brandVar(style, key, isDark), base);
}

/** Two stacks that draw the same picture have the same key. */
export function stackKey(stack: StackConfig): string {
  return JSON.stringify(stack);
}
