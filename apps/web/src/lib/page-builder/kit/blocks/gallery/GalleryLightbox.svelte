<!--
  @component GalleryLightbox

  The gallery's pictures one at a time, as large as the screen allows (p3n
  §4). A native modal `<dialog>`: the top layer lifts it out of the section's
  isolation and containment while it stays the section's descendant, so the
  Style's and the scheme's tokens still reach it. It is grounded on the kit's
  media scrim (`data-lp-on-media`, whose ink is measured against it), and the
  page behind it is inert.

  It is mounted only while open (GalleryBlock), so its large pictures are
  fetched only then: each chosen from its srcset at the screen's width, the
  largest file its reference has (`fullPicture`) where a browser cannot
  choose, and fitted whole to the screen with its caption beneath. A large
  file that fails gives way to its tile's, and that failing too, to a line
  that says so. The first file to fail at each stage while it is open is
  logged, by its stage and its size, never by its address.

  The pictures are one row of the browser's own scrolling, snapping one to the
  screen, so a swipe moves between them; the counter and the previous and next
  buttons follow the picture the row settles on. Escape (the dialog's
  `cancel`), the close button and a click on the dark ground round the
  picture close it. ← and → step, heard on the window while it is open, never
  on the dialog itself (s1ebi). The page behind does not scroll: the root
  carries `data-lp-lightbox` from opening until it unmounts. The block returns
  focus to the tile it opened from.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { describeThrown } from '$lib/client-log';
  import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '$lib/components/ui/Icon';
  import { logger } from '$lib/observability';
  import type { PageImageVariant } from '../../../page-images';
  import { holdsStill } from '../../motion/attributes';
  import type { Picture } from './arrange';
  import { GALLERY_COPY } from './copy';

  interface Props {
    pictures: readonly Picture[];
    /** The picture it opens on, from 0. */
    start: number;
    /** Its name for a screen reader: the section heading, when there is one. */
    label: string;
    /** Heard once it has closed, whichever way. */
    onclose: () => void;
  }

  const { pictures, start, label, onclose }: Props = $props();

  /** The root attribute that holds the page still behind it. */
  const LOCK = 'data-lp-lightbox';
  /** What a click may land on without closing: a picture, its words, a control. */
  const HELD =
    '.gallery-lightbox__picture, .gallery-lightbox__lost, .gallery-lightbox__caption, button';
  const STEPS: Partial<Record<string, 1 | -1>> = { ArrowLeft: -1, ArrowRight: 1 };
  /** A slide showing this much of itself is the one the row is on: two never both do. */
  const SETTLED = 0.6;
  /** The sizes a page image's files are named by (`…/lg.webp`). */
  const VARIANTS: readonly PageImageVariant[] = ['sm', 'md', 'lg', 'xl'];

  /** The picture in view, from 0. */
  let at = $state(0);
  let dialog: HTMLDialogElement | undefined;
  let track: HTMLElement | undefined;
  let slides: HTMLElement[] = [];

  const last = $derived(pictures.length - 1);

  /** Puts picture `index` in view: at once, or gliding there from a press. */
  function go(index: number, glide: boolean) {
    at = Math.max(0, Math.min(last, index));
    const slide = slides[at];
    if (!track || !slide) return;
    const still = !glide || holdsStill(track);
    // The track is the slides' offset parent, so a slide's offset is the
    // scroll position that shows it.
    track.scrollTo({ left: slide.offsetLeft, behavior: still ? 'auto' : 'smooth' });
  }

  /** One along. At either end `go` holds it on the picture already shown. */
  function step(by: 1 | -1) {
    go(at + by, true);
  }

  function shut() {
    dialog?.close();
  }

  // Escape: closed here, the same way out as every other.
  function oncancel(event: Event) {
    event.preventDefault();
    shut();
  }

  function onclick(event: MouseEvent) {
    if (event.target instanceof Element && !event.target.closest(HELD)) shut();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const by = STEPS[event.key];
    if (!by) return;
    event.preventDefault();
    step(by);
  }

  /**
   * Opens as it mounts, on its first picture, and holds the page still until
   * it unmounts. The picture the row settles on is the current one, so a
   * swipe moves the counter too.
   *
   * It holds the page only once it is open, and a setup that throws (an
   * `InvalidStateError`, or a later step) lets go and closes. Already modal,
   * it closes itself, so the page behind is no longer inert when its `close`
   * gives the tile focus back; never opened, no `close` would come, so it
   * says it has closed, or the block would think it open and every tile would
   * go dead. GalleryBlock never opens it where there is no `showModal`.
   */
  const modal: Attachment<HTMLDialogElement> = (node) =>
    // What it reads (the picture in view among them) must never re-open it.
    untrack(() => {
      dialog = node;
      track = node.querySelector<HTMLElement>('.gallery-lightbox__track') ?? undefined;
      slides = [...node.querySelectorAll<HTMLElement>('.gallery-lightbox__slide')];
      const root = document.documentElement;
      let settled: IntersectionObserver | undefined;
      const release = () => {
        settled?.disconnect();
        root.removeAttribute(LOCK);
      };
      try {
        node.showModal();
        root.setAttribute(LOCK, '');
        go(start, false);
        node.querySelector<HTMLElement>('.gallery-lightbox__close')?.focus();
        if (track && typeof IntersectionObserver !== 'undefined') {
          settled = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                // A slide at the row's edge intersects at 0, and one gliding
                // away still does: only the one it settles on shows this much.
                if (entry.intersectionRatio < SETTLED) continue;
                const index = slides.findIndex((slide) => slide === entry.target);
                if (index >= 0) at = index;
              }
            },
            { root: track, threshold: SETTLED }
          );
          for (const slide of slides) settled.observe(slide);
        }
      } catch (error) {
        release();
        logger.warn('gallery.lightbox_open_failed', describeThrown(error));
        if (node.open) node.close();
        else onclose();
      }
      return release;
    });

  /**
   * How far each picture has fallen back, by its place: from its large file
   * to its tile's (`picture.url`, which the page already showed), then to a
   * line saying it could not load.
   */
  let fallen = $state<Partial<Record<number, 'tile' | 'none'>>>({});

  /**
   * The file slide `index` shows now: the large one from every size it has,
   * then the tile's alone (a srcset would choose the failed size again).
   * None once both have failed. GalleryBlock opens only a set whose pictures
   * all have a large file.
   */
  function source(picture: Picture, index: number) {
    const fell = fallen[index];
    if (!fell && picture.full) return { url: picture.full.url, srcset: picture.srcset };
    if (fell === 'tile' && picture.url) return { url: picture.url, srcset: undefined };
    return null;
  }

  /** The stages a file has failed at since it opened: heard once a stage an open, not once a file. */
  const reported = new Set<'full' | 'tile'>();

  /**
   * A file of slide `index` failed: the one the browser chose (`currentSrc`,
   * from every size the large file has), named only by its size.
   */
  function fail(picture: Picture, index: number, img: Element) {
    const stage = fallen[index] ? 'tile' : 'full';
    fallen[index] = !fallen[index] && picture.url ? 'tile' : 'none';
    if (reported.has(stage)) return;
    reported.add(stage);
    const file = img instanceof HTMLImageElement ? img.currentSrc || img.src : '';
    const variant = VARIANTS.find((size) => file.endsWith(`/${size}.webp`)) ?? 'unknown';
    logger.warn('gallery.lightbox_image_failed', { stage, variant });
  }
