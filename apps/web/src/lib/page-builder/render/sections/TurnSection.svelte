<!--
  @component TurnSection

  The pivot from pain to promise (SPEC §4.1 `turn`). A two-column statement
  (left) + lede and supporting points (right) on wide viewports; stacks on
  narrow. Renders nothing when neither a statement nor a lede is configured.
-->
<script lang="ts">
  import { asString, asStringArray } from '../coerce';
  import type { TurnSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: TurnSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    statement: asString(config, 'statement'),
    lede: asString(config, 'lede'),
    points: asStringArray(config, 'points'),
  });
</script>

{#if p.statement || p.lede}
  <div class="turn">
    <div class="turn__inner">
      <div class="turn__head">
        {#if p.eyebrow}
          <p class="turn__eyebrow">{p.eyebrow}</p>
        {/if}
        {#if p.statement}
          <p class="turn__statement">{p.statement}</p>
        {/if}
      </div>
      <div class="turn__body">
        {#if p.lede}
          <p class="turn__lede">{p.lede}</p>
        {/if}
        {#if p.points}
          <ul class="turn__points">
            {#each p.points as point, i (i)}
              <li class="turn__point">{point}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .turn {
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .turn__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-10);
    max-width: 68rem;
    margin-inline: auto;
  }

  @media (--breakpoint-md) {
    .turn__inner {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: var(--space-16);
      align-items: center;
    }
  }

  .turn__eyebrow {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .turn__statement {
    margin: 0;
    max-width: 32ch;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .turn__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .turn__lede {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .turn__points {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .turn__point {
    position: relative;
    padding-left: var(--space-6);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--color-text);
  }

  .turn__point::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.6em;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
  }
</style>
