<!--
  @component AcheSection

  Names the held pain before hope is offered (SPEC §4.1 `ache`). A stacked
  sequence of "beats" — short statements read one after another. Renders nothing
  when no beats are configured (the section self-hides rather than showing an
  empty shell). Text-only, no JS, legible under reduced motion.
-->
<script lang="ts">
  import { asString, asStringArray } from '../coerce';
  import type { AcheSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: AcheSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    beats: asStringArray(config, 'beats'),
  });
</script>

{#if p.beats}
  <div class="ache">
    <div class="ache__glow" aria-hidden="true"></div>
    <div class="ache__inner">
      {#if p.eyebrow}
        <p class="ache__eyebrow">{p.eyebrow}</p>
      {/if}
      <div class="ache__beats">
        {#each p.beats as beat, i (i)}
          <p class="ache__beat">{beat}</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .ache {
    position: relative;
    isolation: isolate;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
    overflow: hidden;
    text-align: center;
  }

  .ache__glow {
    position: absolute;
    z-index: -1;
    left: 50%;
    top: 50%;
    width: min(78vw, 620px);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    opacity: 0.4;
    filter: blur(var(--blur-2xl));
    pointer-events: none;
    background: radial-gradient(
      circle at 50% 50%,
      color-mix(in oklab, var(--color-brand-accent) 24%, transparent),
      transparent 66%
    );
  }

  .ache__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    max-width: 48rem;
    margin-inline: auto;
  }

  .ache__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .ache__beats {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .ache__beat {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.01em;
    color: var(--color-heading);
    text-wrap: balance;
  }
</style>
