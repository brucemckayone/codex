/**
 * Org landing, "Jump back in" rail: a purchase paused by a payment dispute
 * (Codex-2hxff.60).
 *
 * The rail is fed by `getContinueWatching`, which reads the same library
 * response as the platform library. Its card must say what the platform
 * library's does: dimmed, labelled "Paused: payment dispute", the label
 * linking to the item's own page. Before this, the card carried no access
 * state at all and read as a normal resume card for an item the stream
 * refuses.
 *
 * Mounts the real `+page.svelte` with an otherwise empty org; `$app/*`, the
 * remote module and the collections barrel are mocked.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ContinueWatchingItem } from '$lib/utils/continue-watching';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('http://studio-alpha.lvh.me:3000/');
    },
    state: {},
  },
}));
vi.mock('$lib/remote/org.remote', () => ({
  followOrganization: vi.fn(),
  getMyMembership: vi.fn(async () => null),
  requestOrgFilm: vi.fn(),
  unfollowOrganization: vi.fn(),
}));
vi.mock('$lib/collections', () => ({
  eq: vi.fn(),
  hydrateIfNeeded: vi.fn(),
  loadSubscriptionFromServer: vi.fn(async () => {}),
  subscriptionCollection: {},
  useLiveQuery: () => ({ data: [] }),
}));

import OrgLandingPage from '../+page.svelte';

const ORG = {
  id: 'org-1',
  slug: 'studio-alpha',
  name: 'Studio Alpha',
  description: null,
  logoUrl: null,
};

function resumeItem(
  id: string,
  title: string,
  purchaseDisputedAt: string | null
): ContinueWatchingItem {
  return {
    id,
    title,
    slug: id,
    organizationSlug: ORG.slug,
    thumbnail: null,
    contentType: 'video',
    duration: 600,
    progress: {
      positionSeconds: 120,
      durationSeconds: 600,
      completed: false,
      percentComplete: 20,
      updatedAt: '2026-10-21T10:00:00.000Z',
    },
    accessType: 'purchased',
    purchaseDisputedAt,
  };
}

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

async function mountLanding(resume: ContinueWatchingItem[]) {
  component = mount(OrgLandingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        user: { id: 'user-1', name: 'Ellie Smith' },
        allContent: [],
        featuredJourneys: [],
        journeys: [],
        stats: null,
        feedCategories: [],
        categories: Promise.resolve([]),
        creators: Promise.resolve({ items: [], total: 0 }),
        continueWatching: Promise.resolve(resume),
        subscriptionContext: Promise.resolve(null),
        enableSubscriptions: false,
        subscriptionPricing: null,
      },
    } as never,
  });
  // The rail is streamed: let its promise settle, then render.
  await tick();
  await Promise.resolve();
  flushSync();
}

function railCard(title: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('article.cc')].find(
    (card) => card.textContent?.includes(title)
  );
}

describe('org landing: the resume rail and a payment dispute', () => {
  test('a disputed purchase is dimmed and labelled; another is unchanged', async () => {
    await mountLanding([
      resumeItem(
        'breathwork',
        'Breathwork for Deep Sleep',
        '2026-10-20T09:00:00.000Z'
      ),
      resumeItem('kettlebell', 'Kettlebell Foundations', null),
    ]);

    const paused = railCard('Breathwork for Deep Sleep');
    expect(paused?.dataset.accessState).toBe('disputed');
    const label = paused?.querySelector('.cc__access-cta');
    expect(label?.textContent?.trim()).toBe(m.access_paused_dispute_label());
    expect(label?.getAttribute('href')).toBe('/content/breathwork');

    const plain = railCard('Kettlebell Foundations');
    expect(plain).toBeDefined();
    expect(plain?.dataset.accessState).toBeUndefined();
    expect(plain?.querySelector('.cc__access-cta')).toBeNull();
  });
});
