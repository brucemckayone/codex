<!--
  @component BrandEditorHeroCombine

  Hero › Effects › Combine (Codex-1yd58 WP-9): build on the base preset with a
  second preset and how the two meet, up to six finishing layers in drawn
  order, and a frame. Every hero composition draws it.

  It reads the stack as the hero does (`readStack`, which logs nothing) and
  writes the five `shader-*` stack keys through `setThemeTokenOverride`, as
  the preset grid writes `shader-preset`: editing Dark lands in
  darkTokenOverrides, read as the `-dark` twins. A value at its default is
  removed, so the JSON holds only what the org changed; on Dark, over a light
  value, the default is written out (`none`), since a removed dark key would
  fall back to the light one.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { brandEditor, previewResolved } from '$lib/brand-editor';
  import {
    createStackWriter,
    type KeptLayerItem,
    layersFit,
  } from '$lib/brand-editor/stack-writes';
  import {
    type ControlConfig,
    HERO_FX_PRESET_CONTROLS,
    HERO_FX_PRESETS,
    presetFxControls,
  } from '$lib/brand-editor/hero-fx-presets';
  import SortableRows from '$lib/components/page-builder/editor/SortableRows.svelte';
  import ListSegment from '$lib/components/studio/list-toolbar/ListSegment.svelte';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { PlusIcon, TrashIcon } from '$lib/components/ui/Icon';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import {
    BLEND_AMOUNTS,
    LAYER_AMOUNTS,
    MOVING_LAYER_IDS,
  } from '$lib/components/ui/ShaderHero/compositor/effects/amounts';
  import {
    BLEND_IDS,
    type BlendId,
    BRAND_FRAME_IDS,
    type BrandFrameId,
    LAYER_IDS,
    type LayerId,
    PASSTHROUGH_FRAME,
    SURFACE_ONLY_LAYER_IDS,
  } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
  import {
    BARE_STACK,
    type EditedLayer,
    type LayerItem,
    MAX_LAYERS,
    readStack,
  } from '$lib/components/ui/ShaderHero/compositor/stack-config';
  import type { LivePresetId } from '$lib/components/ui/ShaderHero/shader-config';
  import * as m from '$paraglide/messages';
  import BrandSliderField from '../BrandSliderField.svelte';
  import ControlField from './ControlField.svelte';

  interface Props {
    /** The base preset the stack builds on. */
    base: LivePresetId;
    /** The overrides as the editor shows them (light, or dark over light). */
    overrides: Readonly<Record<string, string | null>>;
    /** The Effects panel's read of a control's current value. */
    readControl: (control: ControlConfig) => number | string | boolean;
    /** The Effects panel's write of a control (removed at its default). */
    onControl: (key: string, value: string) => void;
  }

  const { base, overrides, readControl, onControl }: Props = $props();

  /** A message, called at render so it reads in the visitor's language. */
  type Words = () => string;
  /** A layer a brand's stack may name. */
  type StackLayerId = Exclude<LayerId, 'shader-light'>;

  // Every id with its words, so a blend, layer or frame added to the registry
  // fails the typecheck here until the editor names it.
  const BLEND_WORDS: Readonly<Record<BlendId, { label: Words; desc: Words }>> = {
    mix: { label: m.branding_combine_blend_mix, desc: m.branding_combine_blend_mix_desc },
    screen: { label: m.branding_combine_blend_screen, desc: m.branding_combine_blend_screen_desc },
    multiply: { label: m.branding_combine_blend_multiply, desc: m.branding_combine_blend_multiply_desc },
    difference: { label: m.branding_combine_blend_difference, desc: m.branding_combine_blend_difference_desc },
    'smoke-key': { label: m.branding_combine_blend_smoke_key, desc: m.branding_combine_blend_smoke_key_desc },
  };
  const FRAME_WORDS: Readonly<Record<BrandFrameId, { label: Words; desc: Words }>> = {
    'shader-only': { label: m.branding_combine_frame_shader_only, desc: m.branding_combine_frame_shader_only_desc },
    'through-name': { label: m.branding_combine_frame_through_name, desc: m.branding_combine_frame_through_name_desc },
    'name-glows': { label: m.branding_combine_frame_name_glows, desc: m.branding_combine_frame_name_glows_desc },
  };
  const LAYER_WORDS: Readonly<Record<StackLayerId, { label: Words; desc: Words }>> = {
    grain: { label: m.branding_layer_grain, desc: m.branding_layer_grain_desc },
    halftone: { label: m.branding_layer_halftone, desc: m.branding_layer_halftone_desc },
    crt: { label: m.branding_layer_crt, desc: m.branding_layer_crt_desc },
    chroma: { label: m.branding_layer_chroma, desc: m.branding_layer_chroma_desc },
    glitch: { label: m.branding_layer_glitch, desc: m.branding_layer_glitch_desc },
    leak: { label: m.branding_layer_leak, desc: m.branding_layer_leak_desc },
    duotone: { label: m.branding_layer_duotone, desc: m.branding_layer_duotone_desc },
    dither: { label: m.branding_layer_dither, desc: m.branding_layer_dither_desc },
    ink: { label: m.branding_layer_ink, desc: m.branding_layer_ink_desc },
    glow: { label: m.branding_layer_glow, desc: m.branding_layer_glow_desc },
    mosaic: { label: m.branding_layer_mosaic, desc: m.branding_layer_mosaic_desc },
    liquid: { label: m.branding_layer_liquid, desc: m.branding_layer_liquid_desc },
    reeded: { label: m.branding_layer_reeded, desc: m.branding_layer_reeded_desc },
    monotone: { label: m.branding_layer_monotone, desc: m.branding_layer_monotone_desc },
  };
  const isStackLayer = (id: LayerId): id is StackLayerId =>
    !SURFACE_ONLY_LAYER_IDS.includes(id);
  const STACK_LAYER_IDS: readonly StackLayerId[] = LAYER_IDS.filter(isStackLayer);
  /** A drawn layer row: its stored text kept until its strength changes. */
  type LayerRow = EditedLayer & { readonly id: StackLayerId };
  /** The widest strength a token writes (`id:0.35`), for whether a change fits. */
  const WIDEST_AMOUNT = 0.35;

  const reading = $derived(readStack((key) => overrides[key] ?? null, base));
  const stack = $derived(reading.stack);
  // Items the stack skips but the token still holds: shown, never dropped
  // unseen. A repeat is the same layer again, and goes at the next write.
  const kept = $derived(
    reading.items.filter(
      (item): item is KeptLayerItem => item.kind === 'skipped' && item.reason !== 'repeat'
    )
  );
  // The drawn layers, as the items that hold their stored text (the stack's
  // own layers are these, without it).
  const layers = $derived(
    reading.items.filter(
      (item): item is Extract<LayerItem, { kind: 'layer' }> & LayerRow =>
        item.kind === 'layer' && isStackLayer(item.id)
    )
  );
  const full = $derived(layers.length >= MAX_LAYERS);
  // The token the save keeps is at most 200 characters: a change that would
  // pass it is not offered (Add, a strength), and a line says why.
  const fits = (next: readonly EditedLayer[]) => layersFit(next, kept);
  const addable = $derived(
    STACK_LAYER_IDS.filter(
      (id) => !layers.some((layer) => layer.id === id) && fits([...layers, { id, amount: null }])
    )
  );
  const tunable = $derived(
    layers.map((_, index) =>
      fits(layers.map((layer, i) => (i === index ? { id: layer.id, amount: WIDEST_AMOUNT } : layer)))
    )
  );
  const tooLong = $derived((!full && addable.length === 0) || tunable.includes(false));
  const blendAmount = $derived(stack.blendAmount ?? BLEND_AMOUNTS[stack.blend]);
  const secondLabel = $derived(
    HERO_FX_PRESETS.find((p) => p.id === stack.second)?.label ?? ''
  );
  const baseLabel = $derived(HERO_FX_PRESETS.find((p) => p.id === base)?.label ?? base);
  const secondOptions = $derived([
    { value: 'none', label: m.branding_combine_second_none() },
    ...HERO_FX_PRESETS.filter((p) => p.id !== 'none' && p.id !== base).map((p) => ({
      value: p.id,
      label: p.label,
    })),
  ]);
  const secondTuning = $derived(
    stack.second
      ? [...presetFxControls(stack.second), ...(HERO_FX_PRESET_CONTROLS[stack.second]?.controls ?? [])]
      : []
  );
  // The preview reports when the logo leads alone: no name for a frame.
  const nameHidden = $derived(previewResolved.current?.options.lead === 'logo');

  const write = createStackWriter({
    setOverride: brandEditor.setThemeTokenOverride,
    onDark: () => brandEditor.editingTheme === 'dark',
    lightValue: (key) => brandEditor.pending?.tokenOverrides?.[key] ?? null,
    blend: () => stack.blend,
  });

  const writeLayers = (next: readonly EditedLayer[], keep: readonly KeptLayerItem[] = kept) =>
    write.layers(next, keep);
  const addLayer = (id: StackLayerId) => writeLayers([...layers, { id, amount: null }]);
  const removeLayer = (index: number) => writeLayers(layers.filter((_, i) => i !== index));

  let layersField: HTMLElement | undefined = $state();
  let announcement = $state('');

  /**
   * Remove a kept item, then focus what is next in the list: the next kept
   * row's Remove, else the first layer's grip, else the Add. Never the page.
   */
  async function removeKept(index: number): Promise<void> {
    const item = kept[index];
    if (!item) return;
    writeLayers(
      layers,
      kept.filter((_, i) => i !== index)
    );
    announcement = m.studio_page_editor_row_removed({ item: item.id });
    await tick();
    const next =
      layersField?.querySelectorAll<HTMLElement>('.combine__kept-row button')[index] ??
      // SortableRows' grip: the first layer row.
      layersField?.querySelector<HTMLElement>('.rows__grip') ??
      layersField?.querySelector<HTMLElement>('.combine__add');
    next?.focus();
  }

  function moveLayer(from: number, to: number): void {
    const next = [...layers];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    writeLayers(next);
  }

  function setLayerAmount(index: number, value: number): void {
    // A strength set by hand is written afresh: the stored text goes.
    writeLayers(layers.map((layer, i) => (i === index ? { id: layer.id, amount: value } : layer)));
  }

  function keptWords(item: KeptLayerItem): string {
    if (item.reason === 'surface-only') return m.branding_combine_retired_surface();
    if (item.reason === 'over-cap') return m.branding_combine_retired_over_cap({ max: String(MAX_LAYERS) });
    return m.branding_combine_retired();
  }

  const percent = (amount: number) => `${Math.round(amount * 100)}%`;
  const value = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>

