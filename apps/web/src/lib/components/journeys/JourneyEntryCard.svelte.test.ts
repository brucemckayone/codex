import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyEntryCard from './JourneyEntryCard.svelte';
import type { JourneyEntryCardProps } from './journey-entry-card';

/**
 * `JourneyEntryCard` structural tests (Codex-tnwnu).
 *
 * Five surfaces used to render a journey five different ways. They now all go
 * through this component, so the properties worth mechanising are the ones that
 * make the treatments IDENTICAL — and the ones that were silently different
 * before:
 *
 *   • The brand cover layer is painted in BOTH cover states. A cover-less card
 *     used to fall back to a flat surface tint (or, on the explore rail, to a
 *     gradient with no scrim over it), which is a second treatment inside one
 *     card. Photo-or-not, the layer stack is the same.
 *   • The scrim ramp is unconditional for the same reason — `JourneyRailCard`
 *     gated it behind an `--imaged` class.
 *   • The flair dropcap renders on EVERY card, not just cover-less ones. Its
 *     character derivation (kicker initial → title initial) is unchanged from
 *     the card this replaces, which is what keeps the two inherited cases below
 *     meaningful.
 *   • Chrome is `featured`-gated. Cards are transparent until hover; three of
 *     the five treatments were always-filled, which is much of what made them
 *     look unrelated.
 *   • Progress is determinate, always visible (never hover-gated), correctly
 *     announced, and ABSENT on a discover card.
 *
 * These assert STRUCTURE, deliberately not computed CSS. jsdom implements
 * neither `oklch()` nor `color-mix()` and hands custom properties back as their
 * raw declared string, so a "computed style" colour assertion would just echo
 * the string it was given and pass against a still-broken card. Colour and
 * contrast are verified in a real browser.
 */

function props(
  overrides: Partial<JourneyEntryCardProps> = {}
): JourneyEntryCardProps {
  return {
    href: '/journeys/stillness',
    title: 'The Practice of Stillness',
    kicker: 'Foundation course',
    tagline: 'Eight weeks of sitting, slowly.',
    priceCents: 4800,
    ...overrides,
  };
}

