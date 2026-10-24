/**
 * Org library: a purchase paused by a payment dispute (Codex-2hxff.60).
 *
 * The platform library dims such a card and labels it "Paused: payment
 * dispute". This page draws its own rows and its own "Jump back in" rail from
 * the same library collection, so it must say the same through the same rule
 * (`getLibraryDisputeState`), or its rows read "purchased" and its resume
 * card reads "Resume" for an item the stream refuses.
 *
 * Its course shelf does the same for a course whose purchase or subscription
 * is disputed: the worker's `disputeHold`, through
 * `getEnrolledCourseAccessState`.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the collections barrel are
 * mocked, and the live query hands the page its rows directly.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { LibraryItem } from '$lib/collections';
import type { EnrolledCourseSummary } from '$lib/journeys/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { liveRows } = vi.hoisted(() => ({
  liveRows: { current: [] as unknown[] },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('http://studio-alpha.lvh.me:3000/library');
    },
  },
}));
vi.mock('$lib/collections', () => ({
  libraryCollection: {},
  loadLibraryFromServer: vi.fn(async () => {}),
  useLiveQuery: () => ({
    get data() {
      return liveRows.current;
    },
  }),
}));

import LibraryPage from '../+page.svelte';

const ORG = { id: 'org-1', name: 'Studio Alpha', slug: 'studio-alpha' };
const DISPUTED_AT = '2026-10-20T09:00:00.000Z';

function makeItem(
  id: string,
  title: string,
  overrides: Partial<LibraryItem> = {}
): LibraryItem {
  return {
    content: {
      id,
      slug: id,
      title,
      description: '',
      thumbnailUrl: null,
      contentType: 'video',
      durationSeconds: 600,
      organizationId: ORG.id,
      organizationSlug: ORG.slug,
    },
    accessType: 'purchased',
    purchase: {
      purchasedAt: '2026-10-02T10:00:00.000Z',
      priceCents: 1200,
      disputedAt: null,
    },
    progress: null,
    journeys: [],
    ...overrides,
  } as LibraryItem;
}

const inProgress = {
  positionSeconds: 120,
  durationSeconds: 600,
  completed: false,
  percentComplete: 20,
  updatedAt: '2026-10-21T10:00:00.000Z',
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(
  items: LibraryItem[],
  enrolledCourses: EnrolledCourseSummary[] = []
) {
  liveRows.current = items;
  component = mount(LibraryPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        user: { id: 'user-1', name: 'Ellie Smith' },
        enrolledCourses,
      },
    } as never,
  });
  flushSync();
}

function makeCourse(
  slug: string,
  title: string,
  disputeHold: EnrolledCourseSummary['disputeHold']
): EnrolledCourseSummary {
  return {
    course: {
      id: `course-${slug}`,
      slug,
      title,
      organizationSlug: ORG.slug,
      kicker: null,
      lede: null,
      guideName: null,
      coverImageUrl: null,
    },
    enrollment: {
      courseId: `course-${slug}`,
      enrolledAt: '2026-09-01T09:00:00.000Z',
      lastActivityAt: null,
      completedAt: null,
    },
    enrollmentSource: 'course_purchase',
    progress: {
      done: 2,
      total: 8,
      percent: 25,
      status: 'in-progress',
      lastCompletedAt: null,
      nextPracticeSlug: 'grounding',
      nextPracticeTitle: 'Grounding Practice',
    },
    disputeHold,
  };
}

/** A course's card in one section, found by the section's heading. */
function courseCard(
  section: 'Your portals' | 'Jump back in',
  title: string
): HTMLAnchorElement | undefined {
  const sec = [...document.querySelectorAll('section.sec')].find(
    (s) => s.querySelector('h2')?.textContent === section
  );
  return [...(sec?.querySelectorAll<HTMLAnchorElement>('a.jec') ?? [])].find(
    (card) => card.querySelector('.jec__title')?.textContent === title
  );
}

function ownedRow(title: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>('a.row')].find(
    (row) => row.querySelector('.row__title')?.textContent === title
  );
}

function resumeCard(title: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>('a.jec')].find(
    (card) => card.querySelector('.jec__title')?.textContent === title
  );
}