<section class="combine" aria-labelledby="combine-title">
  <span class="combine__title" id="combine-title">{m.branding_combine_title()}</span>
  <div class="combine__group">
    <p class="combine__hint">{m.branding_combine_lede({ preset: baseLabel })}</p>

    <div class="combine__field" data-changed={stack.second ? '' : undefined}>
      <Select
        label={m.branding_combine_second()}
        options={secondOptions}
        value={stack.second ?? 'none'}
        onValueChange={(id) => write.second(id ?? null)}
      />
    </div>

    {#if stack.second}
      <div class="combine__field" data-changed={stack.blend !== BARE_STACK.blend ? '' : undefined}>
        <span class="combine__label">{m.branding_combine_blend()}</span>
        <ListSegment
          label={m.branding_combine_blend()}
          value={stack.blend}
          options={BLEND_IDS.map((id) => ({ value: id, label: BLEND_WORDS[id].label }))}
          wrap
          onSelect={(id) => write.blend(id)}
        />
        <p class="combine__hint">{BLEND_WORDS[stack.blend].desc()}</p>
      </div>

      <BrandSliderField
        id="combine-blend-amount"
        label={m.branding_combine_strength({ preset: secondLabel })}
        value={percent(blendAmount)}
        min={0}
        max={1}
        step={0.05}
        current={blendAmount}
        oninput={(e) => write.blendAmount(value(e))}
      />

      {#if secondTuning.length > 0}
        <details class="combine__tune">
          <summary>{m.branding_combine_tune({ preset: secondLabel })}</summary>
          <p class="combine__hint">{m.branding_combine_tune_hint()}</p>
          {#each secondTuning as control (control.key)}
            <ControlField {control} currentValue={readControl(control)} onUpdate={onControl} />
          {/each}
        </details>
      {/if}
    {/if}

    <div
      class="combine__field"
      data-changed={layers.length + kept.length > 0 ? '' : undefined}
      bind:this={layersField}
    >
      <span class="combine__label">
        {m.branding_combine_layers()}
        <span class="combine__count">
          {m.branding_combine_layers_count({ count: String(layers.length), max: String(MAX_LAYERS) })}
        </span>
      </span>
      <p class="combine__hint">
        {layers.length === 0
          ? m.branding_combine_layers_empty({ max: String(MAX_LAYERS) })
          : m.branding_combine_layers_hint()}
      </p>

      {#if kept.length > 0}
        <ul class="combine__kept">
          {#each kept as item, index (index)}
            <li class="combine__kept-row" data-reason={item.reason}>
              <span class="combine__kept-id">{item.id}</span>
              <span class="combine__kept-why">{keptWords(item)}</span>
              <button
                type="button"
                class="combine__icon"
                aria-label={m.branding_combine_remove({ item: item.id })}
                title={m.branding_combine_remove({ item: item.id })}
                onclick={() => void removeKept(index)}
              >
                <TrashIcon size={16} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <SortableRows
        count={layers.length}
        max={MAX_LAYERS}
        labelFor={(index) => LAYER_WORDS[layers[index].id].label()}
        onMove={moveLayer}
        onRemove={removeLayer}
        fullMessage={m.branding_combine_layers_full({ max: String(MAX_LAYERS) })}
      >
        {#snippet row(index)}
          {@const layer = layers[index]}
          {@const amount = layer.amount ?? LAYER_AMOUNTS[layer.id]}
          <div class="combine__layer">
            <span class="combine__layer-name">{LAYER_WORDS[layer.id].label()}</span>
            <span class="combine__hint">
              {LAYER_WORDS[layer.id].desc()}
              {#if MOVING_LAYER_IDS.has(layer.id)}{m.branding_combine_layer_still()}{/if}
            </span>
            <BrandSliderField
              id="combine-layer-{layer.id}"
              label={m.branding_combine_layer_strength({ layer: LAYER_WORDS[layer.id].label() })}
              value={percent(amount)}
              min={0}
              max={1}
              step={0.05}
              current={amount}
              disabled={!tunable[index]}
              oninput={(e) => setLayerAmount(index, value(e))}
            />
          </div>
        {/snippet}
        {#snippet add(isFull: boolean)}
          <!-- One element, full or not: focus on it is never lost to the page. -->
          <DropdownMenu.Root
            positioning={{ placement: 'bottom-start' }}
            disabled={isFull || addable.length === 0}
          >
            <DropdownMenu.Trigger class="combine__add">
              <PlusIcon size={16} />
              {m.branding_combine_layers_add()}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {#each STACK_LAYER_IDS as id (id)}
                {@const inUse = layers.some((layer) => layer.id === id)}
                <DropdownMenu.Item disabled={!addable.includes(id)} onclick={() => addLayer(id)}>
                  <span class="combine__menu-item">
                    <span>{LAYER_WORDS[id].label()}</span>
                    {#if inUse}<small>{m.branding_combine_layer_in_use()}</small>{/if}
                  </span>
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/snippet}
      </SortableRows>
      {#if tooLong}
        <p class="combine__note" data-too-long>{m.branding_combine_layers_too_long()}</p>
      {/if}
      <p class="sr-only" aria-live="polite">{announcement}</p>
    </div>

    <div class="combine__field" data-changed={stack.frame !== PASSTHROUGH_FRAME ? '' : undefined}>
      <span class="combine__label">{m.branding_combine_frame()}</span>
      <ListSegment
        label={m.branding_combine_frame()}
        value={stack.frame}
        options={BRAND_FRAME_IDS.map((id) => ({ value: id, label: FRAME_WORDS[id].label }))}
        wrap
        onSelect={(id) => write.frame(id)}
      />
      <p class="combine__hint">{FRAME_WORDS[stack.frame].desc()}</p>
      {#if stack.frame !== PASSTHROUGH_FRAME && nameHidden}
        <p class="combine__note">{m.branding_combine_frame_no_name()}</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .combine {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .combine__title {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .combine__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .combine__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .combine__label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .combine__count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
  }

  .combine__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
  }

  .combine__note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-warning-text);
  }

  .combine__tune {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .combine__tune summary {
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .combine__tune[open] summary {
    margin-block-end: var(--space-2);
  }

  .combine__layer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .combine__layer-name {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .combine__kept {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .combine__kept-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
  }

  .combine__kept-id {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: line-through;
  }

  .combine__kept-why {
    grid-column: 1;
    font-size: var(--text-xs);
    color: var(--color-status-warning-text);
  }

  .combine__kept-row .combine__icon {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .combine__icon {
    display: grid;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .combine__icon:hover {
    color: var(--color-text);
  }

  .combine__icon:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .combine :global(.combine__add) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: var(--space-8);
    padding: 0 var(--space-3);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .combine :global(.combine__add[aria-disabled='true']) {
    cursor: default;
    opacity: var(--opacity-60);
  }

  .combine :global(.combine__add:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .combine__menu-item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    inline-size: 100%;
  }

  .combine__menu-item small {
    color: var(--color-text-muted);
  }
</style>
