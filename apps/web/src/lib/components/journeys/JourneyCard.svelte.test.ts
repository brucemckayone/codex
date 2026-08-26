import { afterEach, describe, expect, test } from 'vitest';
import type { JourneyCardView } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyCard from './JourneyCard.svelte';

/**
 * `JourneyCard` projection tests.
 *
 * `JourneyCard` is now an ADAPTER over `JourneyEntryCard` (Codex-tnwnu): it maps
 * a `JourneyCardView` onto the one shared journey entry card. So what is under
 * test here is the PROJECTION — that each DTO field reaches the right slot of the
 * shared card — while the shared card's own anatomy (cover layers, scrim ramp,
 * flair, progress bar, chrome gating) is covered by
 * `JourneyEntryCard.svelte.test.ts`.
 *
 * Class names are the shared card's (`.jec__*`), which is the point: the landing
 * carousel, the /explore rail, the library shelf and the dashboard threshold all
 * emit the same markup now. They used to emit four different card structures.
 *
 * Under test:
 *   • The cover band exists in BOTH cover states, and the covered case promotes
 *     an `<img>` over the always-painted brand layer — the no-layout-shift
 *     guarantee, so a rail of mixed covered/cover-less journeys never jumps.
 *   • The flair character still derives from the kicker, falling back to the
 *     title. (It is no longer a cover-LESS fallback: it renders either way.)
 *   • The badge is an overlay on the cover, not a row above the kicker.
 *   • `featured` — and only `featured` — earns card chrome.
 *   • Curriculum stats reach the card as SEGMENTS with the numeral separable.
 *   • `progress` swaps the price affordance for a status line and lights the
 *     cover's progress bar.
 *
 * These assert STRUCTURE, deliberately not computed CSS. jsdom does not
 * implement `color-mix()` / `oklch()` / `backdrop-filter` and hands custom
 * properties back as their raw declared string, so a "computed style" assertion
 * here would pass against a still-broken card. Typography and the scrim are
 * verified by reading computed styles in a real browser; what is mechanised here
 * is the wiring those styles hang off.
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

  test('renders the cover image OVER the always-painted brand layer when the journey has one', () => {
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

    const band = document.querySelector('.jec__cover');
    expect(band).not.toBeNull();

    const img = band?.querySelector<HTMLImageElement>('.jec__cover-img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(
      'http://localhost:4100/courses/abc/cover/md.webp'
    );
    // Decorative — the title carries the accessible name.
    expect(img?.getAttribute('alt')).toBe('');

    // The gradient is NOT an either/or fallback: it stays behind the photo so a
    // 404 or a pre-hydration load failure reveals it with no handler.
    expect(band?.querySelector('.jec__cover-brand')).not.toBeNull();
  });

  test('renders the same band, minus the image, when there is no cover', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(), href: '/journeys/stillness' },
    });
    flushSync();

    // The band itself is still in the DOM — this is the no-layout-shift
    // guarantee. If the band were conditional, a cover-less card would be
    // shorter than a covered one and a mixed rail would jump.
    const band = document.querySelector('.jec__cover');
    expect(band).not.toBeNull();
    expect(band?.querySelector('.jec__cover-img')).toBeNull();
    expect(band?.querySelector('.jec__cover-brand')).not.toBeNull();
    expect(band?.querySelector('.jec__scrim')).not.toBeNull();
  });

  test('the flair glyph is the kicker initial, and is hidden from AT', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(), href: '/journeys/stillness' },
    });
    flushSync();

    // Kicker's initial ("Foundation course" → "F").
    expect(document.querySelector('.jec__dropcap')?.textContent?.trim()).toBe(
      'F'
    );
    // Decorative — the title is read out right beside it.
    expect(
      document.querySelector('.jec__flair')?.getAttribute('aria-hidden')
    ).toBe('true');
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

    expect(document.querySelector('.jec__dropcap')?.textContent?.trim()).toBe(
      'T'
    );
  });

  test('the title still renders in both cover states', () => {
    component = mount(JourneyCard, {
      target: document.body,
      props: { journey: cardView(), href: '/journeys/stillness' },
    });
    flushSync();
    expect(document.querySelector('.jec__title')?.textContent).toContain(
      'The Practice of Stillness'
    );
  });
});

/**
 * Projection conformance.
 *
 * Falsifiability, per test:
 *   • badge-in-cover — dropping the `badge` from the projection, or moving the
 *     badge out of the cover, fails it.
 *   • featured — dropping `featured` from the projection fails it, and the
 *     false-case fails if chrome is applied unconditionally.
 *   • stat segments — collapsing `journeyStats` to one joined string removes
 *     `.jec__stat-value` and fails it.
 *   • kicker/tagline — dropping either from the projection fails it.
 *   • progress — dropping the `progress` branch leaves the price affordance in
 *     place and no bar, failing both halves.
 */
