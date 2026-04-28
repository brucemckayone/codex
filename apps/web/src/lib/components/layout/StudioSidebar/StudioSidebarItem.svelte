<!--
  @component StudioSidebarItem

  Single nav row inside the StudioSidebar rail. Collapsed state shows icon +
  Melt UI tooltip on the right; expanded state shows icon + label + optional
  badge. Kept as its own component so every row gets its own Melt tooltip
  instance (stores can't be safely created inside {#each} in the parent).
-->
<script lang="ts">
  import { createTooltip, melt } from '@melt-ui/svelte';
  import type { Component } from 'svelte';
  import NavBadge from './NavBadge.svelte';

  interface Props {
    href: string;
    label: string;
    icon: Component<Record<string, unknown>>;
    active: boolean;
    loading: boolean;
    expanded: boolean;
    /** When true, tooltip registers; skipped in mobile mode or when expanded. */
    showTooltip: boolean;
    index: number;
    badgeCount?: number;
  }

  const {
    href,
    label,
    icon: Icon,
    active,
    loading,
    expanded,
    showTooltip,
    index,
    badgeCount,
  }: Props = $props();

  const {
    elements: { trigger, content },
    states: { open },
  } = createTooltip({
    positioning: { placement: 'right' },
    openDelay: 0,
    closeDelay: 0,
    forceVisible: true,
  });
</script>

<!-- Branching on showTooltip (not conditional use:melt) because Melt's
     action destructures `.action` from its argument and throws on `undefined`.
     Matches the SidebarRailItem reference pattern exactly. -->
<li class="studio-rail__item-wrapper">
  {#if showTooltip}
    <a
      {href}
      class="studio-rail__item"
      class:studio-rail__item--active={active}
      class:studio-rail__item--loading={loading}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      style:--item-index={index}
      use:melt={$trigger}
    >
      <Icon size={20} class="studio-rail__icon" />
      <span class="studio-rail__item-label">{label}</span>
      {#if badgeCount}
        <NavBadge count={badgeCount} />
      {/if}
    </a>
    {#if $open}
      <div use:melt={$content} class="studio-rail__tooltip">
        {label}
        {#if badgeCount}
          <span class="studio-rail__tooltip-badge">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        {/if}
      </div>
    {/if}
  {:else}
    <a
      {href}
      class="studio-rail__item"
      class:studio-rail__item--active={active}
      class:studio-rail__item--loading={loading}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      style:--item-index={index}
    >
      <Icon size={20} class="studio-rail__icon" />
      <span class="studio-rail__item-label">{label}</span>
      {#if badgeCount}
        <NavBadge count={badgeCount} />
      {/if}
    </a>
  {/if}
</li>

<style>
  .studio-rail__item-wrapper {
    position: relative;
  }

  .studio-rail__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    margin: 0 var(--space-2);
    min-height: var(--space-10);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    transition: var(--transition-colors);
  }

  .studio-rail__item:hover {
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
    color: var(--color-text);
  }

  .studio-rail__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .studio-rail__item--active {
    background-color: color-mix(in oklch, var(--color-interactive) 15%, transparent);
    color: var(--color-interactive);
  }

  .studio-rail__item--loading {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  :global(.studio-rail__icon) {
    flex-shrink: 0;
  }

  .studio-rail__item-label {
    flex: 1;
    min-width: 0;
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-out);
    /* Staggered reveal — items cascade in one-by-one on hover. Capped at
       index 8 so late rows never lag longer than the width animation. */
    transition-delay: calc(25ms * min(var(--item-index, 0), 8));
  }

  :global(.studio-rail[data-expanded='true']) .studio-rail__item-label {
    opacity: 1;
    transform: translateX(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail__item-label {
      transition-delay: 0ms;
      transition: opacity var(--duration-fast) var(--ease-default);
      transform: none;
    }
  }

  /* Badge: full pill when expanded, positioned corner dot when collapsed */
  :global(.studio-rail:not([data-expanded='true'])) .studio-rail__item :global(.nav-badge) {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    min-width: var(--space-2);
    width: var(--space-2);
    height: var(--space-2);
    padding: 0;
    font-size: 0;
    color: transparent;
    line-height: 0;
  }

  /* ── Tooltip (collapsed only) ────────────────────────────────── */
  .studio-rail__tooltip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    background: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    z-index: var(--z-dropdown);
    pointer-events: none;
  }

  .studio-rail__tooltip-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-4);
    height: var(--space-4);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }
</style>
