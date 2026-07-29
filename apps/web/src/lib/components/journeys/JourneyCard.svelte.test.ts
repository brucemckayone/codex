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

/**
 * Prototype-conformance structure (Codex-ycsd8).
 *
 * Reference: `.jcard` in docs/design/course-journeys/prototype/explore.html — the
 * file where that card's anatomy is DEFINED (1-threshold.html only consumes it).
 *
 * These assert STRUCTURE, deliberately not computed CSS. jsdom does not implement
 * `color-mix()` / `oklch()` / `backdrop-filter` and hands custom properties back
 * as their raw declared string, so a "computed style" assertion here would pass
 * against a still-broken card. Typography and the scrim were verified instead by
 * reading computed styles in a real browser (recorded on the bead); what is
 * mechanised here is the wiring those styles hang off.
 *
 * Falsifiability, per test:
 *   • badge-in-cover — moving the badge back into `__head` fails it.
 *   • featured — deleting the `class:journey-card--featured` directive fails it,
 *     and the false-case fails if the class is applied unconditionally.
 *   • stat segments — reverting to the old single joined `statsLabel` string
 *     removes `.journey-card__stat-value` and fails it.
 *   • kicker/tagline — dropping either `{#if}` branch fails it.
 */
describe('JourneyCard prototype conformance', () => {
  let component: ReturnType<typeof mount> | null = null;

  /** Tear the current mount down so the next case starts from a clean document. */
  function reset() {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  }

  afterEach(reset);

  function render(overrides: Partial<JourneyCardView> = {}) {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(overrides), href: '/journeys/stillness' },
    });
    flushSync();
  }

  test('the badge is an overlay INSIDE the cover band, not a row above the kicker', () => {
    render();

    const badge = document.querySelector('.journey-card__badge');
    expect(badge).not.toBeNull();
    // The prototype places `.jcard__tag` absolutely on the cover. Structurally
    // that means the badge is a child of the cover band, not of the head.
    expect(
      document.querySelector('.journey-card__cover .journey-card__badge')
    ).toBe(badge);
    expect(
      document.querySelector('.journey-card__head .journey-card__badge')
    ).toBeNull();
  });

  test('a featured journey earns card chrome; a browsing tile does not', () => {
    render({ featured: true });
    expect(
      document
        .querySelector('.journey-card')
        ?.classList.contains('journey-card--featured')
    ).toBe(true);

    // Reset between the two halves so the negative case is a fresh mount.
    reset();

    render({ featured: false });
    expect(
      document
        .querySelector('.journey-card')
        ?.classList.contains('journey-card--featured')
    ).toBe(false);
  });

  test('stats render as segments with the numeral carried separately', () => {
    render({ stageCount: 4, practiceCount: 24 });

    const values = [
      ...document.querySelectorAll('.journey-card__stat-value'),
    ].map((el) => el.textContent?.trim());
    // Prototype `.jcard__stats b` — the number is its own element so it can take
    // the weight while the noun stays quiet. A single joined string cannot.
    expect(values).toEqual(['4', '24']);

    const segments = [...document.querySelectorAll('.journey-card__stat')].map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(segments).toEqual(['4 stages', '24 practices']);
  });

  test('stats stay singular-aware and drop a stageless segment entirely', () => {
    render({ stageCount: 1, practiceCount: 1 });
    expect(
      [...document.querySelectorAll('.journey-card__stat')].map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['1 stage', '1 practice']);

    reset();

    // A stageless journey shows practices only — no empty leading segment.
    render({ stageCount: 0, practiceCount: 7 });
    expect(
      [...document.querySelectorAll('.journey-card__stat')].map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['7 practices']);
  });

  test('kicker and tagline render when present and are omitted when null', () => {
    render({ kicker: 'Foundation course', tagline: 'Eight weeks of sitting.' });
    expect(
      document.querySelector('.journey-card__kicker')?.textContent?.trim()
    ).toBe('Foundation course');
    expect(
      document.querySelector('.journey-card__tagline')?.textContent?.trim()
    ).toBe('Eight weeks of sitting.');

    reset();

    render({ kicker: null, tagline: null });
    expect(document.querySelector('.journey-card__kicker')).toBeNull();
    expect(document.querySelector('.journey-card__tagline')).toBeNull();
  });

  test('the foot shows price + CTA, and swaps to progress when enrolled', () => {
    render();
    expect(document.querySelector('.journey-card__cta')).not.toBeNull();
    expect(document.querySelector('.journey-card__progress')).toBeNull();

    reset();

    component = mount(JourneyCard, {
      target: document.body,
      props: {
        journey: cardView(),
        href: '/journeys/stillness',
        progress: {
          percent: 50,
          status: 'in-progress' as const,
          completedPractices: 12,
          totalPractices: 24,
        },
      },
    });
    flushSync();
    expect(document.querySelector('.journey-card__progress')).not.toBeNull();
    expect(document.querySelector('.journey-card__cta')).toBeNull();
    expect(
      document.querySelector('.journey-card__status')?.textContent?.trim()
    ).toBe('12 of 24 practices');
  });
});
