<!--
  @component ClipFrame

  A frame for a still that may have a film behind it: the poster — or the
  kit's designed plate, which also holds the frame's space while the streamed
  media is pending, or a `mark` standing in for the picture (`Media`) — any
  control the block lays over it, and, on the canvas only, the block's prompt
  when there is nothing to show yet (marked `data-lp-edit-only`).

  Shared by the video, sneak peek and about-you blocks.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ColourSchemeId } from '../../model/ids';
  import Media from '../../primitives/Media.svelte';

  interface Props {
    still?: string | null;
    /** CSS aspect ratio; omit to fill the parent. */
    ratio?: string;
    alt?: string;
    pending?: boolean;
    /** Letters drawn in the picture's place when there is none (`Media`). */
    mark?: string;
    /** The scheme the mark's ground takes. */
    scheme?: ColourSchemeId;
    /**
     * Where the control sits: centred, in the lower corner, or centred on the
     * frame's foot, half over its edge (for a round or narrow frame).
     */
    place?: 'center' | 'corner' | 'foot';
    /** The canvas's words for an empty frame. Never passed on the public page. */
    prompt?: string;
    children?: Snippet;
    class?: string;
  }

  const {
    still = null,
    ratio,
    alt = '',
    pending = false,
    mark,
    scheme,
    place = 'corner',
    prompt,
    children,
    class: className,
  }: Props = $props();
</script>

<div class="clip {className ?? ''}" data-place={place}>
  <Media image={still} {ratio} {pending} {alt} {mark} {scheme} />
  {#if children}<div class="clip__control">{@render children()}</div>{/if}
  {#if prompt && !still && !pending}
    <p class="clip__prompt" data-lp-edit-only><span>{prompt}</span></p>
  {/if}
</div>

<style>
  .clip {
    position: relative;
    display: grid;
    block-size: 100%;
  }

  /* `--clip-inset` lets a frame that runs off the band's edge line its
     control up with the content column instead. No arithmetic on the media
     radius: Bold's is `--radius-none`, a unitless 0, which would void the
     whole inset. */
  .clip__control {
    --_corner: var(--space-4);
    position: absolute;
    inset-inline-start: var(--clip-inset, var(--_corner));
    inset-block-end: var(--_corner);
  }

  /* Clear of Soft's large corner radius. */
  :global(.lp[data-lp-style='soft']) .clip__control {
    --_corner: var(--space-6);
  }

  .clip[data-place='center'] .clip__control {
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .clip[data-place='center'] .clip__control > :global(*) {
    pointer-events: auto;
  }

  .clip[data-place='foot'] .clip__control {
    inset-inline: 0;
    inset-block-end: 0;
    display: flex;
    justify-content: center;
    translate: 0 50%;
    white-space: nowrap;
  }

  /* Set on the section's own ground so it reads over the plate's disc too.
     `max-inline-size: none` lifts the app's global prose cap on `p`. */
  .clip__prompt {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    pointer-events: none;
  }

  .clip__prompt span {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--lp-radius-chip);
    background: var(--lp-bg);
    color: var(--lp-ink);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
    text-align: center;
    text-wrap: balance;
  }
</style>
