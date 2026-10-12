<!--
  @component Practices

  A stage's practices, in order, each with what it is and how long it takes:
  "Video · 13 min", or the kind alone when nobody measured its length (a
  reading, or a film never probed). The kind also reads by the SHAPE of a
  small icon — never a coloured pill. Where the list has room the kind and
  length sit beside the title; in a narrow card or on a phone, under it — the
  list measures its own width, since a card is narrow on a wide band.
  `ruled` parts them with hairlines (the expandable list); elsewhere they
  stand plainly.
-->
<script lang="ts">
  import { FileTextIcon, MusicIcon, VideoIcon } from '$lib/components/ui/Icon';
  import type { JourneyPracticeView } from '$lib/page-builder';
  import { CURRICULUM_COPY } from './copy';

  interface Props {
    practices: readonly JourneyPracticeView[];
    ruled?: boolean;
  }

  const { practices, ruled = false }: Props = $props();

  const ICONS = { video: VideoIcon, audio: MusicIcon, written: FileTextIcon } as const;
</script>

<ul class="practices" data-ruled={ruled ? '' : undefined}>
  {#each practices as practice, index (index)}
    {@const Icon = ICONS[practice.contentType] ?? VideoIcon}
    {@const length = CURRICULUM_COPY.length(practice.durationSeconds)}
    <!-- Spoken "title, kind, length": the pieces touch, the commas are hidden
         and the dot between kind and length is drawn. -->
    <li class="practice">
      <span class="practice__icon"><Icon size="1em" /></span
      ><span class="practice__name">{practice.title}</span
      ><span class="practice__meta"
        ><span class="sr-only">{', '}</span>{CURRICULUM_COPY.kind(practice.contentType)}{#if length}<span
            class="practice__length"><span class="sr-only">{', '}</span>{length}</span
          >{/if}</span
      >
    </li>
  {/each}
</ul>

<style>
  .practices {
    container-type: inline-size;
    display: grid;
    gap: var(--space-3);
    /* A size container takes no width from its content: in a centring
       parent it would shrink to nothing. */
    inline-size: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .practice {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr);
    grid-template-areas:
      'icon title'
      '. meta';
    align-items: baseline;
    column-gap: var(--space-2);
    margin: 0;
    color: var(--lp-ink);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  /* On the title's first line, however it wraps. */
  .practice__icon {
    grid-area: icon;
    display: inline-flex;
    align-self: start;
    margin-block-start: calc((1lh - 1em) / 2);
    color: var(--lp-ink-soft);
  }

  .practice__name {
    grid-area: title;
  }

  .practice__meta {
    grid-area: meta;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-body);
    white-space: nowrap;
  }

  .practice__length::before {
    content: '·' / '';
    margin-inline: 0.4em;
  }

  /* Room for both: the kind and length close the title's line. */
  @container (min-width: 26rem) {
    .practice {
      grid-template-columns: var(--space-6) minmax(0, 1fr) auto;
      grid-template-areas: 'icon title meta';
    }

    .practice__meta {
      padding-inline-start: var(--space-4);
    }
  }

  .practices[data-ruled] {
    gap: 0;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .practices[data-ruled] .practice {
    padding-block: var(--space-3);
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }
</style>
