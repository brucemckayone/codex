<!--
  @component FocusRail

  Contextual "what needs your attention today" panel — the creator-first
  answer to the generic 6-card quick-action grid. Each item is a surface
  to a real piece of work (draft ready, stripe onboarding, first content),
  not a navigation link to a blank form.

  Items are supplied pre-filtered by the dashboard page. The rail is
  intentionally quiet when empty ("All caught up") to avoid giving
  every creator the same five-bullet todo list.

  @prop items  Ordered list of focus items (highest-signal first)
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { ChevronRightIcon } from '$lib/components/ui/Icon';

  export interface FocusItem {
    id: string;
    eyebrow: string; // e.g. "2 drafts" — monospace meter
    title: string; // e.g. "Ready to publish"
    description?: string; // optional one-line supporting text
    href: string;
    tone?: 'action' | 'warning' | 'muted'; // colour accent
    icon?: Component<{ size?: number | string; class?: string }>;
  }

  interface Props {
    items: FocusItem[];
  }

  const { items }: Props = $props();
</script>

<aside class="focus-rail" aria-labelledby="focus-rail-heading">
  <header class="rail-header">
    <span class="rail-eyebrow">Focus</span>
    <h2 id="focus-rail-heading" class="rail-title">Today's priorities</h2>
  </header>

  {#if items.length === 0}
    <p class="rail-empty">
      <span class="empty-glyph" aria-hidden="true">✓</span>
      All caught up — nothing needs your attention right now.
    </p>
  {:else}
    <ol class="rail-list">
      {#each items as item, i (item.id)}
        <li class="rail-item">
          <a class="rail-link" href={item.href} data-tone={item.tone ?? 'action'}>
            <span class="rail-ordinal" aria-hidden="true">
              {(i + 1).toString().padStart(2, '0')}
            </span>
            <span class="rail-body">
              <span class="rail-eyebrow-small">{item.eyebrow}</span>
              <span class="rail-item-title">{item.title}</span>
              {#if item.description}
                <span class="rail-description">{item.description}</span>
              {/if}
            </span>
            <span class="rail-chev" aria-hidden="true">
              {#if item.icon}
                <item.icon size={16} />
              {:else}
                <ChevronRightIcon size={16} />
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</aside>

<style>
  .focus-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Header ──────────────────────────────────────────────── */
  .rail-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .rail-eyebrow {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .rail-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  /* ── Empty state ─────────────────────────────────────────── */
  .rail-empty {
    margin: 0;
    padding: var(--space-3) 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .empty-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full, 9999px);
    background-color: color-mix(in srgb, var(--color-success-500) 12%, var(--color-surface));
    color: var(--color-success-700);
    font-weight: var(--font-bold);
    font-size: var(--text-xs);
  }

  /* ── List ────────────────────────────────────────────────── */
  .rail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rail-link {
    display: grid;
    grid-template-columns: var(--space-8) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: background-color var(--duration-fast) var(--ease-out),
                transform var(--duration-fast) var(--ease-out);
    /* subtle 1px lift on hover — ContentForm ordinal rhythm */
    border-left: var(--space-0-5) solid transparent;
  }

  .rail-link:hover {
    background-color: var(--color-surface-secondary);
  }

  .rail-link[data-tone='action']:hover {
    border-left-color: var(--color-interactive);
  }

  .rail-link[data-tone='warning']:hover {
    border-left-color: var(--color-warning-500);
  }

  .rail-link[data-tone='muted']:hover {
    border-left-color: var(--color-border);
  }

  .rail-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Ordinal ─────────────────────────────────────────────── */
  .rail-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    text-align: right;
  }

  .rail-link[data-tone='warning'] .rail-ordinal {
    color: var(--color-warning-700);
  }

  /* ── Body ────────────────────────────────────────────────── */
  .rail-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .rail-eyebrow-small {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .rail-link[data-tone='warning'] .rail-eyebrow-small {
    color: var(--color-warning-700);
  }

  .rail-link[data-tone='action'] .rail-eyebrow-small {
    color: var(--color-interactive);
  }

  .rail-item-title {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .rail-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* ── Chevron ─────────────────────────────────────────────── */
  .rail-chev {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
  }

  .rail-link:hover .rail-chev {
    color: var(--color-interactive);
    transform: translateX(var(--space-0-5));
  }

  @media (prefers-reduced-motion: reduce) {
    .rail-link:hover .rail-chev { transform: none; }
  }
</style>
