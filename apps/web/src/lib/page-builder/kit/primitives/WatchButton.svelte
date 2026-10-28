<!--
  @component WatchButton

  Opens a film for watching (the block owns the player). It sits over
  imagery, so its label is set on its OWN opaque fill — the on-media scrim
  colour with the on-media ink — and is legible over any photograph.

  With `preload` it fetches the player before the press, as a pointer or
  focus reaches it or it nears the screen (`preloadPlayer`), so the press can
  start the film with sound in its own tick. Never on the canvas, which
  plays nothing.

  A `note` is said beside it as an alert, on the same fill: the press could
  not start the film, and the button is there to try again.
-->
<script lang="ts">
  import { preloadPlayer } from '$lib/components/player/load-core';
  import { PlayIcon, RefreshCwIcon } from '$lib/components/ui/Icon';

  interface Props {
    label: string;
    onclick?: () => void;
    /** "Watch again": the replay mark in place of the play mark. */
    again?: boolean;
    /** Fetch the player ahead of the press. */
    preload?: boolean;
    /** Take focus as it appears: it stands in for a player that had it. */
    takeFocus?: boolean;
    /** Said beside the button, as an alert: why the last press did not play. */
    note?: string | null;
  }

  const {
    label,
    onclick,
    again = false,
    preload = false,
    takeFocus = false,
    note = null,
  }: Props = $props();
</script>

<span class="lp-watch" data-lp-on-media>
  <button
    type="button"
    class="lp-watch__button"
    {onclick}
    {@attach preload && preloadPlayer}
    {@attach (node) => {
      if (takeFocus) node.focus({ preventScroll: true });
    }}
  >
    <span class="lp-watch__icon" aria-hidden="true">
      {#if again}<RefreshCwIcon size={16} />{:else}<PlayIcon size={16} />{/if}
    </span>
    {label}
  </button>
  {#if note}<span class="lp-watch__note" role="alert">{note}</span>{/if}
</span>

<style>
  .lp-watch {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* Over imagery too, so on the button's own fill. */
  .lp-watch__note {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background: var(--lp-bg);
    color: var(--lp-ink);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    white-space: normal;
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
