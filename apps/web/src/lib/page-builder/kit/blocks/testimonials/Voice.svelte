<!--
  @component Voice

  One quote and who said it. `grid` and `quiet` set it in the body face to be
  read; `lead` and `monument` set it like a heading, a step smaller the more it
  says, so a long quote stays a readable measure and a short one fills its
  stage. `wall` sets it by its length within a narrow tile: a short quote, or
  the `featured` one, in the display face; a long one in the body face. The
  opening mark hangs outside the text's edge so the words line up; the
  monument stands its mark above it instead.

  `faces` (Codex-61zsk.58): once one quote in the section has a photo, each
  byline leads with a round face, the photo or, with none, the initials of the
  name (a quote with neither has no circle), so the names line up. The face
  is decoration: the name is what reads.
-->
<script lang="ts">
  import { resolvePageImageUrl, storedFocus } from '../../../page-images';
  import { initials } from '../../model/initials';
  import Media from '../../primitives/Media.svelte';
  import type { Testimonial } from './voices';

  interface Props {
    voice: Testimonial;
    size?: 'grid' | 'quiet' | 'lead' | 'monument' | 'wall';
    centred?: boolean;
    /** `wall` only: the featured tile's quote, set large whatever its length. */
    featured?: boolean;
    /** The section draws faces: one of its quotes has a photo. */
    faces?: boolean;
    /** Where the creator's photos are served from. */
    mediaBaseUrl?: string | null;
  }

  const {
    voice,
    size = 'grid',
    centred = false,
    featured = false,
    faces = false,
    mediaBaseUrl = null,
  }: Props = $props();

  // A 2.5rem circle: the smallest stored size covers it twice over.
  const photo = $derived(faces ? resolvePageImageUrl(voice.photo, 'sm', mediaBaseUrl) : null);
  const letters = $derived(faces ? initials(voice.name) : '');
  const face = $derived(Boolean(photo || letters));
</script>

<figure
  class="voice"
  data-size={size}
  data-length={voice.length}
  data-centred={centred ? '' : undefined}
  data-featured={featured ? '' : undefined}
