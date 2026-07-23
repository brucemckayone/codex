/**
 * Journey studio MOCK data + query layer (Codex-2pryk.3.3 · WP-5).
 *
 * ┌─ INTEGRATION SEAM ─────────────────────────────────────────────────────────┐
 * │ AGGRESSIVE-MODE MOCKS. This module stands in for the real SvelteKit remote  │
 * │ functions until WP-2 lands. The conductor swaps it for `*.remote.ts`        │
 * │ implementations of the FROZEN contract aliases in `$lib/page-builder`       │
 * │ (`ListJourneysQuery`, `GetJourneyForBuilderQuery`, + the create/save        │
 * │ commands). The reactive `query()` shape below (`.current` / `.loading`) is  │
 * │ chosen to MATCH SvelteKit remote `query()` so integration is a one-line     │
 * │ import swap at each call site — see `apps/web/src/lib/remote/content.remote`│
 * │ (`listContent(...).current` / `.loading`) for the real shape.               │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * All money is pence, GBP (§ grounding). All returned shapes conform to the
 * frozen read-model types re-exported from `$lib/page-builder`.
 */
import { browser } from '$app/environment';
import type {
  JourneyListItem,
  JourneyPageRecord,
  PageStatus,
} from '$lib/page-builder';
import { createDefaultSections } from '$lib/page-builder';

// ── Reactive resource (mirrors SvelteKit remote query().current/.loading) ─────

export interface MockResource<T> {
  readonly current: T | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * Resolve `loader` and expose it as a reactive resource. A microtask delay keeps
 * `loading` briefly true so the surfaces exercise their skeleton/empty branches
 * exactly as they will against the real (network-backed) query.
 */
function createMockResource<T>(loader: () => Promise<T>): MockResource<T> {
  let current = $state<T | undefined>(undefined);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  if (browser) {
    loader()
      .then((value) => {
        current = value;
      })
      .catch((err: unknown) => {
        error = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        loading = false;
      });
  } else {
    loading = false;
  }

  return {
    get current() {
      return current;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
  };
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_JOURNEYS: readonly JourneyListItem[] = [
  {
    id: 'jny-stillness',
    pageType: 'course',
    subjectType: 'course',
    slug: 'stillness',
    title: 'Stillness — a 6-week descent',
    status: 'published',
    tagline: 'Come home to the quiet underneath the noise.',
    stageCount: 6,
    practiceCount: 24,
    enrolledCount: 148,
    revenueCents: 512_400,
    updatedAt: '2026-07-20T09:12:00.000Z',
  },
  {
    id: 'jny-first-light',
    pageType: 'course',
    subjectType: 'course',
    slug: 'first-light',
    title: 'First Light',
    status: 'draft',
    tagline: 'A morning practice for beginning again.',
    stageCount: 3,
    practiceCount: 9,
    enrolledCount: 0,
    revenueCents: 0,
    updatedAt: '2026-07-22T16:40:00.000Z',
  },
  {
    id: 'jny-welcome',
    pageType: 'landing',
    subjectType: null,
    slug: 'welcome',
    title: 'Welcome landing page',
    status: 'published',
    tagline: null,
    stageCount: null,
    practiceCount: null,
    enrolledCount: null,
    revenueCents: null,
    updatedAt: '2026-07-11T11:05:00.000Z',
  },
];

/** Build a fresh course-page draft record (a new page or a mock existing one). */
function makePageRecord(
  overrides: Partial<JourneyPageRecord> = {}
): JourneyPageRecord {
  return {
    id: overrides.id ?? 'jny-stillness',
    organizationId: overrides.organizationId ?? 'org-mock',
    publishedAt: overrides.publishedAt ?? null,
    pageType: 'course',
    slug: overrides.slug ?? 'stillness',
    title: overrides.title ?? 'Stillness — a 6-week descent',
    status: overrides.status ?? 'draft',
    subjectType: 'course',
    subjectId: overrides.subjectId ?? 'course-stillness',
    brandOverrides: overrides.brandOverrides ?? null,
    sections:
      overrides.sections ??
      createDefaultSections().map((s, i) =>
        i === 0
          ? {
              ...s,
              props: {
                kicker: 'A 6-week descent',
                headline: 'Come home to stillness',
                subhead:
                  'A guided journey back to the quiet underneath the noise.',
                ctaLabel: 'Begin the journey',
              },
            }
          : s
      ),
  };
}

// ── Query mocks (frozen `ListJourneysQuery` / `GetJourneyForBuilderQuery`) ─────

/** {@link ListJourneysQuery} mock — reactive off org + status filter. */
export function listJourneysMock(input: {
  organizationId: string;
  status?: PageStatus;
}): MockResource<JourneyListItem[]> {
  return createMockResource(async () =>
    MOCK_JOURNEYS.filter((j) => !input.status || j.status === input.status)
  );
}

/** {@link GetJourneyForBuilderQuery} mock — load a draft into the builder. */
export function getJourneyForBuilderMock(input: {
  id: string;
}): MockResource<JourneyPageRecord | null> {
  return createMockResource(async () =>
    makePageRecord({
      id: input.id,
      slug: input.id.replace(/^jny-/, '') || 'draft',
    })
  );
}

// ── Command mocks (the real ones are command()/form() — WP-5 BE) ──────────────

/** Persist the builder's draft. Real impl: `command()` + cache invalidation. */
export async function saveJourneyPageMock(
  _payload: JourneyPageRecord
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** Create a new journey/page. Real impl: `command()`/`form()`; returns the new id. */
export async function createJourneyMock(input: {
  title: string;
  pageType: string;
}): Promise<{ id: string; slug: string }> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const slug =
    input.title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  return { id: `jny-${slug}`, slug };
}
