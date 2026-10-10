<!--
  @component VideoBlock

  The introduction film, shown large. Two layouts:
    theatre — the words first, then the film on a wide screen with its play
              button centred and the caption beneath (edge to edge in Bold,
              lit from behind in Cinematic's dark room)
    split   — the film as the larger half beside the words (running off the
              band's leading edge in Bold)

  The film streams on `sellPreview`, so the server cannot know it: it sends
  the section whole, the screen holding its ratio (its HTML is the final
  state, 03 §10). Once the stream settles with no film, the public page
  never leaves its words above nothing (Codex-61zsk.37): the section draws
  nothing and its band folds away. Where the page is looked at (the canvas, a
  still thumbnail) the section keeps its screen, the kit's plate in it, and
  on the canvas a prompt for the film. The button row appears only when the
  creator writes one.
-->
<script lang="ts">
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import { editAttrs } from '../../primitives/edit';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { settled } from '../hero/settled.svelte';
  import ClipFrame from './ClipFrame.svelte';
  import { VIDEO_COPY } from './copy';
  import { VIDEO_PROMPT, videoDefinition } from './definition';
  import Watch from './Watch.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(videoDefinition.coerce(props));
  const split = $derived(section.layout === 'split');
  const title = $derived(content.heading ?? context.course.title);
  const hasWords = $derived(Boolean(content.eyebrow || content.heading || content.body));
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const captionAttrs = $derived(editAttrs('video', 'caption', edit));

  // The film once the stream settles, read in place (`settled.svelte.ts`):
  // `undefined` until then and on the server, `null` if the read failed.
  const preview = $derived(settled(context.sellPreview));
  const pending = $derived(preview === undefined);
  const clip = $derived(preview?.intro ?? null);
  // Settled with no film: the public page has nothing to show for it.
  const filmless = $derived(!pending && !clip);
  const shown = $derived(!filmless || page.still || !!edit);
  // A section with no film is the creator's alone: the canvas's own.
  const creatorOnly = $derived(filmless ? '' : undefined);
</script>

{#snippet words()}
  {#if content.eyebrow || content.heading}
    <div class="video__top">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="video" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="video"
          field="heading"
          {edit}
        />
      {/if}
    </div>
  {/if}
  {#if content.body}
    <Text text={content.body} size="lead" type="video" field="body" {edit} />
  {/if}
{/snippet}

{#snippet actions()}
  {#if hasCta}
    <div class="video__actions" data-lp-edit-only={creatorOnly}>
      <ButtonRow
        {context}
        section="video"
        label={content.ctaLabel}
        note={content.note}
        size="md"
        {edit}
      />
    </div>
  {/if}
{/snippet}

{#snippet screen()}
  <figure class="video__screen" data-layout={section.layout} data-lp-edit-only={creatorOnly}>
    <span class="lp-atmos video__glow" aria-hidden="true"></span>
    {#if clip}
      <ClipFrame still={clip.posterUrl} ratio="var(--_ratio)" place={split ? 'corner' : 'center'}>
        <Watch {clip} label={VIDEO_COPY.watch} {title} {edit} />
      </ClipFrame>
    {:else}
      <ClipFrame
        ratio="var(--_ratio)"
        {pending}
        prompt={edit && !pending ? VIDEO_PROMPT : undefined}
      />
    {/if}
    {#if content.caption}
      <figcaption class="video__caption" {...captionAttrs}>{content.caption}</figcaption>
    {/if}
  </figure>
{/snippet}

{#if filmless}
  <!-- No film: the live page folds this band away. -->
  <span class="video-none" hidden></span>
{/if}
{#if shown}
  {#if split}
    <div class="video-split" data-lp-edit-only={creatorOnly}>
      {#if hasWords || hasCta}
        <div class="video-split__words">{@render words()}{@render actions()}</div>
      {/if}
      {@render screen()}
    </div>
  {:else}
    <!-- Side by side, no space between: nothing is left behind when the
         canvas's own parts are set aside. -->
    {#if hasWords}<div class="video-head" data-lp-edit-only={creatorOnly}>{@render words()}</div>{/if}{@render screen()}{@render actions()}
  {/if}
{/if}

<style>
  /* ── no film on the live page: no band either ──────────────────────────── */
  :global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .video-none)) {
    display: none;
  }

  /* ── shared ────────────────────────────────────────────────────────────── */
  .video__top,
  .video-head,
  .video-split__words {
    display: grid;
    gap: var(--lp-stack);
  }

  .video__screen,
  .video-split {
    /* From the band's edge to the content column's: what a bleeding part
       pads by to keep its words in line with everything else. */
    --_edge: max(var(--lp-gutter), calc((100cqi - var(--lp-container)) / 2));
  }

  .video__screen {
    --_ratio: 16 / 9;
    position: relative;
    isolation: isolate;
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }

  .video__caption {
    margin: 0;
    max-inline-size: var(--lp-measure);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  /* Cinematic's screen lights the room around it; on a light band the same
     glow would only be a gradient wash. */
  .video__glow {
    display: none;
  }

  :global(.lp[data-lp-style='cinematic']) .video__glow {
    display: block;
    inset: 6% -4% 14%;
    --lp-atmos-strength: 0.38;
  }

  /* ── theatre ───────────────────────────────────────────────────────────── */
  /* Bold and Clean set the heading and its words on one line, the words
     settling on the heading's last line; Soft and Cinematic centre both. */
  @container (min-width: 52rem) {
    :global(.lp:is([data-lp-style='bold'], [data-lp-style='clean'])) .video-head {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: var(--lp-gap);
      align-items: end;
    }
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head,
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head .video__top {
    justify-items: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-eyebrow),
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-text) {
    justify-self: center;
  }

  /* A centred paragraph never ends on a lone word. On the `p` itself: the
     app's prose rule sets `text-wrap` there, which inheritance cannot beat. */
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video-head :global(.lp-text p) {
    text-wrap: balance;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .video__screen[data-layout='theatre']
    .video__caption {
    justify-self: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .video__actions {
    --lp-actions-align: center;
  }

  /* Bold: the screen runs edge to edge; its caption stays in the column. */
  :global(.lp[data-lp-style='bold']) .video__screen[data-layout='theatre'] {
    grid-column: bleed;
  }

  :global(.lp[data-lp-style='bold']) .video__screen[data-layout='theatre'] .video__caption {
    padding-inline: var(--_edge);
  }

  @container (min-width: 48rem) {
    :global(.lp[data-lp-style='bold']) .video__screen[data-layout='theatre'] {
      --_ratio: 21 / 9;
    }
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .video-split {
    display: grid;
    gap: var(--lp-gap);
    align-items: center;
  }

  @container (min-width: 56rem) {
    .video-split:has(> .video__screen):has(> .video-split__words) {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.25);
    }

    .video-split:has(> .video-split__words) > .video__screen {
      grid-row: 1;
      grid-column: 1;
    }

    .video-split:has(> .video__screen) > .video-split__words {
      grid-row: 1;
      grid-column: 2;
    }
  }

  /* Bold: on a phone the film is full width; on a wide band it runs off the
     leading edge and the words keep to the column's far side. */
  /* The band's own tracks, so no column gap: one would shift the content
     track off the column every other band lines up on. */
  :global(.lp[data-lp-style='bold'] .lp-inner) > .video-split {
    grid-column: bleed;
    grid-template-columns: inherit;
    column-gap: 0;
  }

  :global(.lp[data-lp-style='bold']) .video-split > .video-split__words {
    grid-column: content;
  }

  :global(.lp[data-lp-style='bold']) .video-split > .video__screen {
    grid-column: bleed;
  }

  :global(.lp[data-lp-style='bold']) .video-split .video__screen {
    --clip-inset: var(--_edge);
  }

  :global(.lp[data-lp-style='bold']) .video-split .video__caption {
    padding-inline: var(--_edge);
  }

  @container (min-width: 56rem) {
    :global(.lp[data-lp-style='bold']) .video-split:has(> .video__screen):has(> .video-split__words) {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: calc(var(--lp-gap) * 1.25);
      padding-inline-end: var(--_edge);
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video-split__words) > .video__screen {
      grid-column: 1;
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video__screen) > .video-split__words {
      grid-column: 2;
    }

    :global(.lp[data-lp-style='bold']) .video-split:has(> .video-split__words) .video__caption {
      padding-inline-end: 0;
    }
  }
</style>
