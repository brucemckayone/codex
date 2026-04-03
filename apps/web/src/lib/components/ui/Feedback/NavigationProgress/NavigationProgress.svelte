<script lang="ts">
  import { navigating } from '$app/state';

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

{#if visible}
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
        opacity: 0.4;
      }
    }
  }
</style>
