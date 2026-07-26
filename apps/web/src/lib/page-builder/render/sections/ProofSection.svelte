<!--
  @component ProofSection

  Testimonials (SPEC §4.1 `proof`) — "what the ground gives back". Renders from
  the awaited `context.testimonials` (public, no auth). Self-hides when the
  course has no testimonials.
-->
<script lang="ts">
  import { asString } from '../coerce';
  import type { ProofSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: ProofSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
  });

  const testimonials = $derived(
    [...context.testimonials].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const heading = $derived(p.heading ?? 'What the ground gives back.');
</script>

{#if testimonials.length > 0}
  <div class="proof">
    <div class="proof__inner">
      <header class="proof__head">
        {#if p.eyebrow}
          <p class="proof__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="proof__heading">{heading}</h2>
      </header>

      <ul class="proof__grid">
        {#each testimonials as testimonial (testimonial.id)}
          <li class="proof__item">
            <figure class="proof__figure">
              <blockquote class="proof__quote">{testimonial.quote}</blockquote>
              <figcaption class="proof__cite">
                <span class="proof__author">{testimonial.authorName}</span>
                {#if testimonial.authorContext}
                  <span class="proof__context">{testimonial.authorContext}</span>
                {/if}
              </figcaption>
            </figure>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .proof {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .proof__inner {
    max-width: 68rem;
    margin-inline: auto;
  }

  .proof__head {
    text-align: center;
    max-width: 44rem;
    margin: 0 auto var(--space-12);
  }

  .proof__eyebrow {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .proof__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .proof__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (--breakpoint-md) {
    .proof__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-6);
    }
  }

  .proof__item {
    display: flex;
  }

  .proof__figure {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-6);
    border-radius: var(--radius-card);
    border: var(--border-width) solid var(--color-border-subtle);
    background: var(--color-surface-secondary);
  }

  .proof__quote {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    color: var(--color-heading);
    text-wrap: pretty;
  }

  .proof__cite {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .proof__author {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .proof__context {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
