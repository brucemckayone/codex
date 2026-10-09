<!--
  @component StoryScroll

  The `scroll` layout. Each moment's words sit beside its own picture — the
  form every visitor gets without JavaScript, on a narrow screen, under
  reduced motion and on the still canvas.

  Otherwise, from a container of about 48rem, a sticky frame over the
  pictures' column shows the ACTIVE moment's picture (the one crossing the
  middle of the viewport) and crossfades as the moments pass. The pictures in
  the moments stay where they are, invisible, so nothing moves when the frame
  takes over and a screen reader still meets each picture with its moment.
  A moment without a picture keeps the last one showing.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import Media from '../../primitives/Media.svelte';
  import type { StoryStep } from './definition';
  import StoryWords from './StoryWords.svelte';

  interface Props {
    steps: readonly StoryStep[];
    images: readonly (string | null)[];
    level: 1 | 2 | 3;
  }

  const { steps, images, level }: Props = $props();

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
      if (root.closest('[data-lp-still]')) return;
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
            <Media image={images[index]} alt={step.image?.alt ?? ''} ratio="4 / 3" />
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
            <Media {image} alt="" />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .story-scroll {
    /* One column of the wide layout, and the frame's height at 4:3. */
    --_col: calc(
      (min(100cqi - 2 * var(--lp-gutter), var(--lp-container)) - var(--lp-gap)) / 2
    );
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
    display: grid;
    gap: var(--space-5);
    margin: 0;
  }

  .story-scroll__media {
    order: -1;
  }

  .story-scroll__frame {
    display: none;
  }

  /* Wide: the words on one side, their picture on the other, level with it. */
  @container (min-width: 48rem) {
    .story-scroll {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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

    .story-scroll__step > :global(.story-words) {
      grid-column: 1;
      grid-row: 1;
    }

    .story-scroll__media {
      order: 0;
      grid-column: 2;
      grid-row: 1;
    }
  }

  /* ── the frame (motion only) ───────────────────────────────────────────── */
  @media (prefers-reduced-motion: no-preference) {
    @container (min-width: 48rem) {
      :global(.lp:not([data-lp-still])) .story-scroll[data-live] .story-scroll__frame {
        position: sticky;
        z-index: 1;
        inset-block-start: max(var(--space-6), calc(50svh - var(--_col) * 3 / 8));
        display: grid;
        grid-column: 2;
        grid-row: 1;
        align-self: start;
        aspect-ratio: 4 / 3;
        max-block-size: calc(100svh - 2 * var(--space-6));
        overflow: hidden;
        border-radius: var(--lp-radius-media);
      }

      :global(.lp:not([data-lp-still])) .story-scroll[data-live] .story-scroll__media {
        opacity: 0;
      }

      /* The moment being read is in full ink; the rest step back a shade. */
      :global(.lp:not([data-lp-still]))
        .story-scroll[data-live]
        .story-scroll__step:not([data-active])
        :global(.lp-heading) {
        color: var(--lp-ink-soft);
      }

      :global(.lp:not([data-lp-still])) .story-scroll[data-live] :global(.lp-heading) {
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
