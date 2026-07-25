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
 * The builder-draft mock is seeded with the finished prototype's "Rootwork" copy
 * + variants + a warm/dark per-page brand override, so the builder OPENS looking
 * like the mockup (`docs/design/course-journeys/prototype/course-sell.html`). All
 * money is pence, GBP. All returned shapes conform to the frozen read-model types.
 */
import { browser } from '$app/environment';
import type {
  JourneyListItem,
  JourneyPageRecord,
  PageSection,
  PageStatus,
} from '$lib/page-builder';
import type { JourneyStagePreview } from '$lib/page-builder/render';

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

// ── Mock list data ────────────────────────────────────────────────────────────

const MOCK_JOURNEYS: readonly JourneyListItem[] = [
  {
    id: 'jny-rootwork',
    pageType: 'course',
    subjectType: 'course',
    slug: 'rootwork',
    title: 'Rootwork — the foundation course',
    status: 'draft',
    tagline: 'Teach your body it is safe to soften.',
    stageCount: 5,
    practiceCount: 14,
    enrolledCount: 2400,
    revenueCents: 1_728_000,
    updatedAt: '2026-07-24T09:12:00.000Z',
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

// ── The "Rootwork" seed — the prototype's initial page (course-sell.html) ─────

/** The descent map's curriculum, previewed by the map/descent section. */
export const MOCK_PREVIEW_STAGES: readonly JourneyStagePreview[] = [
  {
    name: 'Arrival',
    gloss: 'Landing in the body, before anything is asked of it.',
    lessons: [
      { title: 'The first breath', type: 'audio', minutes: 8, free: true },
      { title: 'Where you brace', type: 'practice', minutes: 11 },
      { title: 'The weight of the day', type: 'audio', minutes: 9 },
    ],
  },
  {
    name: 'Ground',
    gloss: 'Finding the floor beneath the feeling.',
    lessons: [
      { title: 'Feet, floor, gravity', type: 'practice', minutes: 12 },
      { title: 'The long exhale', type: 'audio', minutes: 7 },
      { title: 'Settling the chest', type: 'meditation', minutes: 14 },
    ],
  },
  {
    name: 'Thaw',
    gloss: 'Letting the held places begin to move.',
    lessons: [
      { title: 'Small movements', type: 'video', minutes: 10 },
      { title: 'The shake', type: 'practice', minutes: 9 },
      { title: 'Warmth returning', type: 'audio', minutes: 11 },
    ],
  },
  {
    name: 'Tend',
    gloss: 'Staying with what surfaces, without fixing.',
    lessons: [
      { title: 'A hand on the sternum', type: 'practice', minutes: 8 },
      { title: 'Naming, softly', type: 'reflection', minutes: 6 },
      { title: 'The quiet after', type: 'meditation', minutes: 13 },
    ],
  },
  {
    name: 'Root',
    gloss: 'Practising the return, so it becomes yours.',
    lessons: [
      { title: 'The daily ten', type: 'practice', minutes: 10 },
      { title: 'Coming back', type: 'audio', minutes: 9 },
    ],
  },
];

/** A seeded section with the prototype copy — stable ids so selection persists. */
function seed(
  id: string,
  type: string,
  variant: string,
  name: string,
  props: Record<string, unknown>,
  enabled = true
): PageSection {
  return { id, type, enabled, variant, name, props };
}

function courseSeedSections(): PageSection[] {
  return [
    seed('sec-hero', 'hero', 'centered', 'Hero', {
      eyebrow: 'The foundation course · a somatic practice',
      headline: 'Teach your body it is safe to',
      accent: 'soften.',
      sub: 'Rootwork is where Of Blood and Bones begins — fourteen guided practices that bring a braced nervous system back to ground.',
      felt: 'Not talked through. Felt through.',
      button: 'Begin free · first practice',
      quiet: 'See the descent',
      trust: 'Practised by 2,400+ people finding their ground · cancel anytime',
      bg: 'ember',
    }),
    seed('sec-introvideo', 'introVideo', 'cinema', 'Intro film', {
      kicker: 'The film',
      heading: 'Meet the work',
      sub: 'A short introduction to how Rootwork actually feels — in the body, not the head.',
      clip: 'Intro film',
      duration: '1:24',
    }),
    seed('sec-ache', 'ache', 'centered', 'The ache', {
      kicker: 'If this is you',
      heading: 'A body that never quite feels safe.',
      body: 'The tight chest. The shallow breath. The sense of bracing for something that never comes. You have tried to think your way out. The body does not speak in thoughts.',
    }),
    seed('sec-turn', 'turn', 'statement', 'The turn', {
      kicker: 'What changes',
      heading: 'Safety is a skill the body can learn.',
      body: 'Not insight — practice. Small, repeatable practices that teach the nervous system it is allowed to settle. That is all Rootwork is: the ground beneath every other journey.',
    }),
    seed('sec-reel', 'reel', 'cinema', 'See it in motion', {
      kicker: 'In motion',
      heading: 'A practice, in real time',
      sub: 'Watch a full practice unfold — unscripted, unhurried, exactly as you would meet it.',
      clip: 'Practice preview',
      duration: '0:42',
    }),
    seed('sec-map', 'map', 'descent', 'The descent map', {
      eyebrow: 'The whole descent',
      heading: "Everything you'll walk.",
      sub: 'Five gated depths. Within each, a handful of practices to move among freely — settle one ground before the next opens.',
      note: 'One door is already ajar. Included with membership · £12 a month',
    }),
    seed(
      'sec-feel',
      'feel',
      'centered',
      'Feels like',
      {
        kicker: 'What to expect',
        heading: 'Quiet. Slow. Yours.',
        body: 'No performance, no getting it right. Just you, a quiet room, and a voice that lets the body set the pace.',
      },
      false
    ),
    seed('sec-proof', 'proof', 'grid', 'Proof', {
      eyebrow: 'From the circle',
      heading: 'What the ground gives back.',
      q1: "For the first time in years, I slept without bracing. I didn't know my body was allowed to do that.",
      n1: 'Maya R.',
      c1: '3 months in',
      q2: 'I came for grief. Rootwork taught me how to stay in my body long enough to feel it.',
      n2: 'Daniel K.',
      c2: 'new member',
      q3: "The only practice I've ever kept. Ten minutes that change the whole shape of the day.",
      n3: 'Priya S.',
      c3: '8 months in',
      trust: '2,400 practising the ground',
    }),
    seed('sec-guide', 'guide', 'portrait', 'The guide', {
      role: 'Your guide',
      heading: 'Made by someone who had to find the ground first.',
      body: "Of Blood and Bones grew out of one practitioner's own long descent — years of somatic training, trauma-informed practice, and the slow relearning of safety in the body. Rootwork is the map they wished they'd been handed at the start.",
      quote: "I couldn't think my way home. I had to feel the way down.",
      clip: 'Meet your guide',
      duration: '2:04',
    }),
    seed('sec-faq', 'faq', 'accordion', 'FAQ', {
      heading: 'The honest answers',
      q1: 'Do I need any experience?',
      a1: 'None at all. Rootwork assumes a body and a few quiet minutes — nothing else. Every practice is guided from the very first step.',
      q2: 'What if I can only manage five minutes?',
      a2: 'Then five minutes is the practice. Most are under twelve, and the shorter ones are built for exactly the days when that is all there is.',
      q3: 'Can I keep the practices after?',
      a3: "Anything you've begun stays yours to return to for as long as your membership is active — and you can pause or cancel any time.",
    }),
    seed('sec-invite', 'invite', 'descent', 'The invitation', {
      eyebrow: 'Begin the descent',
      heading: 'The ground',
      accent: 'is waiting.',
      sub: 'One key opens Rootwork and every journey that grows from it.',
      price: 'Included with membership · £12 a month',
      button: 'Begin with Rootwork',
      risk: "Start free · cancel anytime · keep what you've begun",
    }),
  ];
}

/** Build the seeded course-page draft record (the mock "Rootwork" journey). */
function makePageRecord(
  overrides: Partial<JourneyPageRecord> = {}
): JourneyPageRecord {
  return {
    id: overrides.id ?? 'jny-rootwork',
    organizationId: overrides.organizationId ?? 'org-mock',
    publishedAt: overrides.publishedAt ?? null,
    pageType: 'course',
    slug: overrides.slug ?? 'rootwork',
    title: overrides.title ?? 'Rootwork',
    status: overrides.status ?? 'draft',
    subjectType: 'course',
    subjectId: overrides.subjectId ?? 'course-rootwork',
    brandOverrides: overrides.brandOverrides ?? {
      primaryColor: '#d8a94e',
      secondaryColor: '#8a2b22',
      accentColor: '#c9857f',
      backgroundColor: '#15110c',
    },
    seo: overrides.seo ?? {
      title: 'Rootwork — the foundation course',
      description:
        'Somatic practices that teach the body the basics of safety and settling.',
    },
    offer: overrides.offer ?? {
      tiersEnabled: true,
      subscriptionEnabled: true,
      subscriptionPriceCents: 600,
      oneOffEnabled: false,
      oneOffPriceCents: 4500,
    },
    sections: overrides.sections ?? courseSeedSections(),
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
  return createMockResource(async () => makePageRecord({ id: input.id }));
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
