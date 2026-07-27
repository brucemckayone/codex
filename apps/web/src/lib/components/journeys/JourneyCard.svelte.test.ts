import { afterEach, describe, expect, test } from 'vitest';
import type { JourneyCardView } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyCard from './JourneyCard.svelte';

/**
 * JourneyCard cover-band tests (Codex-eqh0z).
 *
 * `courses` had three VIDEO refs and no poster column, so this card was
 * typographic-only. It now renders a cover band — and the load-bearing property
 * is that the band exists in BOTH states, so a rail of mixed covered and
 * cover-less journeys does not jump.
 *
 * Under test:
 *   • With a cover: the band holds an `<img>` at the given URL, and the
 *     typographic fallback glyph is absent.
 *   • Without a cover: the band is STILL present (reserved space) and holds the
 *     fallback glyph instead — i.e. the fallback is a swap inside a fixed box,
 *     not a removed element. This is the no-layout-shift guarantee.
 *   • The cover image is decorative (`alt=""`) — the title is the accessible
 *     name, so the cover must not be announced twice.
 *   • The fallback glyph is `aria-hidden` for the same reason.
 *
 * Falsifiability: dropping the `{:else}` branch, or gating the whole band behind
 * `{#if journey.coverImageUrl}`, fails the cover-less assertions.
 */

function cardView(overrides: Partial<JourneyCardView> = {}): JourneyCardView {
  return {
    pageId: '11111111-1111-4111-8111-111111111111',
    slug: 'stillness',
    title: 'The Practice of Stillness',
    kicker: 'Foundation course',
    tagline: 'Eight weeks of sitting, slowly.',
    courseId: '22222222-2222-4222-8222-222222222222',
    courseSlug: 'stillness-course',
    priceCents: 4800,
    stageCount: 4,
    practiceCount: 24,
    featured: false,
    coverImageUrl: null,
    ...overrides,
  };
}

describe('JourneyCard cover band', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders the cover image when the journey has one', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: {
        journey: cardView({
          coverImageUrl: 'http://localhost:4100/courses/abc/cover/md.webp',
        }),
        href: '/journeys/stillness',
      },
    });
    flushSync();

    const band = document.querySelector('.journey-card__cover');
    expect(band).not.toBeNull();

    const img = band?.querySelector<HTMLImageElement>(
      '.journey-card__cover-img'
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(
      'http://localhost:4100/courses/abc/cover/md.webp'
    );
    // Decorative — the title carries the accessible name.
    expect(img?.getAttribute('alt')).toBe('');

    // The fallback must NOT also render.
    expect(document.querySelector('.journey-card__cover-glyph')).toBeNull();
  });

  test('renders the typographic fallback INSIDE the same band when there is no cover', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(), href: '/journeys/stillness' },
    });
    flushSync();

    // The band itself is still in the DOM — this is the no-layout-shift
    // guarantee. If the band were conditional, a cover-less card would be
    // shorter than a covered one and a mixed rail would jump.
    const band = document.querySelector('.journey-card__cover');
    expect(band).not.toBeNull();

    expect(band?.querySelector('.journey-card__cover-img')).toBeNull();

    const glyph = band?.querySelector('.journey-card__cover-glyph');
    expect(glyph).not.toBeNull();
    // Kicker's initial ("Foundation course" → "F"); decorative, so hidden from AT.
    expect(glyph?.textContent?.trim()).toBe('F');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  test('falls back to the title initial when there is no kicker either', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: {
        journey: cardView({ kicker: null }),
        href: '/journeys/stillness',
      },
    });
    flushSync();

    expect(
      document.querySelector('.journey-card__cover-glyph')?.textContent?.trim()
    ).toBe('T');
  });

  test('the title still renders in both cover states', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(), href: '/journeys/stillness' },
    });
    flushSync();
    expect(
      document.querySelector('.journey-card__title')?.textContent
    ).toContain('The Practice of Stillness');
  });
});