>
  <blockquote class="voice__quote"><p>{voice.quote}</p></blockquote>
  {#if voice.name || voice.detail || face}
    <figcaption class="voice__by" data-face={face ? '' : undefined}>
      {#if face}
        <Media
          class="voice__face"
          image={photo}
          alt=""
          ratio="1 / 1"
          focus={storedFocus(voice.photo)}
          mark={letters || undefined}
        />
      {/if}
      {#if voice.name}<span class="voice__name">{voice.name}</span>{/if}
      {#if voice.detail}<span class="voice__detail">{voice.detail}</span>{/if}
    </figcaption>
  {/if}
</figure>

<style>
  /* The quote's size (`--lp-size-quote`) and the share of it its opening mark
     hangs by (`--_hang`) are set on the voice, not on its words, so that what
     holds a voice can make the mark's room from them: `--lp-voice-room`, which
     the wall and the strip pad the voice by. The size is type, so a Type may
     set it (03 X73) and the room follows. Nothing restates a size. */
  .voice {
    --lp-size-quote: var(--lp-size-lead);
    --_hang: 0.4;
    --lp-voice-room: calc(var(--lp-size-quote) * var(--_hang));
    display: grid;
    align-content: start;
    gap: var(--space-4);
    margin: 0;
    color: var(--lp-ink);
  }

  /* Resets the app's prose blockquote (brand bar, italic, secondary grey). */
  .voice__quote {
    margin: 0;
    padding: 0;
    border: none;
    quotes: '“' '”' '‘' '’';
    color: inherit;
    font-style: normal;
  }

  .voice__quote p {
    max-inline-size: none;
    margin: 0;
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-quote);
    line-height: var(--lp-leading-lead);
    text-wrap: pretty;
    text-indent: calc(var(--_hang) * -1em);
  }

  .voice__quote p::before {
    content: open-quote;
  }

  .voice__quote p::after {
    content: close-quote;
  }

  .voice[data-size='grid'][data-length='long'],
  .voice[data-size='quiet'] {
    --lp-size-quote: var(--lp-size-body);
  }

  .voice[data-size='grid'][data-length='long'] p,
  .voice[data-size='quiet'] p {
    line-height: var(--lp-leading-body);
  }

  /* ── lead / monument: set like headings ────────────────────────────────── */
  .voice:is([data-size='lead'], [data-size='monument']) {
    --lp-size-quote: calc((var(--lp-size-heading) * var(--lp-drama-held, 1) + var(--lp-size-title)) / 2);
    --_hang: 0.42;
  }

  .voice:is([data-size='lead'], [data-size='monument']) p {
    font-family: var(--lp-font-display);
    font-weight: var(--lp-weight-heading);
    font-synthesis: none;
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
    text-wrap: balance;
    text-indent: calc(var(--_hang) * -1em);
  }

  .voice[data-size='lead'] p {
    max-inline-size: 30ch;
  }

  .voice[data-size='monument'] p {
    max-inline-size: 26ch;
  }

  .voice[data-size='monument'][data-length='short'] {
    --lp-size-quote: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
  }

  .voice[data-size='monument'][data-length='short'] p {
    max-inline-size: 20ch;
  }

  .voice:is([data-size='lead'], [data-size='monument'])[data-length='long'] {
    --lp-size-quote: var(--lp-size-title);
  }

  .voice:is([data-size='lead'], [data-size='monument'])[data-length='long'] p {
    max-inline-size: 38ch;
    font-weight: var(--lp-weight-title);
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  .voice:is([data-size='lead'], [data-size='monument']) .voice__by {
    font-size: var(--lp-size-body);
  }

  /* Wide, the lead's byline signs off at the panel's far corner, so the
     measured quote and its name fill the plate between them. */
  @container (min-width: 60rem) {
    .voice[data-size='lead'] {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      column-gap: var(--lp-gap);
    }

    .voice[data-size='lead'] .voice__by {
      text-align: end;
    }
  }

  /* The monument's opening mark stands above it, large; the closing one goes. */
  .voice[data-size='monument'] p::before {
    display: block;
    margin-block-end: -0.42em;
    color: var(--lp-accent);
    font-size: 2.4em;
    line-height: 1;
  }

  .voice[data-size='monument'] p::after {
    content: no-close-quote;
  }

  /* ── wall: set by its length, in a narrow tile ─────────────────────────── */
  .voice[data-size='wall'][data-length='long'] {
    --lp-size-quote: var(--lp-size-body);
  }

  .voice[data-size='wall'][data-length='long'] p {
    line-height: var(--lp-leading-body);
  }

  /* A short quote, and the featured one, take the display face: the few
     words that land hardest take the most room. */
  .voice[data-size='wall']:is([data-length='short'], [data-featured]) {
    --lp-size-quote: var(--lp-size-title);
    --_hang: 0.42;
  }

  .voice[data-size='wall']:is([data-length='short'], [data-featured]) p {
    font-family: var(--lp-font-display);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
    text-indent: calc(var(--_hang) * -1em);
  }

  .voice[data-size='wall'][data-featured]:not([data-length='long']) {
    --lp-size-quote: calc((var(--lp-size-heading) * var(--lp-drama-held, 1) + var(--lp-size-title)) / 2);
  }

  .voice[data-size='wall'][data-featured]:not([data-length='long']) p {
    font-weight: var(--lp-weight-heading);
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
  }

  .voice[data-centred] {
    justify-items: center;
    text-align: center;
  }

  .voice[data-centred] p {
    margin-inline: auto;
    text-indent: 0;
  }

  /* ── who said it ───────────────────────────────────────────────────────── */
  .voice__by {
    display: grid;
    gap: var(--space-0-5);
    margin: 0;
    color: var(--lp-ink);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
  }

  .voice__name {
    font-weight: var(--font-semibold);
  }

  .voice__detail {
    color: var(--lp-ink-soft);
  }

  /* ── the face: a circle beside the name and detail, centred on the pair ─── */
  .voice__by[data-face] {
    grid-template-columns: var(--space-10) minmax(0, auto);
    align-items: center;
    justify-content: start;
    column-gap: var(--space-3);
    row-gap: 0;
  }

  .voice__by[data-face] > :is(.voice__name, .voice__detail) {
    grid-column: 2;
  }

  .voice[data-centred] .voice__by[data-face] {
    justify-content: center;
    text-align: start;
  }

  @container (min-width: 60rem) {
    .voice[data-size='lead'] .voice__by[data-face] {
      justify-content: end;
    }
  }

  /* The initials sit on the panel, in its ink, as the guide's face does
     (03 X57), inside a hairline of the section's own line, so the circle
     holds on a ground as pale as the panel and on a filled panel too. */
  .voice__by :global(.voice__face) {
    grid-column: 1;
    grid-row: 1 / span 2;
    inline-size: var(--space-10);
    border-radius: var(--radius-full);
  }

  .voice__by :global(.voice__face[data-mark]) {
    background: var(--lp-panel);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-line);
    color: var(--lp-panel-ink);
  }

  .voice__by[data-face]:not(:has(.voice__name ~ .voice__detail)) :global(.voice__face) {
    grid-row: 1;
  }
</style>
