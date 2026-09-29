<!--
  @component WatchButton

  Opens a film for watching (the block owns the player). It sits over
  imagery, so its label is set on its OWN opaque fill — the on-media scrim
  colour with the on-media ink — and is legible over any photograph.
-->
<script lang="ts">
  import { PlayIcon } from '$lib/components/ui/Icon';

  interface Props {
    label: string;
    onclick?: () => void;
  }

  const { label, onclick }: Props = $props();
</script>

<span class="lp-watch" data-lp-on-media>
  <button type="button" class="lp-watch__button" {onclick}>
    <span class="lp-watch__icon" aria-hidden="true"><PlayIcon size={16} /></span>
    {label}
  </button>
</span>

<style>
  .lp-watch {
    display: inline-flex;
  }

  .lp-watch__button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--tap-target-min);
    padding: var(--space-2) var(--space-5) var(--space-2) var(--space-2);
    border: none;
    border-radius: var(--radius-full);
    background: var(--lp-bg);
    color: var(--lp-ink);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .lp-watch__icon {
    display: inline-grid;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    border-radius: var(--radius-full);
    background: var(--lp-button-bg);
    color: var(--lp-button-ink);
  }

  @media (hover: hover) {
    .lp-watch__button:hover {
      transform: scale(1.03);
    }
  }

  .lp-watch__button:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--space-1);
  }
</style>
