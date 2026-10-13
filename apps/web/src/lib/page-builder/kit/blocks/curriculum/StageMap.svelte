<!--
  @component StageMap

  The journey map: the course's stages as stops on a drawn route. Each stop is
  a native `<details>` — its summary the stage's number, name and practice
  count, its body the stage's line and practices — so it opens and closes, and
  find-in-page reaches inside, without any script. The first stop that holds
  anything starts open; a stage with nothing inside is a plain stop.

  The route is decoration (`aria-hidden`), drawn in two pieces per stop so it
  stays joined however tall an open stop grows: a line down from the marker,
  then a bend across the gap to the next marker. Wide, the stops step from
  side to side and the route winds; narrow, they line up and it runs straight.

  A stop's name and its count are one `<hgroup>`, the heading and its line, so
  the name's track is the whole room between the marker and the sign: the
  room its title is fitted to (03 X71). The count sits beside the name while
  the name's longest word leaves it room, and under the name when it does not.
-->
<script lang="ts">
  import type { JourneyStageView } from '$lib/page-builder';
  import Heading from '../../primitives/Heading.svelte';
  import { CURRICULUM_COPY } from './copy';
  import Practices from './Practices.svelte';

  interface Props {
    stages: readonly JourneyStageView[];
    level: 2 | 3;
  }

  const { stages, level }: Props = $props();

  const opens = (stage: JourneyStageView) => stage.practices.length > 0 || !!stage.gloss;
  const firstOpen = $derived(stages.findIndex(opens));
</script>

{#snippet marker(index: number)}
  <span class="map__marker"><span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}</span>
{/snippet}

