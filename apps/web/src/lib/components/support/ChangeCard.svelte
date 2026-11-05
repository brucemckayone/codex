<!--
  @component ChangeCard

  One change on a Queue tab (batch C1 Part B pages 5 and 6): a fee rise that
  hasn't started (Fee notices) or a price change the run stopped (Price
  moves). What changes and for whom, a Badge, and a few facts. Bordered on
  the surface, in the shape of the creator debts list's person cards; a
  stopped change sits on the warning surface, and its Badge says "Stopped"
  too, so the state never rests on colour alone.

  @prop {string} title
  @prop {string} sub - Who it is for, and who saved it.
  @prop {{ variant: 'warning' | 'info', label: string }} badge
  @prop {CardFact[]} facts
  @prop {'stopped'} [tone]
  @prop {Snippet} [actions]
  @prop {3|4} [headingLevel=3] - The title's level: under the tab's section
    heads (h2), never beside them, so a heading list tells section from card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Badge } from '$lib/components/ui';
  import type { CardBadge, CardFact } from './fee-notices-view';

  interface Props {
    title: string;
    sub: string;
    badge: CardBadge;
    facts: CardFact[];
    tone?: 'stopped';
    actions?: Snippet;
    testid?: string;
    headingLevel?: 3 | 4;
  }

  const {
    title,
    sub,
    badge,
    facts,
    tone,
    actions,
    testid,
    headingLevel = 3,
  }: Props = $props();

  const titleTag = $derived(`h${headingLevel}` as 'h3' | 'h4');
</script>

<li class="change-card" data-tone={tone} data-testid={testid}>
  <div class="change-card__head">
    <svelte:element this={titleTag} class="change-card__title">{title}</svelte:element>
    <p class="change-card__sub">{sub}</p>
  </div>
  <Badge variant={badge.variant} class="change-card__badge">{badge.label}</Badge>
  <dl class="change-card__facts">
    {#each facts as fact (fact.term)}
      <dt>{fact.term}</dt>
      <dd>
        {fact.text}{#if fact.strong}{fact.text ? ' ' : ''}<b>{fact.strong}</b>{/if}{fact.after ?? ''}
        {#if fact.small || fact.smallMono}
          <small>
            {fact.small ?? ''}{#if fact.smallMono}{fact.small ? ' ' : ''}<span class="mono">{fact.smallMono}</span>{/if}
          </small>
        {/if}
      </dd>
    {/each}
  </dl>
  {#if actions}
    <div class="change-card__actions">{@render actions()}</div>
  {/if}
</li>

<style>
  .change-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .change-card[data-tone='stopped'] {
    border-color: var(--color-status-warning-border);
    background: var(--color-status-warning-surface);
  }

  .change-card__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .change-card__title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .change-card__sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .change-card :global(.change-card__badge) {
    align-self: start;
  }

  .change-card__facts {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1-5) var(--space-4);
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .change-card__facts dt {
    color: var(--color-text-secondary);
  }

  .change-card__facts dd {
    margin: 0;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .change-card__facts dd small {
    display: block;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .change-card__actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  @media (--below-sm) {
    .change-card {
      grid-template-columns: minmax(0, 1fr);
    }

    .change-card__facts {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-0-5);
    }

    .change-card__facts dd {
      margin-bottom: var(--space-2);
    }
  }
</style>
