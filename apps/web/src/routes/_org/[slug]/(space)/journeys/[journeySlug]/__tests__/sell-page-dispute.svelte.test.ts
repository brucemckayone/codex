/**
 * The course sales page for a disputed owner (Codex-2hxff.60): the page hands
 * the load's `disputeHold` to the kit, so no Buy or Join is offered and the
 * dispute notice takes their place. Under `?preview` the page renders as a
 * visitor's (as it does for `enrolled`), so the creator sees their buy button.
 *
 * Mounts the real `+page.svelte` with a hero and a pricing section; only
 * `$app/state` is mocked.
 */
import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';
import { COPY } from '$lib/page-builder/kit/model/copy';
import { samplePage } from '$lib/page-builder/kit/model/sample';

const { urlRef } = vi.hoisted(() => ({
  urlRef: { current: null as URL | null },
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return urlRef.current;
    },
  },
}));

import Page from '../+page.svelte';

const URL_ = 'http://of-blood-and-bones.lvh.me:3010/journeys/bone-deep';

const coursePage: JourneyCoursePage = {
  page: {
    id: '00000000-0000-4000-8000-0000000000a0',
    organizationId: '00000000-0000-4000-8000-000000000001',
    publishedAt: '2026-08-01T00:00:00.000Z',
    pageType: 'course',
    slug: 'bone-deep',
    title: 'Bone Deep',
    status: 'published',
    subjectType: 'course',
    subjectId: '00000000-0000-4000-8000-0000000000c0',
    brandOverrides: null,
    sections: [],
  },
  course: {
    id: '00000000-0000-4000-8000-0000000000c0',
    slug: 'bone-deep',
    title: 'Bone Deep',
    kicker: null,
    lede: null,
    status: 'published',
    priceCents: 4900,
    stageCount: 0,
    practiceCount: 0,
  },
  stages: [],
  testimonials: [],
} as unknown as JourneyCoursePage;

const offer = {
  courseId: '00000000-0000-4000-8000-0000000000c0',
  organizationId: '00000000-0000-4000-8000-000000000001',
  paths: ['purchase'],
  purchase: { priceCents: 4900 },
  subscription: null,
  tiers: [],
  entitled: false,
} satisfies CourseOffer;

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function render(
  disputeHold: 'purchase_dispute' | 'subscription_dispute' | null,
  url = URL_
) {
  urlRef.current = new URL(url);
  const props = {
    data: {
      coursePage,
      kitPage: samplePage('bold', ['hero', 'pricing']),
      orgSlug: 'of-blood-and-bones',
      enrolled: false,
      disputeHold,
      offer,
      pageMeta: { description: 'Slow work, close to the bone.' },
      org: { name: 'Of Blood & Bones' },
      draftPreview: false,
      sellPreview: Promise.resolve(null),
    },
  } as unknown as ComponentProps<typeof Page>;
  component = mount(Page, { target: document.body, props });
  flushSync();
}

const checkoutLinks = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) =>
    a.getAttribute('href')?.includes('/checkout')
  );

describe('the sales page and a payment dispute', () => {
  it('offers a visitor the checkout', () => {
    render(null);
    expect(checkoutLinks().length).toBeGreaterThan(0);
    expect(document.querySelector('.lp-notice')).toBeNull();
  });

  it('offers a disputed owner no Buy or Join, only the notice', () => {
    render('subscription_dispute');
    expect(checkoutLinks()).toEqual([]);
    const notice = document.querySelector('.lp-notice');
    expect(notice?.querySelector('.lp-notice__heading')?.textContent).toBe(
      COPY.cta.pausedTitle
    );
    expect(notice?.querySelector('.lp-notice__body')?.textContent).toBe(
      COPY.cta.pausedSubscription
    );
  });

  it('renders a visitor’s page under ?preview, as it does for enrolled', () => {
    render('purchase_dispute', `${URL_}?preview=1`);
    expect(checkoutLinks().length).toBeGreaterThan(0);
    expect(document.querySelector('.lp-notice')).toBeNull();
  });
});
