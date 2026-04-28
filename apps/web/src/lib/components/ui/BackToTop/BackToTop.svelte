<!--
  @component BackToTop

  Floating button that appears after scrolling past a threshold
  and smooth-scrolls back to the top of the page.

  @prop {number} threshold - Scroll distance in vh units before showing (default: 50)
-->
<script lang="ts">
  import { ChevronUpIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    threshold?: number;
  }

  const { threshold = 50 }: Props = $props();

  let visible = $state(false);

  function handleScroll() {
    const thresholdPx = (threshold / 100) * window.innerHeight;
    visible = window.scrollY > thresholdPx;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<svelte:window onscroll={handleScroll} />

{#if visible}
  <button
    class="back-to-top"
    onclick={scrollToTop}
    aria-label={m.back_to_top()}
    title={m.back_to_top()}
  >
    <ChevronUpIcon size={20} />
  </button>
{/if}

<style>
  .back-to-top {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    color: var(--color-text-secondary);
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-shadow),
      opacity var(--duration-normal) var(--ease-default);
    opacity: 0;
    animation: fade-in var(--duration-normal) var(--ease-default) forwards;
  }

  .back-to-top:hover {
    color: var(--color-text);
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-lg);
  }

  .back-to-top:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .back-to-top:active {
    transform: scale(0.95);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (--below-sm) {
    .back-to-top {
      bottom: var(--space-4);
      right: var(--space-4);
    }
  }
</style>
