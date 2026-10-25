<!--
  @component TabLinks

  The TabsList / TabsTrigger look, on links (Codex-2hxff.28, mockup "drawing
  notes"). The /admin sub-nav and the queue's two lists are each a place in
  the URL (`/admin/queue`, `?tab=debts`), so they are links that navigate,
  with `aria-current`, not Melt tabs: the Tabs wrapper takes its value once at
  mount, and back/forward would leave it showing the wrong list.

  @prop {string} label - The nav landmark's name.
  @prop {string} [kicker] - A small caps label before the links ("Support").
  @prop {TabLink[]} items - The links; `count` shows a warning Badge when > 0.
  @prop {'page' | 'true'} [currentAs='page'] - `aria-current` on the current
    link: `page` for pages, `true` for a list within the page (the queue's
    tabs), so only one link on the page says "current page".
-->
<script lang="ts">
  import { Badge } from '$lib/components/ui';

  interface TabLink {
    href: string;
    label: string;
    current: boolean;
    /** Waiting items. Null or 0 shows no Badge. */
    count?: number | null;
    /** Spoken after the label, with the count: "3 waiting". */
    countLabel?: string;
  }

  interface Props {
    label: string;
    kicker?: string;
    items: TabLink[];
    currentAs?: 'page' | 'true';
  }

  const { label, kicker, items, currentAs = 'page' }: Props = $props();
</script>

<nav class="tab-links" aria-label={label}>
  {#if kicker}
    <span class="tab-links__kicker" aria-hidden="true">{kicker}</span>
  {/if}
  {#each items as item (item.href)}
    <a
      class="tab-links__link"
      href={item.href}
      aria-current={item.current ? currentAs : undefined}
    >
      {item.label}
      {#if item.count}
        <Badge variant="warning" aria-hidden="true">{item.count}</Badge>
        {#if item.countLabel}<span class="sr-only">{item.countLabel}</span>{/if}
      {/if}
    </a>
  {/each}
</nav>

<style>
  .tab-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .tab-links__kicker {
    padding: var(--space-2) 0;
    margin-right: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    color: var(--color-text-secondary);
  }

  .tab-links__link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    margin-bottom: calc(-1 * var(--border-width));
    transition: var(--transition-colors);
  }

  .tab-links__link:hover {
    color: var(--color-text);
  }

  .tab-links__link[aria-current] {
    color: var(--color-interactive);
    border-bottom-color: var(--color-interactive);
  }

  .tab-links__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
