<!--
  @component FeelSection

  What it feels like (left) + what's inside (right) — SPEC §4.1 `feel`. The
  inclusions list is the concrete "what you get" companion to the emotional
  left column. Renders nothing when neither column has content.
-->
<script lang="ts">
  import { asString, asObjectArray, fieldString } from '../coerce';
  import type { FeelSectionProps, FeelInclusion, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: FeelSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    body: asString(config, 'body'),
    inclusions: asObjectArray<FeelInclusion>(config, 'inclusions', (entry) => {
      const label = fieldString(entry, 'label');
      if (!label) return null;
      return { label, detail: fieldString(entry, 'detail') };
    }),
  });
</script>

{#if p.heading || p.body || p.inclusions}
  <div class="feel">
    <div class="feel__inner">
      <div class="feel__left">
        {#if p.eyebrow}
          <p class="feel__eyebrow">{p.eyebrow}</p>
        {/if}
        {#if p.heading}
          <h2 class="feel__heading">{p.heading}</h2>
        {/if}
        {#if p.body}
          <p class="feel__body">{p.body}</p>
        {/if}
      </div>

      {#if p.inclusions}
        <ul class="feel__inclusions">
          {#each p.inclusions as inclusion, i (i)}
            <li class="feel__inclusion">
              <span class="feel__inclusion-label">{inclusion.label}</span>
              {#if inclusion.detail}
                <span class="feel__inclusion-detail">{inclusion.detail}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .feel {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .feel__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-10);
    max-width: 68rem;
    margin-inline: auto;
  }

  @media (--breakpoint-md) {
    .feel__inner {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-16);
      align-items: start;
    }
  }

  .feel__left {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .feel__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .feel__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .feel__body {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .feel__inclusions {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .feel__inclusion {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4) 0;
    border-top: var(--border-width) solid var(--color-border-subtle);
  }

  .feel__inclusion:last-child {
    border-bottom: var(--border-width) solid var(--color-border-subtle);
  }

  .feel__inclusion-label {
    font-weight: var(--font-semibold);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .feel__inclusion-detail {
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }
</style>
