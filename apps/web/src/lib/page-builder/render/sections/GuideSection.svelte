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
</script>

{#if p.bio || p.name || p.heading}
  <div class="guide">
    <div class="guide__inner">
      {#if p.portraitUrl}
        <div class="guide__portrait">
          <img src={p.portraitUrl} alt={p.name ? `Portrait of ${p.name}` : ''} loading="lazy" />
        </div>
      {/if}
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

  .guide__portrait {
    aspect-ratio: 3 / 4;
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--color-surface-secondary);
  }

  .guide__portrait img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
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
