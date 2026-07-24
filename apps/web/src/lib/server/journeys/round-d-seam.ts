/**
 * Round-D integration seam (Codex-2pryk · WP-4) — THE SINGLE MOCK BOUNDARY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * WP-4 (dashboard + in-course player) is stacked on WP-2's resolver, but the
 * web→worker PLUMBING — the routes/endpoints the SSR gate and the mark-complete
 * command call — is a Round-D integration task. So every not-yet-wired
 * web→worker call this WP needs is ISOLATED here, returning CONTRACT-SHAPED mock
 * data. The FE, the progress-store extension, the gate structure, and the
 * mark-complete flow are all REAL against these shapes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT ROUND-D DOES
 * ═══════════════════════════════════════════════════════════════════════════
 * Replace each function BODY with the real `createServerApi(platform, cookies)`
 * call — the SIGNATURES and RETURN SHAPES are frozen against
 * `$lib/journeys/types` and the `EntitlementResolver` contract
 * (`@codex/shared-types` · `journeys.ts`), so no caller changes:
 *
 *   resolveCanEnterCourse   → api.access.canEnterCourse(userId, courseId)      [WP-2]
 *   resolveCanView          → api.access.canView(userId, contentId)            [WP-2]
 *   resolveCourseBySlug     → content-api course lookup by (orgId, slug)
 *   fetchCourseDashboard    → enrollment + rollup query (practice_completions
 *                             ⋈ stage_practices scoped to enrollment, SPEC §11)
 *   fetchInCoursePractice   → practice + signed stream URL + playlist
 *   persistPracticeCompletion → INSERT practice_completions (once per user)
 *
 * Entitlement reads are per-request / never cross-user cached (HARDENING §E).
 *
 * server-only ($lib/server/*): never bundled to the client.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { toPlaylist } from '$lib/journeys/rollup';
import type {
  CompletionSource,
  CourseDashboardData,
  InCoursePracticeData,
  JourneyCourseSummary,
  JourneyStage,
  PracticeCompletionRecord,
} from '$lib/journeys/types';

/**
 * The request context each seam call needs. Structurally satisfied by both a
 * SvelteKit server-load event and a remote-function `getRequestEvent()`. Round-D
 * uses `platform` + `cookies` to build the server API; `url` carries dev-only
 * mock walkthrough flags; `locals` carries the resolved user.
 */
export type SeamContext = Pick<
  RequestEvent,
  'platform' | 'cookies' | 'locals' | 'url'
>;

// ─────────────────────────────────────────────────────────────────────────────
// Mock fixture — a single sample course ("Rootwork") mirroring the prototype.
// Stable, valid RFC4122 v4 UUIDs so the mark-complete command's
// `z.string().uuid()` accepts them and the store keys stay consistent.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_COURSE: JourneyCourseSummary = {
  id: '2c000000-0000-4000-8000-000000000001',
  slug: 'rootwork',
  title: 'Rootwork',
  organizationSlug: null,
};

