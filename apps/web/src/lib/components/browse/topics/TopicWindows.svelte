<!--
  @component TopicWindows

  The "Shader windows" topic selector (Codex-8swlj.6), one of the three styles
  an org picks for Browse everything. Each topic is a plate: a clear window
  onto the org's own moving shader (`ShaderWindow`), so the selector looks like
  the brand by construction.

  - A bento grid. The lead topic spans 2x2 on desktop and the full width on a
    phone; the rest fill every row edge to edge, none alone on a row
    (`topic-windows-layout.ts`).
  - A topic with a cover shows the photo in its OWN colour, masked so it fades
    into the shader under the label. No duotone: that was reverted.
  - A topic with no cover is shader, with its initial ghosted top right.
  - ONE veil over the whole text band of a plate, never a patch behind words.
    It is the dark of the brand's own hue (the hue `--media-glyph` takes for
    the text on it), not the neutral `--media-scrim`, which read as a muddy
    grey strip on a light brand (owner, 2026-11-24).
  - No live shader (no preset, a failed renderer, no WebGL): the window's
    fallback paints the brand gradient, so shader-less orgs look finished.
  - A plate is an `aria-pressed` button. Pressing the active plate again
    clears the topic (`onSelect(null)`); the host's result head also clears.
  - Phone: the first six topics and a "Show all N" tile that expands in place.
    The active topic always shows.

  CONTROLLED: it owns only the phone's expanded state. `active` is a prop and
  every press calls `onSelect`; the host feeds the new slug back in.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { ShaderWindow } from '$lib/components/ui/ShaderWindow';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import { initialOf, layoutWindows, photoSizes } from './topic-windows-layout';

  interface Props {
    topics: TopicItem[];
    /** The active topic's slug, or null for none. */
    active: string | null;
    onSelect: (slug: string | null) => void;
  }

  const { topics, active, onSelect }: Props = $props();

  const uid = $props.id();
  /** The phone's "Show all N" is pressed. */
  let expanded = $state(false);

  const activeIndex = $derived(topics.findIndex((t) => t.slug === active));
  const layout = $derived(layoutWindows(topics.length, activeIndex, expanded));

  async function toggleMore(
    event: MouseEvent & { currentTarget: HTMLButtonElement }
  ) {
    const tile = event.currentTarget;
    // The first plate this reveals, read before the layout changes.
    const revealed = layout.plates.findIndex((plate) => plate.overflow);
    // This press's direction: a second press may land before the tick.
    const opening = !expanded;
    expanded = opening;
    await tick();
    if (opening) {
      // Land a keyboard user on what opened, not on the tile below it.
      tile.parentElement
        ?.querySelectorAll<HTMLButtonElement>('.topic-windows__plate')
        [revealed]?.focus();
    } else {
      // The tile moved up past what scrolled; bring it back.
      tile.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

{#snippet brandGradient()}
  <span class="topic-windows__fallback" aria-hidden="true"></span>
{/snippet}

<div class="topic-windows">
  <div
    class="topic-windows__grid"
    role="group"
    aria-label={m.topic_windows_label()}
  >
    {#each topics as topic, index (topic.id)}
      {@const plate = layout.plates[index]}
      {@const pressed = index === activeIndex}
      {@const cover = topic.coverImageUrl}
      {@const count = topic.contentCount}
      {@const counted = typeof count === 'number'}
      {@const blurb = index === 0 ? topic.description?.trim() : ''}
      {@const nameId = `${uid}-${index}-name`}
      {@const countId = `${uid}-${index}-count`}
      {@const descId = `${uid}-${index}-desc`}
      <button
        type="button"
        class="topic-windows__plate"
        data-topic={topic.slug}
        data-lead={index === 0 ? '' : undefined}
        data-cols={plate.cols}
        data-rows={plate.rows}
        data-phone-wide={plate.phoneWide ? '' : undefined}
        data-overflow={plate.overflow ? '' : undefined}
        aria-pressed={pressed}
        aria-labelledby={counted ? `${nameId} ${countId}` : nameId}
        aria-describedby={blurb ? descId : undefined}
        onclick={() => onSelect(pressed ? null : topic.slug)}
      >
        <ShaderWindow class="topic-windows__window" fallback={brandGradient} />
        {#if cover}
          <img
            class="topic-windows__photo"
            src={cover}
            srcset={getThumbnailSrcset(cover) || undefined}
            sizes={photoSizes(plate, cover)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        {:else}
          <span class="topic-windows__initial" aria-hidden="true"
            >{initialOf(topic.name)}</span
          >
        {/if}
        <span class="topic-windows__tick" aria-hidden="true">
          <CheckIcon size="100%" stroke-width="3" />
        </span>
        <span class="topic-windows__label">
          {#if typeof count === 'number'}
            <span id={countId} class="topic-windows__count">
              {count === 1
                ? m.topic_windows_count_one()
                : m.topic_windows_count_other({ count })}
            </span>
          {/if}
          <span id={nameId} class="topic-windows__name">{topic.name}</span>
          {#if blurb}
            <span id={descId} class="topic-windows__desc">{blurb}</span>
          {/if}
        </span>
      </button>
    {/each}
    {#if layout.toggle}
      <button
        type="button"
        class="topic-windows__more"
        data-wide={layout.toggle.wide ? '' : undefined}
        aria-expanded={expanded}
        onclick={toggleMore}
      >
        {expanded
          ? m.topic_windows_show_fewer()
          : m.topic_windows_show_all({ count: topics.length })}
      </button>
    {/if}
  </div>
</div>

<style>
  /* The plates' rows are sized from the grid's own width (`cqi`), so a row is
     a fixed share of a column at any width and the 2x2 lead stays exactly two
     rows and a gap tall. */
  .topic-windows {
    container-type: inline-size;
  }

  .topic-windows__grid {
    /* Phone: two columns of 4:3 plates. A row is `--_ratio` of one `--_unit`
       column high: the phone's half, or desktop's quarter on its twelve-column
       track, so a quarter plate (3 of 12) is exactly a four-column cell. */
    --_cols: 2;
    --_unit: 2;
    --_ratio: 0.75;
    --_gap: var(--space-2);
    display: grid;
    grid-template-columns: repeat(var(--_cols), minmax(0, 1fr));
    grid-auto-rows: calc(
      (100cqi - (var(--_unit) - 1) * var(--_gap)) / var(--_unit) * var(--_ratio)
    );
    gap: var(--_gap);
  }

  .topic-windows__plate {
    /* The photo stays opaque down to here, then fades into the shader. */
    --_fade-from: 30%;
    --_fade-to: 92%;
    position: relative;
    display: flex;
    align-items: flex-end;
    min-width: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    /* Contains the plate's own stack (window, photo, label, tick). */
    isolation: isolate;
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    color: var(--media-glyph);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
  }

  .topic-windows__plate[data-lead] {
    --_fade-from: 45%;
    --_fade-to: 100%;
  }

  .topic-windows__plate:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .topic-windows__plate[aria-pressed='true'] {
    box-shadow:
      0 0 0 var(--border-width-thick) var(--color-brand-accent),
      var(--shadow-lg);
  }

  /* The brand gradient a window shows while no shader is live. */
  .topic-windows__fallback {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        120% 120% at 28% 22%,
        color-mix(in oklab, var(--color-brand-primary) 55%, var(--color-surface)),
        transparent 68%
      ),
      linear-gradient(
        150deg,
        var(--color-surface-elevated),
        var(--color-surface) 55%,
        color-mix(in oklab, var(--color-brand-secondary) 45%, var(--color-surface))
      );
  }

  /* In its own colour; only its foot fades, into the window under the label.
     A mask keeps only alpha, so its colour is irrelevant. */
  .topic-windows__photo {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    mask-image: linear-gradient(
      to bottom,
      black var(--_fade-from),
      transparent var(--_fade-to)
    );
    transition: transform var(--duration-slower) var(--ease-smooth);
  }

  /* A coverless plate's initial, ghosted back so it reads as texture. */
  .topic-windows__initial {
    position: absolute;
    z-index: 1;
    top: var(--space-2);
    right: var(--space-3);
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    line-height: var(--leading-none);
    color: color-mix(in srgb, var(--media-glyph) 16%, transparent);
    pointer-events: none;
    user-select: none;
  }

  /* ONE veil over the whole text band: even behind every line of text, then
     feathered into the clear window above it. Never a patch behind words. */
  .topic-windows__label {
    /* The dark of the brand's own hue, the hue `--media-glyph` lights for the
       words on it, so the band reads as the brand, not as grey. Same strength
       as the scrim it replaces, so the words keep their contrast. */
    --_veil-ink: oklch(from var(--color-brand-accent) 0.24 calc(c * 0.4) h);
    --_veil: color-mix(in oklab, var(--_veil-ink) 76%, transparent);
    --_feather: var(--space-8);
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--_feather) var(--space-3) var(--space-3);
    background: linear-gradient(
      to top,
      var(--_veil),
      var(--_veil) calc(100% - var(--_feather)),
      transparent
    );
  }

  .topic-windows__count {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--media-glyph) 85%, transparent);
  }

  .topic-windows__name,
  .topic-windows__desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .topic-windows__name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    line-height: var(--leading-tight);
  }

  .topic-windows__plate[data-lead] .topic-windows__name {
    font-size: var(--text-2xl);
  }

  /* The lead's blurb: desktop only. */
  .topic-windows__desc {
    display: none;
    max-width: 40ch;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: color-mix(in srgb, var(--media-glyph) 85%, transparent);
  }

  .topic-windows__tick {
    position: absolute;
    z-index: 3;
    top: var(--space-3);
    left: var(--space-3);
    display: grid;
    width: var(--space-6);
    height: var(--space-6);
    padding: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity var(--duration-fast) var(--ease-out),
      transform var(--duration-normal) var(--ease-out);
  }

  .topic-windows__plate[aria-pressed='true'] .topic-windows__tick {
    opacity: 1;
    transform: none;
  }

  /* The phone's Show all / Show fewer tile. */
  .topic-windows__more {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--color-surface) 40%, transparent);
    color: var(--color-text-primary);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    line-height: var(--leading-tight);
    text-align: center;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .topic-windows__more:hover {
    color: var(--color-brand-accent);
  }

  .topic-windows__more:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-sm) {
    .topic-windows__plate[data-phone-wide],
    .topic-windows__more[data-wide] {
      grid-column: span 2;
    }

    .topic-windows__plate[data-overflow] {
      display: none;
    }
  }

  @media (--breakpoint-sm) {
    .topic-windows__grid {
      --_cols: 12;
      --_unit: 4;
      --_gap: var(--space-3);
    }

    .topic-windows__plate[data-cols='3'] {
      grid-column: span 3;
    }

    .topic-windows__plate[data-cols='4'] {
      grid-column: span 4;
    }

    .topic-windows__plate[data-cols='6'] {
      grid-column: span 6;
    }

    .topic-windows__plate[data-cols='12'] {
      grid-column: span 12;
    }

    .topic-windows__plate[data-rows='2'] {
      grid-row: span 2;
    }

    .topic-windows__plate[data-lead] .topic-windows__initial {
      font-size: var(--text-display);
    }

    .topic-windows__plate[data-lead] .topic-windows__desc {
      display: -webkit-box;
    }

    .topic-windows__more {
      display: none;
    }
  }

  @media (--breakpoint-lg) {
    .topic-windows__grid {
      --_ratio: 0.625;
    }

    .topic-windows__label {
      padding: var(--_feather) var(--space-4) var(--space-4);
    }

    .topic-windows__name {
      font-size: var(--text-xl);
    }

    .topic-windows__plate[data-lead] .topic-windows__name {
      font-size: var(--text-4xl);
      letter-spacing: var(--tracking-tight);
    }
  }

  @media (hover: hover) {
    .topic-windows__plate:hover {
      transform: translateY(calc(-1 * var(--space-1)));
      box-shadow: var(--shadow-lg);
    }

    .topic-windows__plate[aria-pressed='true']:hover {
      box-shadow:
        0 0 0 var(--border-width-thick) var(--color-brand-accent),
        var(--shadow-lg);
    }

    /* The window brightens under the pointer. */
    .topic-windows__plate:hover :global(.topic-windows__window) {
      filter: saturate(1.3) brightness(1.15);
    }

    .topic-windows__plate:hover .topic-windows__photo {
      transform: scale(var(--card-image-hover-scale));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .topic-windows__plate,
    .topic-windows__photo,
    .topic-windows__tick,
    .topic-windows__more {
      transition: none;
    }

    .topic-windows__plate:hover,
    .topic-windows__plate:hover .topic-windows__photo {
      transform: none;
    }
  }
</style>