<ol class="map" data-count={stages.length}>
  {#each stages as stage, index (stage.id)}
    <li class="map__stage">
      {#if index < stages.length - 1}
        <svg class="map__line" viewBox="0 0 2 100" preserveAspectRatio="none" aria-hidden="true" data-lp-draw>
          <path d="M1 0V100" pathLength="1" />
        </svg>
        <svg class="map__bend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-lp-draw>
          <path d="M0 0C0 60 100 40 100 100" pathLength="1" />
        </svg>
      {/if}
      {#if opens(stage)}
        <details class="map__stop" open={index === firstOpen}>
          <summary class="map__summary">
            {@render marker(index)}
            <hgroup class="map__head">
              <Heading {level} size="title" text={stage.name} type="curriculum" class="map__name" />
              {#if stage.practices.length > 0}
                <p class="map__count">{CURRICULUM_COPY.practices(stage.practices.length)}</p>
              {/if}
            </hgroup>
            <span class="map__sign" aria-hidden="true"></span>
          </summary>
          <div class="map__inside">
            {#if stage.gloss}<p class="map__gloss">{stage.gloss}</p>{/if}
            {#if stage.practices.length > 0}<Practices practices={stage.practices} ruled />{/if}
          </div>
        </details>
      {:else}
        <div class="map__stop">
          <div class="map__summary">
            {@render marker(index)}
            <hgroup class="map__head">
              <Heading {level} size="title" text={stage.name} type="curriculum" class="map__name" />
            </hgroup>
          </div>
        </div>
      {/if}
    </li>
  {/each}
</ol>

<style>
  /* A stop is the list's width while the stops line up, and 60% of it where
     they step (below). The list is the column, and past it whatever reach a
     Style gives it: Path pulls it out onto the page's route
     (style-path.css), and its margin is drawn from that reach. */
  .map {
    --_dot: var(--space-12);
    --_gap: clamp(var(--space-10), var(--space-6) + 4cqi, var(--space-20));
    --_route: var(--border-width-thick);
    --_sign: var(--space-5);
    --_beside: var(--space-4);
    --_reach: 0px;
    --_stop: calc(var(--lp-column) + var(--_reach));
    display: grid;
    row-gap: var(--_gap);
    margin: 0;
    margin-inline-start: calc(-1 * var(--_reach));
    padding: 0;
    list-style: none;
    interpolate-size: allow-keywords;
  }

  /* base.css spaces every `li` but the last. */
  .map__stage {
    position: relative;
    margin: 0;
  }

  /* ── the route ─────────────────────────────────────────────────────────── */
  .map__line,
  .map__bend {
    position: absolute;
    overflow: visible;
    fill: none;
    stroke: var(--lp-button-line);
    stroke-width: var(--_route);
    stroke-linecap: round;
    pointer-events: none;
  }

  .map__line path,
  .map__bend path {
    vector-effect: non-scaling-stroke;
  }

  /* From under this stop's marker to the next one: straight through the gap
     while the stops line up. An SVG sizes like an image, so its height is
     set outright — insets alone would leave it at its viewBox's ratio. */
  .map__line {
    inset-block-start: var(--_dot);
    inset-inline-start: calc(var(--_dot) / 2 - var(--_route) / 2);
    inline-size: var(--_route);
    block-size: calc(100% - var(--_dot) + var(--_gap));
  }

  .map__bend {
    display: none;
  }

  /* ── a stop ────────────────────────────────────────────────────────────── */
  /* The name's room is its track: the stop, less the marker, the sign and the
     gaps beside them (03 X71). */
  .map__summary {
    --lp-title-column: calc(var(--_stop) - var(--_dot) - var(--_sign) - 2 * var(--_beside));
    display: grid;
    grid-template-columns: var(--_dot) minmax(0, 1fr) var(--_sign);
    align-items: start;
    column-gap: var(--_beside);
    color: var(--lp-ink);
    list-style: none;
  }

  /* A stop with nothing inside has no count and nothing to open. */
  div.map__summary {
    --lp-title-column: calc(var(--_stop) - var(--_dot) - var(--_beside));
    grid-template-columns: var(--_dot) minmax(0, 1fr);
  }

  /* The count stands beside the name while the name's longest word leaves it
     room, on the name's first line, and under the name when it does not, so
     a long word has the whole track. A title never hyphenates, so its
     narrowest is that word, and capped at the track it breaks rather than
     overruns. */
  .map__head {
    display: flex;
    flex-wrap: wrap;
    align-items: first baseline;
    gap: var(--space-0-5) var(--_beside);
    margin: 0;
  }

  .map__head > :global(.map__name) {
    flex: 1 1 0;
    max-inline-size: 100%;
  }

  details > .map__summary {
    cursor: pointer;
  }

  details > .map__summary::-webkit-details-marker {
    display: none;
  }

  /* On the marker's middle, however the name wraps. */
  .map__head > :global(.map__name) {
    padding-block-start: max(var(--space-0), calc((var(--_dot) - 1lh) / 2));
  }

  .map__marker {
    position: relative;
    display: grid;
    place-items: center;
    inline-size: var(--_dot);
    block-size: var(--_dot);
    border: var(--_route) var(--border-style) var(--lp-accent);
    border-radius: var(--radius-full);
    background: var(--lp-bg);
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-body);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: 1;
  }

  /* The open stop is where the visitor is looking: its marker fills. */
  details[open] .map__marker {
    border-color: var(--lp-button-bg);
    background: var(--lp-button-bg);
    color: var(--lp-button-ink);
  }

  .map__count {
    flex: none;
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
    white-space: nowrap;
  }

  /* A plus that folds into a minus as the stop opens. */
  .map__sign {
    position: relative;
    block-size: var(--space-5);
    margin-block-start: calc((var(--_dot) - var(--space-5)) / 2);
  }

  .map__sign::before,
  .map__sign::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(50% - var(--lp-rule) / 2);
    block-size: var(--lp-rule);
    background: currentColor;
  }

  .map__sign::after {
    rotate: 90deg;
  }

  details[open] .map__sign::after {
    rotate: 0deg;
  }

  @media (hover: hover) {
    details > .map__summary:hover :global(.map__name) {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  .map__inside {
    display: grid;
    gap: var(--space-4);
    padding-block: var(--space-4) var(--space-2);
    padding-inline-start: calc(var(--_dot) + var(--space-4));
  }

  .map__gloss {
    max-inline-size: var(--lp-measure);
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* A phone: the count tucks under the name, the two beside the marker. */
  @container (max-width: 30rem) {
    .map__head {
      align-self: center;
    }

    .map__head:has(.map__count) > :global(.map__name) {
      padding-block-start: var(--space-0-5);
    }

    .map__count {
      flex-basis: 100%;
    }

    .map__sign {
      align-self: center;
      margin-block-start: 0;
    }
  }

  /* Wide: the stops step from side to side and the route bends between them.
     A stop is 60% of the list, so the far side begins 40% in — two thirds of
     a stop's own width, which is what the bend spans. */
  @container (min-width: 48rem) {
    .map {
      --_stop: calc((var(--lp-column) + var(--_reach)) * 0.6);
    }

    .map__stage {
      inline-size: 60%;
    }

    .map__stage:nth-child(even) {
      margin-inline-start: 40%;
    }

    .map__line {
      block-size: calc(100% - var(--_dot));
    }

    .map__bend {
      display: block;
      inset-block: 100% auto;
      inset-inline-start: calc(var(--_dot) / 2);
      inline-size: calc(100% * 2 / 3);
      block-size: var(--_gap);
    }

    .map__stage:nth-child(even) .map__bend {
      inset-inline-start: calc(var(--_dot) / 2 - 100% * 2 / 3);
      scale: -1 1;
    }
  }

  /* The stop opens rather than snaps, where the browser can animate it. */
  @media (prefers-reduced-motion: no-preference) {
    :global(.lp:not([data-lp-still], [data-lp-motion='still'])) .map__stop::details-content {
      block-size: 0;
      overflow: clip;
      transition:
        block-size var(--duration-slow) var(--ease-out),
        content-visibility var(--duration-slow) allow-discrete;
    }

    :global(.lp:not([data-lp-still], [data-lp-motion='still'])) .map__stop[open]::details-content {
      block-size: auto;
    }

    :global(.lp:not([data-lp-still], [data-lp-motion='still'])) .map__sign::after {
      transition: rotate var(--duration-fast) var(--ease-out);
    }
  }
</style>
