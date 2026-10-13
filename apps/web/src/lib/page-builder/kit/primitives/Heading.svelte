<!--
  @component Heading

  A kit heading. The document LEVEL and the visual SIZE are separate on
  purpose: the page has one `<h1>` (the hero) whatever size it is drawn at,
  and a section heading may be drawn at display size without becoming an h1.

  COLOUR is the section's heading ink (`styles/schemes.css`): on the org's
  own surfaces, the org's heading colour — at display and heading size the
  large-text grade, at title size the text grade, since a title is not large
  text — and elsewhere the section's ink. A block that colours a heading
  itself still wins.

  Never faux-bold: `font-synthesis: none` lets a single-weight display face
  (Archivo Black, Anton…) render its real weight instead of a smeared
  synthetic one when the Style or brand asks for a heavier weight than exists.

  `build` makes it enter as ONE element as it scrolls into view
  (`styles/motion.css`). Its text is never split into words or letters: the
  canvas must keep identical markup, and a screen reader must meet one line.
-->
<script lang="ts">
  import type { SectionTypeId } from '../model/ids';
  import { widestRun } from '../model/long-heading';
  import type { BlockEdit } from '../model/types';
  import type { Build } from '../motion/attributes';
  import { editAttrs } from './edit';

  interface Props {
    level: 1 | 2 | 3 | 4;
    size?: 'display' | 'heading' | 'title';
    text: string;
    type: SectionTypeId;
    /** The props key this heading edits inline on the canvas. */
    field?: string;
    edit?: BlockEdit | null;
    build?: Build;
    id?: string;
    class?: string;
  }

  const {
    level,
    size = 'heading',
    text,
    type,
    field,
    edit = null,
    build,
    id,
    class: className,
  }: Props = $props();

  const tag = $derived(`h${level}`);
  const attrs = $derived(editAttrs(type, field, edit));
  /* Only a section heading is weighed: the type dial's `louder` grows that
     size alone, as far as its widest run fits (below, 03 X62). */
  const run = $derived(size === 'heading' ? widestRun(text) : undefined);
</script>

<svelte:element
  this={tag}
  {id}
  class="lp-heading {className ?? ''}"
  data-size={size}
  data-lp-build={build}
  style:--lp-heading-run-caps={run?.caps}
  style:--lp-heading-run-text={run?.text}
  style:--lp-heading-run-chars={run?.chars}
  {...attrs}>{text}</svelte:element
>

<style>
  .lp-heading {
    margin: 0;
    font-family: var(--lp-font-display);
    font-synthesis: none;
    color: var(--lp-heading-ink, currentColor);
    text-wrap: balance;
    overflow-wrap: break-word;
    hyphens: manual;
  }

  /* `--lp-display-scale` is a layout's hook (a split hero draws the display
     size smaller): a separate property, because re-declaring
     `--lp-size-display` in terms of itself would be a cycle. */
  .lp-heading[data-size='display'] {
    font-size: calc(var(--lp-size-display) * var(--lp-display-scale, 1));
    font-weight: var(--lp-weight-display);
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
    text-transform: var(--lp-case-display);
  }

  .lp-heading[data-size='heading'] {
    font-size: var(--lp-size-heading);
    font-weight: var(--lp-weight-heading);
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
  }

  /* The type dial's `louder` (03 X62) grows a section heading only as far as
     its widest run still fits its column, and never below the Style's own
     size. A fixed factor cut words: Poster's phone heading sits on its
     clamp's floor (2.1rem), where "Transformation:" just fits, so every step
     above 1 cut it. A run is weighed in the page's display face
     (`styles/faces.css`): as written, or in capitals where a Style draws them
     (`--lp-heading-face` and `--lp-heading-run`, set where it sets the case).
     Its column is the section's content column (`--lp-column`). Where a
     layout gives its head less room, it names that room
     (`--lp-heading-column`): a measure's cap, a split's share, or `0px` where
     the head shares a row with something drawn at its own width, which
     holds the heading at the Style's size. A heading with no words grows the
     whole step. */
  :global(.lp[data-lp-drama='louder']) .lp-heading[data-size='heading'] {
    --_own: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
    --_column: min(
      var(--lp-column, 100cqi),
      var(--lp-heading-column, var(--lp-column, 100cqi))
    );
    --_em: max(
      0.01,
      var(--lp-heading-run, var(--lp-heading-run-text, 0)) *
        var(--lp-heading-face, var(--lp-face-text)) +
        var(--lp-heading-run-chars, 0) * var(--_track, 0)
    );
    font-size: min(var(--lp-size-heading), max(var(--_own), var(--_column) / var(--_em)));
  }

  /* The Style's tracking per character, in em: a real property, since a test
     of a custom one always passes. Without it the run is reckoned untracked,
     which only reads it wider (every Style tracks its headings tight). */
  @supports (width: calc(1px * (1px / 1px))) {
    :global(.lp[data-lp-drama='louder']) .lp-heading[data-size='heading'] {
      --_track: calc(var(--lp-tracking-heading) / 1em);
    }
  }

  /* `--lp-title-lift` is a layout's hook too: how far a title steps toward
     the heading's size (0 the title, 1 the heading), so a name that is a
     promise rather than a caption reads at a middle size in every Style's own
     scale, and stays a title in all else: its ink grade, its build, its face.
     It lifts toward the heading's size as the type dial takes it down, never
     up: `louder` is for headings, and a lifted title sits in a card's column,
     where the heading's room is not its own (03 X62). */
  .lp-heading[data-size='title'] {
    --_heading: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
    font-size: calc(
      var(--lp-size-title) +
        (var(--_heading) - var(--lp-size-title)) * var(--lp-title-lift, 0)
    );
    color: var(--lp-title-ink, currentColor);
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }
</style>
