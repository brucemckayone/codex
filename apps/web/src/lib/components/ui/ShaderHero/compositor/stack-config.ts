/**
 * The brand's shader STACK (Codex-1yd58.4, plan §5.8), read from its CSS
 * custom properties as `shader-config.ts` reads the base preset's:
 *
 *   --brand-shader-second        a second preset id (through `resolvePresetId`)
 *   --brand-shader-blend         how it meets the base: mix | screen |
 *                                multiply | difference | smoke-key
 *   --brand-shader-blend-amount  0-1
 *   --brand-shader-layers        passes in order, `id [amount]`, comma
 *                                separated: `grain 0.4, halftone`
 *   --brand-shader-frame         shader-only | through-name | name-glows
 *
 * each with a `-dark` twin the dark theme prefers, as every shader key has.
 *
 * Anything it cannot use is dropped, never an error: an unknown or repeated
 * second (the base itself) means no second, an unknown layer is skipped, an
 * unknown blend or frame is the default, amounts are clamped to 0-1. A stack
 * that comes out as the base alone is BARE (`isBareStack`), and a bare stack
 * takes today's path: no compositor, no framebuffer, the canvas at today's
 * size.
 *
 * Its own file, not `shader-config.ts`, and it reads ids only (`effects/ids`),
 * so a bare stack's hero loads none of the compositor or its GLSL.
 */
import {
  type LivePresetId,
  presetIsUnknown,
  resolvePresetId,
  type ShaderPresetId,
  shaderIsDark,
  warnUnknownPreset,
} from '../shader-config';
import {
  type BlendId,
  type FrameId,
  isBlendId,
  isFrameId,
  isLayerId,
  type LayerId,
  PASSTHROUGH_FRAME,
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

function parseLayers(text: string | null): StackLayer[] {
  const layers: StackLayer[] = [];
  for (const item of (text ?? '').split(',')) {
    const [id, amount] = item.trim().toLowerCase().split(/\s+/);
    if (!id || !isLayerId(id)) continue;
    layers.push({ id, amount: amountOf(amount) });
    if (layers.length === MAX_LAYERS) break;
  }
  return layers;
}

/**
 * The stack the tokens describe over `base`. `read` returns a key's raw
 * value, or null when unset. PURE but for one log line: a second id that
 * names no preset is logged once (`shader.unknown_preset`), as the base's is.
 */
export function parseStack(
  read: (key: StackTokenKey) => string | null,
  base: ShaderPresetId
): StackConfig {
  const secondRaw = read('shader-second');
  if (secondRaw && presetIsUnknown(secondRaw)) {
    warnUnknownPreset(secondRaw, 'brand');
  }
  const resolved = resolvePresetId(secondRaw);
  const second =
    base !== 'none' &&
    resolved !== null &&
    resolved !== 'none' &&
    resolved !== base
      ? resolved
      : null;
  const blend = read('shader-blend')?.toLowerCase() ?? '';
  const frame = read('shader-frame')?.toLowerCase() ?? '';
  return {
    second,
    blend: isBlendId(blend) ? blend : BARE_STACK.blend,
    blendAmount: amountOf(read('shader-blend-amount')),
    layers: parseLayers(read('shader-layers')),
    frame: isFrameId(frame) ? frame : BARE_STACK.frame,
  };
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
