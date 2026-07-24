<!--
  @component IntroVideoSection

  The 90-second sell film (SPEC §4.1 `introVideo`, §10). The heading/sub render
  immediately (SEO-critical); the play affordance is STREAMED — it fills in when
  the public 30s `preview.m3u8` resolves (HARDENING §E: NO `canView` on the shell,
  public preview, no auth). While the preview promise is pending we show a
  poster skeleton; a resolution failure `.catch()`-es to null and the section
  degrades to just its copy. Playback reuses `ui/IntroVideoModal` (HLS.js).
-->
<script lang="ts">
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import SectionSkeleton from '../SectionSkeleton.svelte';
  import { asString } from '../coerce';
  import type { IntroVideoSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: IntroVideoSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    sub: asString(config, 'sub'),
    posterUrl: asString(config, 'posterUrl'),
  });

  const heading = $derived(p.heading ?? 'Ninety seconds inside the work.');

  let open = $state(false);
</script>

<div class="intro">
  <div class="intro__lead">
    {#if p.eyebrow}
      <p class="intro__eyebrow">{p.eyebrow}</p>
    {/if}
    <h2 class="intro__heading">{heading}</h2>
    {#if p.sub}
      <p class="intro__sub">{p.sub}</p>
    {/if}
  </div>

  <div class="intro__stage" style={p.posterUrl ? `--poster: url(${JSON.stringify(p.posterUrl)})` : undefined}>
    {#await context.sellPreview}
      <SectionSkeleton shape="media" label="Loading the intro film" />
    {:then preview}
      {#if preview?.intro}
        {@const intro = preview.intro}
        <button
          type="button"
          class="intro__play"
          onclick={() => (open = true)}
          aria-label="Play the {Math.round(intro.durationSeconds ?? 90)}-second intro film"
        >
          <span class="intro__play-icon" aria-hidden="true">
            <PlayIcon />
          </span>
        </button>
        <IntroVideoModal
          {open}
          src={intro.playlistUrl}
          title={heading}
          onclose={() => (open = false)}
        />
      {:else}
        <div class="intro__empty" aria-hidden="true"></div>
      {/if}
    {/await}
  </div>
</div>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    max-width: 60rem;
    margin-inline: auto;
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
    text-align: center;
  }

  .intro__lead {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }

  .intro__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .intro__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .intro__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .intro__stage {
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) solid var(--color-border-subtle);
    background:
      var(--poster, none) center / cover no-repeat,
      var(--color-surface-secondary);
    display: grid;
    place-items: center;
  }

  .intro__play {
    display: inline-grid;
    place-items: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full);
    border: none;
    cursor: pointer;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    transition:
      transform var(--duration-fast) var(--ease-default),
      background-color var(--duration-fast) var(--ease-default);
  }

  .intro__play:hover {
    background: var(--color-brand-primary-hover);
    transform: scale(1.06);
  }

  .intro__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .intro__play-icon {
    display: inline-flex;
    width: var(--space-6);
    height: var(--space-6);
    margin-left: 3px; /* optical centring of the play triangle */
  }

  .intro__empty {
    width: 100%;
    height: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .intro__play {
      transition: none;
    }
    .intro__play:hover {
      transform: none;
    }
  }
</style>
