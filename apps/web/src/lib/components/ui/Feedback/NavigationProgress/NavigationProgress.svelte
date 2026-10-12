<script lang="ts">
  import { onMount } from 'svelte';
  import { navigating } from '$app/state';
  import { brandBars } from './navigation-progress-scope.svelte';

  interface Props {
    /**
     * Where this instance is mounted. Required, so neither call site can
     * silently take the other's role (see `navigation-progress-scope`).
     *  - `root`: the root layout's fallback bar. Draws only while no brand
     *    scope has a bar of its own mounted.
     *  - `brand`: mounted INSIDE a brand scope (`.org-layout`), so the bar
     *    inherits that scope's `--color-interactive` and `--color-focus`.
     */
    placement: 'root' | 'brand';
  }

  const { placement }: Props = $props();

  onMount(() => (placement === 'brand' ? brandBars.register() : undefined));

  // The root bar keeps tracking navigation while it stands down, so a hand-off
  // mid-navigation (leaving the org tree for an `(auth)` page on the same host
  // unmounts the org layout's bar) finishes the bar instead of cutting it.
  const standsDown = $derived(placement === 'root' && brandBars.mounted);

  let visible = $state(false);
  let completing = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (navigating.to) {
      clearTimeout(hideTimer);
      completing = false;
      visible = true;
    } else if (visible) {
      // Navigation finished — animate to 100% then fade out
      completing = true;
      hideTimer = setTimeout(() => {
        visible = false;
        completing = false;
      }, 400);
    }
  });
</script>

{#if visible && !standsDown}
  <div class="navigation-progress" role="progressbar" aria-label="Page loading">
    <div class="bar" class:completing></div>
  </div>
{/if}

<style>
  .navigation-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: var(--z-toast);
    pointer-events: none;
  }

  .bar {
    height: 100%;
    background: var(--color-interactive);
    box-shadow: 0 0 8px var(--color-focus);
    animation: trickle 4s ease-out forwards;
  }

  .bar.completing {
    width: 100%;
    animation: complete 0.2s ease-out forwards;
  }

  @keyframes trickle {
    from {
      width: 0%;
    }
    to {
      width: 85%;
    }
  }

  @keyframes complete {
    to {
      width: 100%;
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      width: 100%;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .bar.completing {
      animation: none;
      opacity: 0;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: var(--opacity-40);
      }
    }
  }
</style>
