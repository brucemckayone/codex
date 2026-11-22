/**
 * The brand editor's writes of the shader stack's keys (Codex-1yd58 WP-9),
 * kept out of `BrandEditorHeroCombine.svelte` so the rules are tested without
 * mounting it, as `hero-fx-helpers.ts` keeps the preset grid's.
 *
 * - A value at its default is REMOVED (null), so the JSON holds only what the
 *   org changed, and a better default later reaches everyone who never
 *   touched it (the Effects panel's rule).
 * - On the Dark theme over a light value, the default is written OUT instead:
 *   a removed dark key falls back to the light one, so "no second" or "no
 *   layers" on Dark would otherwise still draw the light theme's.
 * - "None" as the second takes its blend and strength with it.
 * - The layers token keeps what the stack skips but the token holds (a
 *   retired layer), so nothing is dropped unseen; a repeat is merged away.
 *   An untouched layer keeps its stored text.
 * - A layers token longer than the save allows is never written: the page
 *   would drop the whole key and the save refuse it. The editor asks
 *   `layersFit` first, and says the list is too long.
 */
import { TOKEN_OVERRIDE_VALUE_MAX } from '@codex/validation';
import { BLEND_AMOUNTS } from '$lib/components/ui/ShaderHero/compositor/effects/amounts';
import {
  type BlendId,
  type BrandFrameId,
  PASSTHROUGH_FRAME,
} from '$lib/components/ui/ShaderHero/compositor/effects/ids';
import {
  BARE_STACK,
  type EditedLayer,
  formatAmount,
  type LayerItem,
  NO_LAYERS,
  type StackTokenKey,
  serialiseLayers,
} from '$lib/components/ui/ShaderHero/compositor/stack-config';
import type { SetOverride } from './hero-fx-helpers';

/** An item the stack skips that the token keeps (not a repeat). */
export type KeptLayerItem = Extract<LayerItem, { kind: 'skipped' }>;

/** The layers token for the drawn layers in order, then the kept items. */
function layersText(
  layers: readonly EditedLayer[],
  kept: readonly KeptLayerItem[]
): string | null {
  const parts = [serialiseLayers(layers), ...kept.map((item) => item.text)];
  const text = parts.filter((part): part is string => !!part).join(',');
  return text || null;
}

/** Whether that token is short enough for the save to keep. */
export function layersFit(
  layers: readonly EditedLayer[],
  kept: readonly KeptLayerItem[]
): boolean {
  return (layersText(layers, kept)?.length ?? 0) <= TOKEN_OVERRIDE_VALUE_MAX;
}

export interface StackWriterDeps {
  /** `brandEditor.setThemeTokenOverride`: the editing theme's bucket. */
  readonly setOverride: SetOverride;
  /** Whether the Dark theme is being edited. */
  readonly onDark: () => boolean;
  /** The light theme's stored value of `key`, or null. */
  readonly lightValue: (key: StackTokenKey) => string | null;
  /** The blend in force, for its own strength. */
  readonly blend: () => BlendId;
}

export interface StackWriter {
  /** A second preset, or null for none (its blend keys go with it). */
  second(id: string | null): void;
  /** A blend; it starts at its own strength. */
  blend(id: BlendId): void;
  blendAmount(amount: number): void;
  /**
   * The drawn layers in order, and the skipped items the token keeps. False,
   * and nothing written, when the token would not fit (`layersFit`).
   */
  layers(
    layers: readonly EditedLayer[],
    kept: readonly KeptLayerItem[]
  ): boolean;
  frame(id: BrandFrameId): void;
}

export function createStackWriter(deps: StackWriterDeps): StackWriter {
  /** What `key` reads written out in full, for Dark over a light value. */
  function explicitDefault(key: StackTokenKey, blend: BlendId): string {
    switch (key) {
      case 'shader-second':
        return 'none';
      case 'shader-blend':
        return BARE_STACK.blend;
      case 'shader-blend-amount':
        return formatAmount(BLEND_AMOUNTS[blend]);
      case 'shader-layers':
        return NO_LAYERS;
      case 'shader-frame':
        return PASSTHROUGH_FRAME;
    }
  }

  /**
   * Write `key`; null is its default: removed, or written out on Dark. The
   * blend names whose strength a default amount is (a new blend's own).
   */
  function put(
    key: StackTokenKey,
    value: string | null,
    blend: BlendId = deps.blend()
  ): void {
    const outright =
      value ??
      (deps.onDark() && deps.lightValue(key) !== null
        ? explicitDefault(key, blend)
        : null);
    deps.setOverride(key, outright);
  }

  return {
    second(id) {
      if (id === null || id === 'none') {
        put('shader-second', null);
        put('shader-blend', null);
        put('shader-blend-amount', null);
        return;
      }
      put('shader-second', id);
    },
    blend(id) {
      put('shader-blend', id === BARE_STACK.blend ? null : id);
      put('shader-blend-amount', null, id);
    },
    blendAmount(amount) {
      put(
        'shader-blend-amount',
        amount === BLEND_AMOUNTS[deps.blend()] ? null : formatAmount(amount)
      );
    },
    layers(layers, kept) {
      if (!layersFit(layers, kept)) return false;
      put('shader-layers', layersText(layers, kept));
      return true;
    },
    frame(id) {
      put('shader-frame', id === PASSTHROUGH_FRAME ? null : id);
    },
  };
}
