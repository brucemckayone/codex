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
    /** The canvas's faint words for an empty heading the creator types into. Never on the public page. */
    placeholder?: string;
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
    placeholder,
  }: Props = $props();

  const tag = $derived(`h${level}`);
  const attrs = $derived(editAttrs(type, field, edit));
  /* Every heading is weighed, and drawn no larger than its widest run fits
     its room (below, 03 X66, X71), but the hero's headline: its own layouts
     size it (X60), and with no weight it is drawn at the size they give it. */
  const run = $derived(size === 'display' && type === 'hero' ? undefined : widestRun(text));
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
  data-placeholder={edit && !text ? placeholder : undefined}
  {...attrs}>{text}</svelte:element
>

<style>
  /* Each size below is drawn no larger than its widest run fits its room
     (03 X66, X71), so no word is cut and none runs over what sits beside it.
     The run's width in em of the heading's own size is weighed here once: in
     the page's display face (`styles/faces.css`), as written, or in capitals
     where a Style draws them (`--lp-heading-face` and `--lp-heading-run`, set
     where it sets the case), with the size's own tracking per letter (below).
     A heading with no words weighs nothing, and is drawn at the size the dial
     gives it. A heading may be held at its size whatever its words
     (`--lp-heading-hold: 1`), which the fit's own sweep uses to draw it as it
     was; no layout holds one (X70). */
  .lp-heading {
    --_hold: var(--lp-heading-hold, 0);
    --_em: max(
      0.01,
      var(--lp-heading-run, var(--lp-heading-run-text, 0)) *
        var(--lp-heading-face, var(--lp-face-text)) +
        var(--lp-heading-run-chars, 0) * var(--_track, 0)
    );
    margin: 0;
    font-family: var(--lp-font-display);
    font-synthesis: none;
    color: var(--lp-heading-ink, currentColor);
    text-wrap: balance;
    overflow-wrap: break-word;
    hyphens: manual;
  }

  /* An empty heading on the canvas shows what to type, in the soft ink. */
  .lp-heading[data-placeholder]:empty::before {
    content: attr(data-placeholder);
    color: var(--lp-ink-soft);
  }

  /* `--lp-display-scale` is a layout's hook (a split hero draws the display
     size smaller): a separate property, because re-declaring
     `--lp-size-display` in terms of itself would be a cycle.
     A display statement is fitted as a section heading is (below, 03 X71):
     its room is the section's column, or the one its layout names, and it is
     never drawn smaller than a title. A fixed size cut words: Bold's problem
     statement draws "Transformation:" wider than a phone's column. */
  .lp-heading[data-size='display'] {
    --_own: calc(var(--lp-size-display) * var(--lp-display-scale, 1));
    --_column: min(
      var(--lp-column, 100cqi),
      var(--lp-heading-column, var(--lp-column, 100cqi))
    );
    font-size: min(
      var(--_own),
      max(
        var(--lp-size-title, 0px),
        var(--_hold) * var(--_own),
        (1 - var(--_hold)) * var(--_column) / var(--_em)
      )
    );
    font-weight: var(--lp-weight-display);
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
    text-transform: var(--lp-case-display);
  }

  /* A section heading is drawn no larger than its widest run fits its room
     (03 X66, as the poster's headline is, X60): at the Style's own size
     wherever its words fit, and only as much smaller as a word needs. The
     type dial moves the size this caps (`--lp-size-heading`): `louder` (X62)
     grows a heading only as far as its widest run still fits, `calmer` takes
     it down. A fixed size cut words: Poster's FAQ draws "Transformation:" at
     74.56px in a 5/12 track at 1440, across the questions.
     Its room is the section's content column (`--lp-column`). Where a layout
     gives its head less room, it names that room (`--lp-heading-column`): a
     measure's cap, or a split's share. It is never drawn smaller than a
     title, so it stays a head, and a room that came to nothing could never
     draw it at no size at all; a word too long even at that runs past its
     line. */
  .lp-heading[data-size='heading'] {
    --_own: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
    --_column: min(
      var(--lp-column, 100cqi),
      var(--lp-heading-column, var(--lp-column, 100cqi))
    );
    font-size: min(
      var(--lp-size-heading),
      max(
        var(--lp-size-title, 0px),
        var(--_hold) * var(--_own),
        (1 - var(--_hold)) * var(--_column) / var(--_em)
      )
    );
    font-weight: var(--lp-weight-heading);
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
  }

  /* The Style's tracking per character at each size, in em: a real property,
     since a test of a custom one always passes. Without it the run is
     reckoned untracked, which only reads it wider (every Style tracks its
     headings tight). */
  @supports (width: calc(1px * (1px / 1px))) {
    .lp-heading[data-size='display'] {
      --_track: calc(var(--lp-tracking-display) / 1em);
    }

    .lp-heading[data-size='heading'] {
      --_track: calc(var(--lp-tracking-heading) / 1em);
    }

    .lp-heading[data-size='title'] {
      --_track: calc(var(--lp-tracking-title) / 1em);
    }
  }

  /* `--lp-title-lift` is a layout's hook too: how far a title steps toward
     the heading's size (0 the title, 1 the heading), so a name that is a
     promise rather than a caption reads at a middle size in every Style's own
     scale, and stays a title in all else: its ink grade, its build, its face.
     It lifts toward the heading's size as the type dial takes it down, never
     up: `louder` is for headings, and a lifted title sits in a card's column,
     where the heading's room is not its own (03 X62).
     A title is fitted as a section heading is (03 X71), never smaller than
     the body, so it stays a title. Its room is its card's, which its layout
     names (`--lp-title-column`: its share of the column, less the card's
     inset), and never more than the section's column or the room its head
     names. A title whose card names no room is fitted to those, which are
     never narrower than its card. A fixed size cut words: Path's benefits
     draw "Transformation:" a quarter wider than its card at 1024. */
  .lp-heading[data-size='title'] {
    --_heading: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
    --_own: calc(
      var(--lp-size-title) +
        (var(--_heading) - var(--lp-size-title)) * var(--lp-title-lift, 0)
    );
    --_column: min(
      var(--lp-column, 100cqi),
      var(--lp-heading-column, var(--lp-column, 100cqi)),
      var(--lp-title-column, var(--lp-column, 100cqi))
    );
    font-size: min(
      var(--_own),
      max(
        var(--lp-size-body, 0px),
        var(--_hold) * var(--_own),
        (1 - var(--_hold)) * var(--_column) / var(--_em)
      )
    );
    color: var(--lp-title-ink, currentColor);
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }
</style>