describe('org library: a purchase paused by a payment dispute', () => {
  test('its owned row is dimmed and its badge says it is paused', () => {
    mountPage([
      makeItem('breathwork', 'Breathwork for Deep Sleep', {
        purchase: {
          purchasedAt: '2026-10-02T10:00:00.000Z',
          priceCents: 1200,
          disputedAt: DISPUTED_AT,
        },
      }),
      makeItem('kettlebell', 'Kettlebell Foundations'),
    ]);

    const paused = ownedRow('Breathwork for Deep Sleep');
    expect(paused?.classList.contains('row--paused')).toBe(true);
    const badge = paused?.querySelector('.badge');
    expect(badge?.textContent).toBe(m.access_paused_dispute_label());
    expect(badge?.classList.contains('badge--paused')).toBe(true);
    // The link still opens the item's page, which explains the pause.
    expect(paused?.getAttribute('href')).toBe('/content/breathwork');

    const plain = ownedRow('Kettlebell Foundations');
    expect(plain?.classList.contains('row--paused')).toBe(false);
    expect(plain?.querySelector('.badge')?.textContent).toBe('purchased');
  });

  test('the pause outranks the portal badge', () => {
    mountPage([
      makeItem('grounding', 'Grounding Practice', {
        purchase: {
          purchasedAt: '2026-10-02T10:00:00.000Z',
          priceCents: 1200,
          disputedAt: DISPUTED_AT,
        },
        journeys: [{ id: 'j1', title: 'Rootwork', slug: 'rootwork' }],
      }),
    ]);

    expect(
      ownedRow('Grounding Practice')?.querySelector('.badge')?.textContent
    ).toBe(m.access_paused_dispute_label());
  });

  test('its resume card is dimmed and labelled; another is unchanged', () => {
    mountPage([
      makeItem('breathwork', 'Breathwork for Deep Sleep', {
        purchase: {
          purchasedAt: '2026-10-02T10:00:00.000Z',
          priceCents: 1200,
          disputedAt: DISPUTED_AT,
        },
        progress: inProgress,
      }),
      makeItem('kettlebell', 'Kettlebell Foundations', {
        progress: inProgress,
      }),
    ]);

    const paused = resumeCard('Breathwork for Deep Sleep');
    expect(paused?.classList.contains('jec--dimmed')).toBe(true);
    expect(paused?.querySelector('.jec__access')?.textContent).toBe(
      m.access_paused_dispute_label()
    );

    const plain = resumeCard('Kettlebell Foundations');
    expect(plain).toBeDefined();
    expect(plain?.classList.contains('jec--dimmed')).toBe(false);
    expect(plain?.querySelector('.jec__access')).toBeNull();
  });

  test('a subscription item is never read as paused here', () => {
    mountPage([
      makeItem('mobility', 'Mobility Flow: Hips', {
        accessType: 'subscription',
        purchase: null,
      }),
    ]);

    const row = ownedRow('Mobility Flow: Hips');
    expect(row?.classList.contains('row--paused')).toBe(false);
    expect(row?.querySelector('.badge')?.textContent).toBe('via membership');
  });
});

describe('org library: a course paused by a payment dispute', () => {
  test.each([
    'purchase_dispute',
    'subscription_dispute',
  ] as const)('a %s dims its portal card and labels it in place of the access chip', (hold) => {
    mountPage(
      [],
      [
        makeCourse('rootwork', 'Rootwork', hold),
        makeCourse('descent', 'The Descent', null),
      ]
    );

    const paused = courseCard('Your portals', 'Rootwork');
    expect(paused?.classList.contains('jec--dimmed')).toBe(true);
    expect(paused?.querySelector('.jec__access')?.textContent).toBe(
      m.access_paused_dispute_label()
    );
    // Still its dashboard: a refused reader goes on to the sales page, where
    // every Buy and Join slot shows the dispute notice.
    expect(paused?.getAttribute('href')).toBe('/journeys/rootwork/dashboard');

    const plain = courseCard('Your portals', 'The Descent');
    expect(plain?.classList.contains('jec--dimmed')).toBe(false);
    expect(plain?.querySelector('.jec__access')?.textContent).toBe('purchased');
    expect(plain?.getAttribute('href')).toBe('/journeys/descent/dashboard');
  });

  test('its resume card is dimmed and labelled; another is unchanged', () => {
    mountPage(
      [],
      [
        makeCourse('rootwork', 'Rootwork', 'purchase_dispute'),
        makeCourse('descent', 'The Descent', null),
      ]
    );

    const paused = courseCard('Jump back in', 'Rootwork');
    expect(paused?.classList.contains('jec--dimmed')).toBe(true);
    expect(paused?.querySelector('.jec__access')?.textContent).toBe(
      m.access_paused_dispute_label()
    );

    const plain = courseCard('Jump back in', 'The Descent');
    expect(plain).toBeDefined();
    expect(plain?.classList.contains('jec--dimmed')).toBe(false);
    expect(plain?.querySelector('.jec__access')).toBeNull();
  });
});
