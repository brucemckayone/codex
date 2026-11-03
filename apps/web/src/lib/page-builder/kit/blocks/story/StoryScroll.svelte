<!--
  @component StoryScroll

  The `scroll` layout. Each moment's words sit beside its own picture — the
  form every visitor gets without JavaScript, under reduced motion and on the
  still canvas. From a container of about 48rem the words take five twelfths
  and the pictures, square, the other seven; every moment's name is drawn at
  the heading's size, so nothing changes size as the moments pass. A phone
  keeps one column, each picture first at 4:5, its names at a title's size.

  Otherwise, from 48rem, a sticky square frame over the pictures' column
  shows the ACTIVE moment's picture (the one crossing the middle of the
  viewport) and crossfades as the moments pass. It is at most 80% of the
  viewport's height and sticks centred in it. The pictures in the moments
  stay where they are, invisible, so nothing moves when the frame takes over
  and a screen reader still meets each picture with its moment; each is as
  wide as the column, so a pictured moment is never shorter than the frame
  and reaches the middle of the screen while its picture shows. A moment
  without a picture keeps the last one showing.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { NOTHING_FOLLOWS } from '../../motion/attributes';
  import { storedFocus } from '../../../page-images';
  import Media from '../../primitives/Media.svelte';
  import type { StoryStep } from './definition';
  import StoryWords from './StoryWords.svelte';

  interface Props {
    steps: readonly StoryStep[];
    images: readonly (string | null)[];
    /** Each picture's stored sizes (`pageImageSrcset`), by step. */
    srcsets?: readonly string[];
    /** How wide this layout draws a picture, for choosing from them. */
    sizes?: string;
    level: 1 | 2 | 3;
  }

  const { steps, images, srcsets = [], sizes, level }: Props = $props();

  let live = $state(false);
  let active = $state(0);
  /** Which picture the frame shows while each moment is active. */
  const shows = $derived.by(() => {
    let last = images.findIndex(Boolean);
    return images.map((image, index) => (image ? (last = index) : last));
  });
  const pictured = $derived(images.some(Boolean));

  /** Follows the moment crossing the middle of the viewport. Motion only. */
  function follow(count: number): Attachment<HTMLElement> {
    return (root) => {
      if (count === 0 || typeof IntersectionObserver === 'undefined') return;
      if (root.closest(NOTHING_FOLLOWS)) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const moments = [...root.querySelectorAll('.story-scroll__step')];
      const observer = new IntersectionObserver(
        (entries) => {
          live = true;
          for (const entry of entries) {
            if (entry.isIntersecting) active = moments.indexOf(entry.target);
          }
        },
        { rootMargin: '-50% 0px -50% 0px' }
      );
      for (const moment of moments) observer.observe(moment);
      return () => observer.disconnect();
    };
  }
</script>

<div class="story-scroll" data-live={live ? '' : undefined} {@attach follow(steps.length)}>
  <ol class="story-scroll__steps">
    {#each steps as step, index (index)}
      <li
        class="story-scroll__step"
        data-pictured={images[index] ? '' : undefined}
        data-active={live && index === active ? '' : undefined}
      >
        <StoryWords {step} {level} />
        {#if images[index]}
          <div class="story-scroll__media">
            <Media
              image={images[index]}
              srcset={srcsets[index]}
              {sizes}
              alt={step.image?.alt ?? ''}
              focus={storedFocus(step.image)}
            />
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if pictured}
    <div class="story-scroll__frame" aria-hidden="true">
      {#each images as image, index (index)}
        {#if image}
          <div class="story-scroll__shot" data-shown={shows[active] === index ? '' : undefined}>
            <Media {image} srcset={srcsets[index]} {sizes} alt="" focus={storedFocus(steps[index]?.image)} />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .story-scroll {
    /* The pictures' seven twelfths of the wide layout, and the frame's side:
       that, but never taller than 80% of the viewport. */
    --_col: calc((var(--lp-column) - var(--lp-gap)) * 7 / 12);
    --_frame: min(var(--_col), 80svh);
    display: grid;
  }

  .story-scroll__steps {
    display: grid;
    gap: var(--space-12);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. The picture leads on a phone. */
  .story-scroll__step {
    --_gap: var(--space-5);
    display: grid;
    gap: var(--_gap);
    margin: 0;
  }

  .story-scroll__media {
    order: -1;
  }

  .story-scroll__media :global(.lp-media) {
    aspect-ratio: 4 / 5;
  }

  .story-scroll__frame {
    display: none;
  }

  /* Wide: the words on one side, their square picture on the other, level
     with it. */
  @container (min-width: 48rem) {
    .story-scroll {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      column-gap: var(--lp-gap);
    }

    .story-scroll__steps,
    .story-scroll__step {
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
    }

    .story-scroll__steps {
      grid-row: 1;
      gap: var(--space-16);
    }

    .story-scroll__step {
      align-items: center;
    }

    /* Its title's room (03 X71): the words' five twelfths of the column, and
       the half of the page's gap that the step's own narrower gap gives back
       (a subgrid's gap stands in for its parents').
       Every moment's name is drawn at the heading's size, weight, leading and
       tracking, through the title's own rule, so it is fitted as every name
       is. The one being read is told by its ink alone, never by its size, so
       nothing reflows as the moments pass. */
    .story-scroll__step > :global(.story-words) {
      --lp-title-column: calc(
        (var(--lp-column) - var(--lp-gap)) * 5 / 12 + (var(--lp-gap) - var(--_gap)) / 2
      );
      --lp-title-lift: 1;
      --lp-weight-title: var(--lp-weight-heading);
      --lp-leading-title: var(--lp-leading-heading);
      --lp-tracking-title: var(--lp-tracking-heading);
      grid-column: 1;
      grid-row: 1;
    }

    .story-scroll__media {
      order: 0;
      grid-column: 2;
      grid-row: 1;
    }

    .story-scroll__media :global(.lp-media) {
      aspect-ratio: 1;
    }
  }

  /* ── the frame (motion only) ───────────────────────────────────────────── */
  @media (prefers-reduced-motion: no-preference) {
    @container (min-width: 48rem) {
      /* Square, and centred in the viewport as it sticks. */
      :global(.lp:not([data-lp-still], [data-lp-motion])) .story-scroll[data-live] .story-scroll__frame {
        position: sticky;
        z-index: 1;
        inset-block-start: max(var(--space-6), calc((100svh - var(--_frame)) / 2));
        display: grid;
        grid-column: 2;
        grid-row: 1;
        align-self: start;
        justify-self: center;
        inline-size: var(--_frame);
        max-inline-size: 100%;
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: var(--lp-radius-media);
      }

      :global(.lp:not([data-lp-still], [data-lp-motion])) .story-scroll[data-live] .story-scroll__media {
        opacity: 0;
      }

      /* The moment being read is in full ink; the rest step back a shade. */
      :global(.lp:not([data-lp-still], [data-lp-motion]))
        .story-scroll[data-live]
        .story-scroll__step:not([data-active])
        :global(.lp-heading) {
        color: var(--lp-ink-soft);
      }

      :global(.lp:not([data-lp-still], [data-lp-motion])) .story-scroll[data-live] :global(.lp-heading) {
        transition: color var(--duration-slow) var(--ease-out);
      }
    }
  }

  .story-scroll__shot {
    grid-area: 1 / 1;
    display: grid;
    opacity: 0;
    transition: opacity var(--duration-slower) var(--ease-out);
  }

  .story-scroll__shot[data-shown] {
    opacity: 1;
  }

  .story-scroll__shot :global(.lp-media) {
    border-radius: 0;
  }
</style>
