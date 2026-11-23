<!--
  @component DockBanner

  One banner from the slot (dock-banner.svelte.ts), drawn in the dock's
  glass: optional art, a headline and an optional second line, one action and
  an optional dismiss. `compact` is the shrunk dock's inline form: the
  headline and the action only. Its host places and sizes it; it fills them.
-->
<script lang="ts">
  import { PauseIcon, PlayIcon, XIcon } from '$lib/components/ui/Icon';
  import { getThumbnailUrl } from '$lib/utils/image';
  import type { DockBannerOffer } from './dock-banner.svelte';

  interface Props {
    offer: DockBannerOffer;
    compact?: boolean;
  }

  const { offer, compact = false }: Props = $props();
  const action = $derived(offer.action);
</script>

{#snippet text()}
  <span class="dock-banner__title">{offer.title}</span>
  {#if offer.subtitle}
    <span class="dock-banner__subtitle">{offer.subtitle}</span>
  {/if}
{/snippet}

<div
  class="dock-banner"
  data-compact={compact ? '' : undefined}
  role="region"
  aria-label={offer.region}
>
  {#if offer.art}
    <!-- A small square, whatever size the offer stored: its sm file. -->
    <img
      class="dock-banner__art"
      src={getThumbnailUrl(offer.art, 'sm')}
      alt=""
    />
  {/if}

  {#if offer.onTitleClick}
    <button
      type="button"
      class="dock-banner__text"
      onclick={offer.onTitleClick}
      aria-label={offer.titleActionLabel}
    >
      {@render text()}
    </button>
  {:else}
    <div class="dock-banner__text">{@render text()}</div>
  {/if}

  <!-- One shape for a link or a button: ui/Button has no href, and a
       landing page's call-to-action must stay a real link. -->
  {#if action.href}
    <a
      class="dock-banner__action"
      href={action.href}
      aria-label={action.ariaLabel}
      data-testid={action.testId}
    >
      {action.label}
    </a>
  {:else}
    <button
      type="button"
      class="dock-banner__action"
      data-icon={action.icon ? '' : undefined}
      onclick={action.onclick}
      disabled={action.loading}
      aria-busy={action.loading}
      aria-label={action.icon ? action.label : action.ariaLabel}
      data-testid={action.testId}
    >
      {#if action.icon === 'pause'}
        <PauseIcon size={20} />
      {:else if action.icon === 'play'}
        <PlayIcon size={20} />
      {:else}
        <span class="dock-banner__action-label">{action.label}</span>
      {/if}
    </button>
  {/if}

  {#if offer.dismiss}
    <button
      type="button"
      class="dock-banner__dismiss"
      onclick={offer.dismiss.onclick}
      aria-label={offer.dismiss.label}
      data-testid={offer.dismiss.testId}
    >
      <XIcon size={16} />
    </button>
  {/if}
</div>

<style>
  .dock-banner {
    /* The dock's glass (MobileBottomNav.svelte keeps the same recipe): the
       page's ground stepped away from its own ink, blur plus a saturation
       lift, a lit rim and a soft shadow, all tinted from the surface. */
    --_surface: color-mix(
      in oklab,
      var(--color-background) 72%,
      oklch(from var(--color-text) calc(1 - l) 0 0)
    );
    --_r: var(--dock-banner-radius, min(var(--radius-md) * 4, var(--space-6)));
    --_inner-r: max(0px, var(--_r) - var(--space-1));

    box-sizing: border-box;
    block-size: 100%;
    inline-size: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-1) var(--space-1);
    border-radius: var(--_r);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-border) 70%, transparent);
    background:
      linear-gradient(
        to bottom,
        oklch(from var(--_surface) calc(l + 0.25) c h / 0.16),
        transparent 55%
      ),
      color-mix(in oklab, var(--_surface) 82%, transparent);
    backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    -webkit-backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    box-shadow:
      inset 0 var(--border-width) 0
        oklch(from var(--_surface) calc(l + 0.35) calc(c * 0.5) h / 0.55),
      var(--shadow-lg);
    color: var(--color-text);
    overflow: hidden;
    animation: dock-banner-in var(--duration-slow) var(--ease-spring);
  }

  @keyframes dock-banner-in {
    from {
      opacity: 0;
      translate: 0 var(--space-3);
    }
  }

  .dock-banner__art {
    flex: none;
    block-size: calc(100% - 2 * var(--space-1));
    aspect-ratio: 1;
    border-radius: var(--_inner-r);
    object-fit: cover;
  }

  .dock-banner__text {
    flex: 1;
    min-inline-size: 0;
    display: grid;
    padding: 0 0 0 var(--space-3);
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    line-height: var(--leading-tight);
  }

  .dock-banner__art + .dock-banner__text {
    padding-inline-start: var(--space-1);
  }

  button.dock-banner__text {
    cursor: pointer;
  }

  .dock-banner__title,
  .dock-banner__subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dock-banner__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .dock-banner__subtitle {
    font-size: var(--text-xs);
    color: color-mix(in oklab, var(--color-text) 75%, transparent);
  }

  /* The action: the brand's own fill and ink, nested in the banner's
     corners. An icon action is a square. */
  .dock-banner__action {
    flex: none;
    display: inline-grid;
    place-items: center;
    block-size: calc(100% - 2 * var(--space-1));
    padding-inline: var(--space-4);
    border: none;
    border-radius: var(--_inner-r);
    background: var(--color-interactive);
    color: var(--color-on-interactive);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-normal) var(--ease-default);
  }

  .dock-banner__action[data-icon] {
    aspect-ratio: 1;
    padding: 0;
  }

  .dock-banner__action[aria-busy='true'] {
    cursor: progress;
  }

  .dock-banner__action[aria-busy='true'] .dock-banner__action-label {
    opacity: 0.6;
  }

  @media (hover: hover) {
    .dock-banner__action:hover {
      background: var(--color-interactive-hover);
      color: var(--color-on-interactive-hover);
    }
  }

  .dock-banner__dismiss {
    flex: none;
    display: grid;
    place-items: center;
    block-size: calc(100% - 2 * var(--space-1));
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: var(--_inner-r);
    background: none;
    color: color-mix(in oklab, var(--color-text) 75%, transparent);
    cursor: pointer;
  }

  .dock-banner__text:focus-visible,
  .dock-banner__action:focus-visible,
  .dock-banner__dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  /* Shrunk into the dock: the headline and its one action. */
  .dock-banner[data-compact] :is(.dock-banner__subtitle, .dock-banner__dismiss) {
    display: none;
  }

  .dock-banner[data-compact] .dock-banner__action:not([data-icon]) {
    padding-inline: var(--space-3);
    font-size: var(--text-xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .dock-banner {
      animation: none;
    }
  }
</style>
