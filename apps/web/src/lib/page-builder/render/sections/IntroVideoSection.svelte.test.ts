/**
 * IntroVideoSection streamed sell-preview (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the shell+stream behaviour at the section level:
 *   - the heading renders IMMEDIATELY (SEO-critical, never gated on the stream);
 *   - while the sell-preview promise is pending, a poster SKELETON shows;
 *   - once it resolves with a preview, the play affordance replaces the skeleton;
 *   - a null resolution (the `.catch()` degrade) shows neither skeleton nor play,
 *     and the heading still stands.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import IntroVideoSection from './IntroVideoSection.svelte';

function baseContext(
  sellPreview: Promise<SellPreview | null>
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'demo',
      title: 'Demo',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: null,
      stageCount: 1,
      practiceCount: 1,
    },
    stages: [],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
    sellPreview,
  };
}

const HEADING = 'Ninety seconds inside the work.';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('IntroVideoSection — streamed preview', () => {
  it('shows the heading immediately and a skeleton while the preview is pending', () => {
    let resolve!: (value: SellPreview | null) => void;
    const pending = new Promise<SellPreview | null>((r) => {
      resolve = r;
    });

    const component = mount(IntroVideoSection, {
      target: document.body,
      props: { config: { heading: HEADING }, context: baseContext(pending) },
    });
    flushSync();

    // Heading is on the critical path — present before the stream resolves.
    expect(document.body.querySelector('.intro__heading')?.textContent).toBe(
      HEADING
    );
    // Pending branch → skeleton.
    expect(document.body.querySelector('.section-skeleton')).not.toBeNull();
    expect(document.body.querySelector('.intro__play')).toBeNull();

    resolve(null); // avoid a dangling unhandled promise
    unmount(component);
  });

  it('replaces the skeleton with the play affordance once the preview resolves', async () => {
    const preview: SellPreview = {
      intro: {
        playlistUrl: '/cdn/x/preview.m3u8',
        posterUrl: null,
        durationSeconds: 90,
      },
      reel: null,
    };
    const component = mount(IntroVideoSection, {
      target: document.body,
      props: {
        config: { heading: HEADING },
        context: baseContext(Promise.resolve(preview)),
      },
    });
    flushSync();
    await tick();
    flushSync();

    expect(document.body.querySelector('.section-skeleton')).toBeNull();
    const play = document.body.querySelector('.intro__play');
    expect(play).not.toBeNull();
    expect(play?.getAttribute('aria-label')).toContain('intro film');

    unmount(component);
  });

  it('degrades to no skeleton and no play when the preview resolves null', async () => {
    const component = mount(IntroVideoSection, {
      target: document.body,
      props: {
        config: { heading: HEADING },
        context: baseContext(Promise.resolve(null)),
      },
    });
    flushSync();
    await tick();
    flushSync();

    expect(document.body.querySelector('.intro__heading')?.textContent).toBe(
      HEADING
    );
    expect(document.body.querySelector('.section-skeleton')).toBeNull();
    expect(document.body.querySelector('.intro__play')).toBeNull();
    expect(document.body.querySelector('.intro__empty')).not.toBeNull();

    unmount(component);
  });
});