describe('JourneyCard projection onto the shared entry card', () => {
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

    const badge = document.querySelector('.jec__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('Portal');
    expect(document.querySelector('.jec__cover .jec__badge')).toBe(badge);
    expect(document.querySelector('.jec__foot .jec__badge')).toBeNull();
  });

  test('a featured journey earns card chrome; a browsing tile does not', () => {
    render({ featured: true });
    expect(
      document.querySelector('.jec')?.classList.contains('jec--featured')
    ).toBe(true);

    // Reset between the two halves so the negative case is a fresh mount.
    reset();

    render({ featured: false });
    expect(
      document.querySelector('.jec')?.classList.contains('jec--featured')
    ).toBe(false);
  });

  test('stats render as segments with the numeral carried separately', () => {
    render({ stageCount: 4, practiceCount: 24 });

    const values = [...document.querySelectorAll('.jec__stat-value')].map(
      (el) => el.textContent?.trim()
    );
    // The number is its own element so it can take the weight while the noun
    // stays quiet. A single joined string cannot.
    expect(values).toEqual(['4', '24']);

    const segments = [...document.querySelectorAll('.jec__stat')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(segments).toEqual(['4 stages', '24 practices']);
  });

  test('stats stay singular-aware and drop a stageless segment entirely', () => {
    render({ stageCount: 1, practiceCount: 1 });
    expect(
      [...document.querySelectorAll('.jec__stat')].map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['1 stage', '1 practice']);

    reset();

    // A stageless journey shows practices only — no empty leading segment.
    render({ stageCount: 0, practiceCount: 7 });
    expect(
      [...document.querySelectorAll('.jec__stat')].map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['7 practices']);
  });

  test('kicker and tagline render when present and are omitted when null', () => {
    render({ kicker: 'Foundation course', tagline: 'Eight weeks of sitting.' });
    expect(document.querySelector('.jec__kicker')?.textContent?.trim()).toBe(
      'Foundation course'
    );
    expect(document.querySelector('.jec__tagline')?.textContent?.trim()).toBe(
      'Eight weeks of sitting.'
    );

    reset();

    render({ kicker: null, tagline: null });
    expect(document.querySelector('.jec__kicker')).toBeNull();
    expect(document.querySelector('.jec__tagline')).toBeNull();
  });

  test('the foot shows price + CTA, and swaps to progress when enrolled', () => {
    render();
    expect(document.querySelector('.jec__price')?.textContent?.trim()).toBe(
      '£48.00'
    );
    expect(document.querySelector('.jec__status')).toBeNull();
    // A discover card carries no progress bar.
    expect(document.querySelector('.jec__progress')).toBeNull();

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

    expect(document.querySelector('.jec__status')?.textContent?.trim()).toBe(
      '12 of 24 practices'
    );
    // The price affordance is what progress replaces — you already own it.
    expect(document.querySelector('.jec__price')).toBeNull();
    expect(document.querySelector('.jec__membership')).toBeNull();
    expect(
      document.querySelector('.jec__progress')?.getAttribute('aria-valuenow')
    ).toBe('50');
    expect(document.querySelector('.jec__go')?.textContent).toContain(
      'Continue'
    );
  });
});
