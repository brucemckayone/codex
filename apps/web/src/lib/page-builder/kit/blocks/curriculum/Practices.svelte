<!--
  @component Practices

  A stage's practices, in order. Each practice's kind reads by the SHAPE of a
  small icon — never a coloured pill — and is spoken after its title for a
  screen reader. `ruled` parts them with hairlines (timeline, accordion); a
  card lists them plainly.
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
    <li class="practice">
      <span class="practice__icon"><Icon size="1em" /></span>
      <span>
        {practice.title}<span class="sr-only">{`, ${CURRICULUM_COPY.type(practice.contentType)}`}</span>
      </span>
    </li>
  {/each}
</ul>

<style>
  .practices {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .practice {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
    color: var(--lp-ink);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  /* On the title's first line, however it wraps. */
  .practice__icon {
    display: inline-flex;
    align-self: start;
    margin-block-start: calc((1lh - 1em) / 2);
    color: var(--lp-ink-soft);
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
