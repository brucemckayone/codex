<!--
  @component FocalPointField

  The part of a picture that must stay in view when a layout crops it
  (03 X64): a full-width Picture is 2:1 on a wide screen, 3:2 on a tablet and
  4:5 on a phone, and each crop is centred on this point. Each layout names
  the shapes it cuts (`focalLayouts`, Codex-61zsk.58).

  Tap or click the picture to place it; the arrow keys move it by 2% (Shift:
  10%). "Use the centre" removes it: the centre is what a picture with no
  point gets, so it is never stored. The crops show what each screen keeps.
  In a layout that never crops, the control explains itself instead.

  It writes the whole reference back with only `focus` changed, so the
  picture's description and size are never lost.
-->
<script lang="ts">
  import {
    CENTRE_FOCUS,
    type ImageRef,
    readFocus,
    resolvePageImageUrl,
  } from '$lib/page-builder/page-images';
  import type { FocalCrop } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';

  interface Props {
    image: ImageRef;
    mediaBaseUrl?: string | null;
    /** The shapes the section's layout cuts this picture to; none where it never crops. */
    crops: readonly FocalCrop[];
    onChange: (next: ImageRef) => void;
  }

  const { image, mediaBaseUrl = null, crops, onChange }: Props = $props();

  const id = $props.id();
  const focus = $derived(readFocus(image));
  const src = $derived(resolvePageImageUrl(image, 'md', mediaBaseUrl));
  const centred = $derived(focus.x === CENTRE_FOCUS.x && focus.y === CENTRE_FOCUS.y);
  const active = $derived(crops.length > 0);
  // Each crop's column is its own width-to-height, so every crop is drawn at
  // one height and reads as that screen's share of the picture.
  const columns = $derived(
    crops
      .map(({ ratio }) => {
        const [w = 1, h = 1] = ratio.split('/').map(Number);
        return `${w / h}fr`;
      })
      .join(' ')
  );
  const LABELS: Record<FocalCrop['at'], () => string> = {
    wide: m.studio_page_editor_focus_crop_wide,
    tablet: m.studio_page_editor_focus_crop_tablet,
    phone: m.studio_page_editor_focus_crop_phone,
  };

  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

  function place(x: number, y: number): void {
    const next = { x: clamp(x), y: clamp(y) };
    if (next.x === focus.x && next.y === focus.y) return;
    if (next.x === CENTRE_FOCUS.x && next.y === CENTRE_FOCUS.y) {
      useCentre();
      return;
    }
    onChange({ ...image, focus: next });
  }

  function useCentre(): void {
    const { focus: _focus, ...rest } = image;
    onChange(rest);
  }

  function pick(event: MouseEvent): void {
    // A keyboard press on the button carries no position: the arrows move it.
    if (event.detail === 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    place(
      ((event.clientX - box.left) / box.width) * 100,
      ((event.clientY - box.top) / box.height) * 100
    );
  }

  const MOVES: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function nudge(event: KeyboardEvent): void {
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    place(focus.x + move[0] * step, focus.y + move[1] * step);
  }
</script>

<div class="focus" role="group" aria-labelledby="{id}-label">
  <span class="focus__label" id="{id}-label">{m.studio_page_editor_focus_label()}</span>
  {#if !active}
    <p class="focus__hint">{m.studio_page_editor_focus_inactive()}</p>
  {:else if src}
    <button
      type="button"
      class="focus__pad"
      aria-label={m.studio_page_editor_focus_label()}
      aria-describedby="{id}-readout {id}-hint"
      onclick={pick}
      onkeydown={nudge}
    >
      <img class="focus__picture" {src} alt="" draggable="false" />
      <span class="focus__mark" style:left="{focus.x}%" style:top="{focus.y}%" aria-hidden="true"
      ></span>
    </button>
    <p class="focus__readout" id="{id}-readout" aria-live="polite">
      {m.studio_page_editor_focus_readout({ x: focus.x, y: focus.y })}
    </p>
    <p class="focus__hint" id="{id}-hint">{m.studio_page_editor_focus_hint()}</p>
    <div class="focus__crops" style:grid-template-columns={columns}>
      {#each crops as crop (crop.at)}
        <figure class="focus__crop">
          <img
            class="focus__crop-picture"
            {src}
            alt=""
            style:aspect-ratio={crop.ratio}
            style:object-position="{focus.x}% {focus.y}%"
          />
          <figcaption class="focus__crop-label">{LABELS[crop.at]()}</figcaption>
        </figure>
      {/each}
    </div>
    <button type="button" class="focus__centre" disabled={centred} onclick={useCentre}>
      {m.studio_page_editor_focus_centre()}
    </button>
  {/if}
</div>

<style>
  .focus {
    display: grid;
    gap: var(--space-2);
  }

  .focus__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .focus__hint,
  .focus__readout {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .focus__readout {
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .focus__pad {
    position: relative;
    display: block;
    inline-size: 100%;
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    overflow: hidden;
    cursor: crosshair;
    touch-action: manipulation;
  }

  .focus__pad:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  .focus__picture {
    display: block;
    inline-size: 100%;
    block-size: auto;
    pointer-events: none;
    user-select: none;
  }

  /* A ring with a dark and a light edge, so it reads on any photograph. */
  .focus__mark {
    position: absolute;
    inline-size: var(--space-6);
    block-size: var(--space-6);
    border: var(--border-width-thick) var(--border-style) var(--color-background);
    border-radius: var(--radius-full);
    box-shadow:
      0 0 0 var(--border-width) var(--color-text),
      inset 0 0 0 var(--border-width) var(--color-text);
    translate: -50% -50%;
    pointer-events: none;
  }

  .focus__crops {
    display: grid;
    align-items: end;
    gap: var(--space-2);
  }

  .focus__crop {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  .focus__crop-picture {
    display: block;
    inline-size: 100%;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .focus__crop-label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .focus__centre {
    justify-self: start;
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .focus__centre:disabled {
    color: var(--color-text-secondary);
    cursor: default;
  }

  .focus__centre:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }
</style>
