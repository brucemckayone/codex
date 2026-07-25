<!--
  @component GuideSection

  The maker's bio (SPEC §4.1 `guide`) — "made by someone who had to find the
  ground first". Optional portrait + name + multi-paragraph bio + credentials.
  Renders nothing when neither a bio nor a name is configured.
-->
<script lang="ts">
  import { asString, asStringArray } from '../coerce';
  import type { GuideSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: GuideSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    name: asString(config, 'name'),
    bio: asStringArray(config, 'bio'),
    portraitUrl: asString(config, 'portraitUrl'),
    credentials: asStringArray(config, 'credentials'),
  });

  // A single-glyph mark for the decorative candlelit poster when no portrait is
  // configured — the guide's initial, evoking a portrait placeholder.
  const mark = $derived(
    (p.name ?? p.heading ?? '').trim().charAt(0).toUpperCase() || '·'
  );
</script>

{#if p.bio || p.name || p.heading}
  <div class="guide">
    <div class="guide__inner">
      <!-- Left: a candlelit "meet your guide" poster. A real portrait layers in
           when configured; otherwise a decorative brand-lit panel holds the
           column's visual weight (matching the prototype's play-frame) without
           implying playback we don't have. -->
      <div class="guide__poster" class:guide__poster--photo={p.portraitUrl}>
        {#if p.portraitUrl}
          <img
            src={p.portraitUrl}
            alt={p.name ? `Portrait of ${p.name}` : ''}
            loading="lazy"
          />
        {:else}
          <span class="guide__mark" aria-hidden="true">{mark}</span>
        {/if}
      </div>
      <div class="guide__body">
        {#if p.eyebrow}
          <p class="guide__eyebrow">{p.eyebrow}</p>
        {/if}
        {#if p.heading}
          <h2 class="guide__heading">{p.heading}</h2>
        {/if}
        {#if p.name}
          <p class="guide__name">{p.name}</p>
        {/if}
        {#if p.bio}
          <div class="guide__bio">
            {#each p.bio as paragraph, i (i)}
              <p>{paragraph}</p>
            {/each}
          </div>
        {/if}
        {#if p.credentials}
          <ul class="guide__credentials">
            {#each p.credentials as credential, i (i)}
              <li>{credential}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .guide {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .guide__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-8);
    max-width: 60rem;
    margin-inline: auto;
  }

  @media (--breakpoint-md) {
    .guide__inner {
      grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
      gap: var(--space-12);
      align-items: center;
    }
  }

  /* Candlelit poster: firelight rising from lower-centre + a clay presence
     upper-left over a deep body — the same brand-derived warmth as the sell
     video frames, so the guide reads as part of one candlelit world. */
  .guide__poster {
    position: relative;
    aspect-ratio: 4 / 5;
    border-radius: var(--radius-card);
    overflow: hidden;
    display: grid;
    place-items: center;
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 20%, transparent);
    background:
      radial-gradient(
        46% 58% at 50% 66%,
        color-mix(in oklab, var(--color-brand-primary) 46%, transparent),
        transparent 68%
      ),
      radial-gradient(
        90% 72% at 30% 24%,
        color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 22%, transparent),
        transparent 66%
      ),
      var(--color-surface);
    box-shadow:
      0 var(--space-8) var(--space-16) calc(-1 * var(--space-10))
        color-mix(in oklab, var(--color-brand-primary) 55%, #000),
      inset 0 var(--border-width) 0
        color-mix(in oklab, var(--color-heading) 10%, transparent);
  }

  .guide__poster--photo {
    background: var(--color-surface-secondary);
  }

  .guide__poster img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .guide__mark {
    font-family: var(--font-heading);
    font-size: var(--text-6xl, var(--text-display));
    font-weight: var(--font-normal);
    line-height: 1;
    color: color-mix(in oklab, var(--color-heading) 78%, transparent);
    text-shadow: 0 0 var(--space-6)
      color-mix(in oklab, var(--color-brand-primary) 45%, transparent);
  }

  .guide__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guide__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .guide__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .guide__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .guide__bio {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guide__bio p {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  .guide__credentials {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .guide__credentials li {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