</script>

<svelte:window {onkeydown} />

<!-- Escape and the buttons are its keyboard's ways out; a click on the dark
     ground is the pointer's shortcut to the same. -->
<dialog
  class="gallery-lightbox"
  aria-label={label}
  data-lp-on-media
  {oncancel}
  {onclose}
  {onclick}
  {@attach modal}
>
  <div class="gallery-lightbox__top">
    <p class="gallery-lightbox__count" aria-live="polite">
      {GALLERY_COPY.counter(at + 1, pictures.length)}
    </p>
    <button
      type="button"
      class="gallery-lightbox__button gallery-lightbox__close"
      aria-label={GALLERY_COPY.close}
      onclick={shut}
    >
      <XIcon size="1.25em" />
    </button>
  </div>
  <ul class="gallery-lightbox__track">
    {#each pictures as picture, index (index)}
      {@const file = source(picture, index)}
      <li class="gallery-lightbox__slide">
        <figure class="gallery-lightbox__figure">
          <!-- The tile's file keeps the large one's size: the same frame,
               only softer. -->
          {#if file}
            <img
              class="gallery-lightbox__picture"
              src={file.url}
              srcset={file.srcset || undefined}
              sizes={file.srcset ? '100vw' : undefined}
              alt={picture.alt}
              width={picture.full?.w}
              height={picture.full?.h}
              loading="lazy"
              decoding="async"
              onerror={(event) => fail(picture, index, event.currentTarget)}
            />
          {:else}
            <p class="gallery-lightbox__lost">{GALLERY_COPY.lost}</p>
          {/if}
          {#if picture.caption}
            <figcaption class="gallery-lightbox__caption">{picture.caption}</figcaption>
          {/if}
        </figure>
      </li>
    {/each}
  </ul>
  <div class="gallery-lightbox__bar">
    <button
      type="button"
      class="gallery-lightbox__button"
      aria-label={GALLERY_COPY.previous}
      aria-disabled={at === 0}
      onclick={() => step(-1)}
    >
      <ChevronLeftIcon size="1.25em" />
    </button>
    <button
      type="button"
      class="gallery-lightbox__button"
      aria-label={GALLERY_COPY.next}
      aria-disabled={at === last}
      onclick={() => step(1)}
    >
      <ChevronRightIcon size="1.25em" />
    </button>
  </div>
</dialog>

<style>
  /* The page behind holds still while it is open; the gutter keeps its
     place, so nothing shifts as the scrollbar goes. */
  :global(html[data-lp-lightbox]) {
    overflow: hidden;
    scrollbar-gutter: stable;
  }

  /* The whole screen. Its ground is its own, the scrim (`--lp-bg` on media),
     not the backdrop's: a backdrop does not take the section's tokens in
     every browser. */
  .gallery-lightbox {
    position: fixed;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    max-inline-size: none;
    max-block-size: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    overscroll-behavior: contain;
    background: color-mix(in oklab, var(--lp-bg) 94%, transparent);
    color: var(--lp-ink);
  }

  .gallery-lightbox::backdrop {
    background: transparent;
  }

  .gallery-lightbox[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  /* It fades in as the picture comes forward. Under reduced motion, and on a
     page the motion dial holds still, it simply appears (the kit's gates,
     `motion.test.ts`). */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still']))
      .gallery-lightbox[open] {
      animation: gallery-lightbox-fade var(--duration-normal) var(--ease-out);
    }

    :global(:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still']))
      .gallery-lightbox[open]
      .gallery-lightbox__track {
      animation: gallery-lightbox-zoom var(--duration-slow) var(--ease-smooth);
    }
  }

  @keyframes gallery-lightbox-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes gallery-lightbox-zoom {
    from {
      scale: 0.97;
    }
  }

  .gallery-lightbox__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block: max(var(--space-3), env(safe-area-inset-top)) var(--space-2);
    padding-inline: max(var(--space-4), env(safe-area-inset-left))
      max(var(--space-4), env(safe-area-inset-right));
  }

  /* global.css caps every `p` at 65ch and spaces it. */
  .gallery-lightbox__count {
    margin: 0;
    font-size: var(--lp-size-small);
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-body);
  }

  /* The track is the slides' offset parent (`go`). */
  .gallery-lightbox__track {
    position: relative;
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto hidden;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .gallery-lightbox__track::-webkit-scrollbar {
    display: none;
  }

  /* The focus ring sits inside the scroller, which clips anything outside it. */
  .gallery-lightbox__track:focus-visible {
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  /* base.css spaces every `li` but the last. */
  .gallery-lightbox__slide {
    flex: 0 0 100%;
    display: grid;
    min-inline-size: 0;
    margin: 0;
    padding-inline: var(--space-4);
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }

  @media (min-width: 48rem) {
    .gallery-lightbox__slide {
      padding-inline: var(--space-16);
    }
  }

  /* The picture and its caption sit together in the middle of the screen. */
  .gallery-lightbox__figure {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-block-size: 0;
    min-inline-size: 0;
    margin: 0;
  }

  /* Its whole self, never cropped: it gives up height to the caption, and
     its width follows its shape. A grid row sized to the picture let the
     caption overlap it in WebKit. */
  .gallery-lightbox__picture {
    flex: 0 1 auto;
    min-block-size: 0;
    min-inline-size: 0;
    inline-size: auto;
    block-size: auto;
    max-inline-size: 100%;
    max-block-size: 100%;
    border-radius: var(--lp-radius-media);
  }

  /* In the picture's place, over its caption, when neither file loads.
     global.css caps every `p` at 65ch and spaces it. */
  .gallery-lightbox__lost {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    text-align: center;
  }

  /* global.css sets every figcaption small and muted; this one is read. */
  .gallery-lightbox__caption {
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
    margin: 0;
    color: var(--lp-ink);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-align: center;
    text-wrap: pretty;
  }

  .gallery-lightbox__bar {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    padding-block: var(--space-2) max(var(--space-4), env(safe-area-inset-bottom));
    padding-inline: var(--space-4);
  }

  .gallery-lightbox__button {
    display: grid;
    place-items: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-button-line);
    color: var(--lp-ink);
    font: inherit;
    cursor: pointer;
  }

  /* At either end the button rests but keeps its focus. */
  .gallery-lightbox__button[aria-disabled='true'] {
    cursor: default;
    opacity: var(--opacity-40);
  }

  @media (hover: hover) {
    .gallery-lightbox__button:not([aria-disabled='true']):hover {
      background: var(--lp-button-bg);
      box-shadow: none;
      color: var(--lp-button-ink);
    }
  }
</style>