const uid = (n: number): string =>
  `2c000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

const MOCK_STAGES: JourneyStage[] = [
  {
    id: '2c000000-0000-4000-8000-0000000000a1',
    name: 'Orientation',
    gloss: 'Find your footing before the work begins.',
    sortOrder: 0,
    practices: [
      {
        contentId: uid(1),
        slug: 'welcome',
        title: 'Welcome to the journey',
        contentType: 'video',
        durationSeconds: 320,
        thumbnailUrl: null,
        sortOrder: 0,
      },
      {
        contentId: uid(2),
        slug: 'set-your-intention',
        title: 'Set your intention',
        contentType: 'written',
        durationSeconds: null,
        thumbnailUrl: null,
        sortOrder: 1,
      },
    ],
  },
  {
    id: '2c000000-0000-4000-8000-0000000000a2',
    name: 'The Practice',
    gloss: 'Daily reps that compound.',
    sortOrder: 1,
    practices: [
      {
        contentId: uid(3),
        slug: 'morning-sit',
        title: 'The morning sit',
        contentType: 'audio',
        durationSeconds: 600,
        thumbnailUrl: null,
        sortOrder: 0,
      },
      {
        contentId: uid(4),
        slug: 'field-notes',
        title: 'Field notes',
        contentType: 'written',
        durationSeconds: null,
        thumbnailUrl: null,
        sortOrder: 1,
      },
      {
        contentId: uid(5),
        slug: 'deep-work-session',
        title: 'Deep work session',
        contentType: 'video',
        durationSeconds: 1500,
        thumbnailUrl: null,
        sortOrder: 2,
      },
    ],
  },
];

/** Dev-only walkthrough flags carried on the URL (mock only; ignored in Round-D). */
function mockFlags(ctx: SeamContext): { denied: boolean; firstRun: boolean } {
  const p = ctx.url.searchParams;
  return {
    denied: p.get('mock') === 'denied',
    firstRun: p.has('first') || p.get('state') === 'new',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seam functions (mock bodies — Round-D swaps each for a real API call)
// ─────────────────────────────────────────────────────────────────────────────

/** ROUND-D: content-api course lookup by (orgId, slug). */
export async function resolveCourseBySlug(
  _ctx: SeamContext,
  slug: string
): Promise<JourneyCourseSummary | null> {
  // MOCK: only the sample course resolves.
  return slug === MOCK_COURSE.slug ? MOCK_COURSE : null;
}

/** ROUND-D: `api.access.canEnterCourse(userId, courseId)` (WP-2 resolver). */
export async function resolveCanEnterCourse(
  ctx: SeamContext,
  userId: string | null,
  _courseId: string
): Promise<boolean> {
  // MOCK: entitled when authenticated, unless the dev denied-walk flag is set.
  if (mockFlags(ctx).denied) return false;
  return userId !== null;
}

/** ROUND-D: `api.access.canView(userId, contentId)` (gates the signed stream). */
export async function resolveCanView(
  ctx: SeamContext,
  userId: string | null,
  _contentId: string
): Promise<boolean> {
  // MOCK: a course member can view its practices (canEnterCourse ⇒ canView here).
  if (mockFlags(ctx).denied) return false;
  return userId !== null;
}

/**
 * ROUND-D: enrollment + progress rollup (`practice_completions ⋈ stage_practices`
 * scoped to the enrollment — SPEC §11). MOCK: sample curriculum with a couple of
 * pre-existing completions (or none under the first-run flag).
 */
export async function fetchCourseDashboard(
  ctx: SeamContext,
  _userId: string,
  _courseId: string
): Promise<CourseDashboardData | null> {
  const { firstRun } = mockFlags(ctx);
  const completions: PracticeCompletionRecord[] = firstRun
    ? []
    : [
        { contentId: uid(1), completedAt: isoDaysAgo(3), source: 'auto' },
        { contentId: uid(2), completedAt: isoDaysAgo(2), source: 'manual' },
      ];

  return {
    course: MOCK_COURSE,
    enrollment: {
      courseId: MOCK_COURSE.id,
      enrolledAt: isoDaysAgo(4),
      lastActivityAt: firstRun ? null : isoDaysAgo(1),
      completedAt: null,
    },
    stages: MOCK_STAGES,
    completions,
  };
}

/**
 * ROUND-D: practice + SIGNED stream URL + playlist. MOCK: resolves the practice
 * by slug; `streamingUrl` stays null (no R2 signing in the mock — the player
 * degrades to a "stream loads when access plumbing lands" placeholder). Written
 * practices get a small body; the playlist is the full ordered course sequence.
 */
export async function fetchInCoursePractice(
  ctx: SeamContext,
  _userId: string,
  _courseId: string,
  contentSlug: string
): Promise<InCoursePracticeData | null> {
  let found: { stage: JourneyStage; practiceIndex: number } | null = null;
  for (const stage of MOCK_STAGES) {
    const idx = stage.practices.findIndex((p) => p.slug === contentSlug);
    if (idx !== -1) {
      found = { stage, practiceIndex: idx };
      break;
    }
  }
  if (!found) return null;

  const practice = found.stage.practices[found.practiceIndex];
  const { firstRun } = mockFlags(ctx);

  return {
    course: MOCK_COURSE,
    stage: { id: found.stage.id, name: found.stage.name },
    practice,
    // ROUND-D: api.access.getStreamingUrl(contentId) for media.
    streamingUrl: null,
    waveformUrl: null,
    // ROUND-D: rendered content body for written practices.
    bodyHtml:
      practice.contentType === 'written'
        ? '<p>This practice loads its written body when the content plumbing lands in Round-D.</p>'
        : null,
    initialProgressSeconds: 0,
    playlist: toPlaylist(MOCK_STAGES),
    completions: firstRun
      ? []
      : [
          { contentId: uid(1), completedAt: isoDaysAgo(3), source: 'auto' },
          { contentId: uid(2), completedAt: isoDaysAgo(2), source: 'manual' },
        ],
  };
}

/**
 * ROUND-D: INSERT a `practice_completions` row (once per user — the unique
 * index makes a repeat a no-op). MOCK: echoes the completion back so the
 * optimistic store write can settle to `synced`.
 */
export async function persistPracticeCompletion(
  _ctx: SeamContext,
  _userId: string,
  input: { contentId: string; source: CompletionSource }
): Promise<PracticeCompletionRecord> {
  return {
    contentId: input.contentId,
    completedAt: new Date().toISOString(),
    source: input.source,
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