describe('JourneyEntryCard', () => {
  let component: ReturnType<typeof mount> | null = null;

  /** Tear the current mount down so the next case starts from a clean document. */
  function reset() {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  }

  afterEach(reset);

  function render(overrides: Partial<JourneyEntryCardProps> = {}) {
    component = mount(JourneyEntryCard, {
      target: document.body,
      props: props(overrides),
    });
    flushSync();
  }

  const cover = () => document.querySelector('.jec__cover');

  // ── Cover anatomy ─────────────────────────────────────────────────────────

  test('the brand cover layer AND the scrim ramp are painted whether or not there is a photo', () => {
    // With a photo: the gradient still paints BEHIND it, so a 404 or a
    // pre-hydration failure degrades to the gradient with no handler and no
    // layout shift.
    render({
      coverImageUrl: 'http://localhost:4100/courses/abc/cover/md.webp',
    });
    expect(cover()?.querySelector('.jec__cover-brand')).not.toBeNull();
    expect(cover()?.querySelector('.jec__scrim')).not.toBeNull();

    const img = cover()?.querySelector<HTMLImageElement>('.jec__cover-img');
    expect(img?.getAttribute('src')).toBe(
      'http://localhost:4100/courses/abc/cover/md.webp'
    );
    // Decorative — the title carries the accessible name.
    expect(img?.getAttribute('alt')).toBe('');

    reset();

    // Without one: identical layers, minus the <img>.
    render({ coverImageUrl: null });
    expect(cover()?.querySelector('.jec__cover-brand')).not.toBeNull();
    expect(cover()?.querySelector('.jec__scrim')).not.toBeNull();
    expect(cover()?.querySelector('.jec__cover-img')).toBeNull();
  });

  test('the flair dropcap renders in both cover states, not only as a fallback', () => {
    render({ coverImageUrl: 'http://localhost:4100/c/cover/md.webp' });
    expect(document.querySelector('.jec__dropcap')).not.toBeNull();

    reset();

    render({ coverImageUrl: null });
    expect(document.querySelector('.jec__dropcap')).not.toBeNull();
  });

  test('the flair character is the KICKER initial, falling back to the title initial', () => {
    render({ kicker: 'Foundation course' });
    expect(document.querySelector('.jec__dropcap')?.textContent?.trim()).toBe(
      'F'
    );

    reset();

    render({ kicker: null });
    expect(document.querySelector('.jec__dropcap')?.textContent?.trim()).toBe(
      'T'
    );
  });

  test('the flair layer is decorative — hidden from assistive tech', () => {
    render();
    expect(
      document.querySelector('.jec__flair')?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  // ── Title in cover ────────────────────────────────────────────────────────

  test('a tile carries kicker, title and tagline INSIDE the cover element', () => {
    render({ layout: 'tile' });

    // DOM containment, not visual position — jsdom has no layout. Containment
    // is what the scrim ramp's legibility contract depends on: the text must be
    // a child of the scrimmed cover, not a sibling below it.
    expect(cover()?.querySelector('.jec__title')?.textContent).toContain(
      'The Practice of Stillness'
    );
    expect(cover()?.querySelector('.jec__kicker')?.textContent?.trim()).toBe(
      'Foundation course'
    );
    expect(cover()?.querySelector('.jec__tagline')?.textContent?.trim()).toBe(
      'Eight weeks of sitting, slowly.'
    );
  });

  test('a row moves the text BESIDE the cover — a 4:3 thumbnail cannot hold a title', () => {
    render({ layout: 'row', meta: 'Next · Sitting with the breath' });

    // Still one card, one cover treatment; only the text placement differs.
    expect(cover()?.querySelector('.jec__title')).toBeNull();
    expect(
      document.querySelector('.jec__body .jec__title')?.textContent
    ).toContain('The Practice of Stillness');
    expect(document.querySelector('.jec__meta')?.textContent?.trim()).toBe(
      'Next · Sitting with the breath'
    );
    expect(document.querySelector('.jec')?.getAttribute('data-layout')).toBe(
      'row'
    );
  });

  test('kicker, tagline and meta are omitted when null', () => {
    render({ kicker: null, tagline: null, meta: null });
    expect(document.querySelector('.jec__kicker')).toBeNull();
    expect(document.querySelector('.jec__tagline')).toBeNull();
    expect(document.querySelector('.jec__meta')).toBeNull();
  });

  // ── Chrome ────────────────────────────────────────────────────────────────

  test('a featured entry earns card chrome; a browsing tile does not', () => {
    render({ featured: true });
    expect(
      document.querySelector('.jec')?.classList.contains('jec--featured')
    ).toBe(true);

    reset();

    render({ featured: false });
    expect(
      document.querySelector('.jec')?.classList.contains('jec--featured')
    ).toBe(false);
  });

  // ── Progress ──────────────────────────────────────────────────────────────

  test('an enrolled entry gets a determinate progress bar on the cover, correctly announced', () => {
    render({ progress: { percent: 62, label: '15 of 24 practices' } });

    const bar = cover()?.querySelector('.jec__progress');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('62');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
    // The label names the journey — several bars can share a rail.
    expect(bar?.getAttribute('aria-label')).toBe(
      'The Practice of Stillness progress'
    );
    // Determinate: the fill is set from the value, not left to CSS.
    expect(
      bar?.querySelector<HTMLElement>('.jec__progress-fill')?.style.width
    ).toBe('62%');

    expect(document.querySelector('.jec__status')?.textContent?.trim()).toBe(
      '15 of 24 practices'
    );
  });

  test('a DISCOVER entry has no progress bar at all', () => {
    render({ progress: null });
    expect(document.querySelector('.jec__progress')).toBeNull();
    expect(document.querySelector('.jec__status')).toBeNull();
  });

  test('an out-of-range rollup is clamped rather than painting past the track', () => {
    render({ progress: { percent: 140, label: null } });
    expect(
      document.querySelector('.jec__progress')?.getAttribute('aria-valuenow')
    ).toBe('100');

    reset();

    render({ progress: { percent: -8, label: null } });
    expect(
      document.querySelector('.jec__progress')?.getAttribute('aria-valuenow')
    ).toBe('0');
  });

  // Tuples typed explicitly: a bare array of mixed literals widens to a union
  // including `string`, which `progress.percent` rejects.
  const nonFinitePercents: [string, number][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  test.each(
    nonFinitePercents
  )('a %s percent floors to 0 rather than reaching the DOM as a non-number', (_label, percent) => {
    // Range clamping alone is NOT enough: both `Math.min` and `Math.max`
    // PROPAGATE NaN rather than clamping it. Unguarded, this renders
    // `aria-valuenow="NaN"` (invalid ARIA) and `width: NaN%`, which browsers
    // drop — a zero-width fill that still announces as a determinate bar.
    render({ progress: { percent, label: null } });

    const bar = document.querySelector('.jec__progress');
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
    expect(
      bar?.querySelector<HTMLElement>('.jec__progress-fill')?.style.width
    ).toBe('0%');
  });

  // ── Foot ──────────────────────────────────────────────────────────────────

  test('the price renders in GBP, and falls back to the membership label when unpriced', () => {
    render({ priceCents: 4800 });
    expect(document.querySelector('.jec__price')?.textContent?.trim()).toBe(
      '£48.00'
    );
    expect(document.querySelector('.jec__membership')).toBeNull();

    reset();

    render({ priceCents: null, membershipLabel: 'Membership' });
    expect(document.querySelector('.jec__price')).toBeNull();
    expect(
      document.querySelector('.jec__membership')?.textContent?.trim()
    ).toBe('Membership');
  });

  test('stats render as segments with the numeral carried in its own element', () => {
    render({
      stats: [
        { value: 4, label: 'stages' },
        { value: 24, label: 'practices' },
      ],
    });

    // A single joined string cannot give the numeral its own weight.
    expect(
      [...document.querySelectorAll('.jec__stat-value')].map((el) =>
        el.textContent?.trim()
      )
    ).toEqual(['4', '24']);
    expect(
      [...document.querySelectorAll('.jec__stat')].map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['4 stages', '24 practices']);
  });

  test('the badge is an overlay INSIDE the cover, and the access chip is in the foot', () => {
    render({ badge: 'Portal', accessLabel: 'purchased' });

    const badge = document.querySelector('.jec__badge');
    expect(cover()?.querySelector('.jec__badge')).toBe(badge);
    expect(badge?.textContent?.trim()).toBe('Portal');

    expect(
      document.querySelector('.jec__foot .jec__access')?.textContent?.trim()
    ).toBe('purchased');
  });

  test('the CTA verb and the href come from the caller', () => {
    render({ cta: 'Resume', href: '/journeys/stillness/practice/breath' });
    expect(document.querySelector('.jec__go')?.textContent).toContain('Resume');
    expect(document.querySelector('.jec')?.getAttribute('href')).toBe(
      '/journeys/stillness/practice/breath'
    );
  });
});
