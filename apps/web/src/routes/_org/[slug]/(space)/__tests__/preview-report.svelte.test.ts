/**
 * The org landing's report to the brand studio (Codex-1yd58 WP-9): in the
 * studio's live preview it tells the editor what its hero resolved to, and
 * from which choices; and when the preview leaves the landing (a link
 * followed inside it) it withdraws that report, so the editor keeps no hint
 * about a hero no longer drawn (review r1 L3).
 *
 * Mounts the real `+page.svelte` as `resume-rail-dispute.svelte.test.ts`
 * does; the report itself is spied (its post is proven in the bridge's own
 * tests, where a framed window can be faked).
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true }));
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
const reported = vi.hoisted(() => vi.fn());
vi.mock('$lib/brand-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/brand-editor')>()),
  reportPreviewResolved: reported,
}));

import OrgLandingPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  reported.mockReset();
  document.body.innerHTML = '';
});

async function mountLanding(tokenOverrides: Record<string, string>) {
  component = mount(OrgLandingPage, {
    target: document.body,
    props: {
      data: {
        org: {
          id: 'org-1',
          slug: 'studio-alpha',
          name: 'Studio Alpha',
          description: null,
          logoUrl: null,
          brandFineTune: { tokenOverrides: JSON.stringify(tokenOverrides) },
        },
        user: null,
        allContent: [],
        featuredJourneys: [],
        journeys: [],
        stats: null,
        feedCategories: [],
        categories: Promise.resolve([]),
        creators: Promise.resolve({ items: [], total: 0 }),
        continueWatching: Promise.resolve([]),
        subscriptionContext: Promise.resolve(null),
        enableSubscriptions: false,
        subscriptionPricing: null,
      },
    } as never,
  });
  await tick();
  flushSync();
}

describe('the landing’s report to the brand studio', () => {
  test('reports its hero with the choices it resolved from', async () => {
    await mountLanding({
      'hero-opt-purpose': 'spotlight',
      'hero-opt-lead': 'name',
    });
    expect(reported).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chosen: { purpose: 'spotlight', options: { lead: 'name' } },
        options: expect.objectContaining({ lead: 'name' }),
      })
    );
  });

  test('reports null for the classic hero, which the editor does not hint on', async () => {
    await mountLanding({});
    expect(reported).toHaveBeenLastCalledWith(null);
  });

  test('withdraws its report as the preview leaves the landing', async () => {
    await mountLanding({ 'hero-opt-purpose': 'spotlight' });
    expect(reported).toHaveBeenLastCalledWith(
      expect.objectContaining({ chosen: expect.anything() })
    );
    if (component) unmount(component);
    component = null;
    expect(reported).toHaveBeenLastCalledWith(null);
  });
});
