/**
 * Journeys remote functions (Codex-2pryk · WP-4 + WP-3).
 *
 * - WP-4 member surfaces: the mark-complete COMMAND (dashboard/player DATA is
 *   loaded server-side in their `+page.server.ts` via the Round-D seam).
 * - WP-3 PUBLIC sales page: `getCoursePage` (awaited shell) + `resolveSellPreview`
 *   (streamed 30s previews). Both are fully PUBLIC — NO `canView`, no auth
 *   (HARDENING §E course-sell row). The public sales `+page.server.ts` imports
 *   these through the `journey-data` seam, which now re-exports them from here.
 *
 * `.remote.ts` files may export ONLY remote functions (query/command/…), so the
 * two public reads are `query()`s; the org is resolved from the request host
 * (the same subdomain→slug the router uses), mirroring the member seam's
 * `resolveCourseBySlug`.
 */

import {
  createJourneyBodySchema,
  saveCurriculumBodySchema,
  saveJourneyPageBodySchema,
  updateJourneyOfferBodySchema,
} from '@codex/validation';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import type { PracticeCompletionRecord } from '$lib/journeys/types';
import { logger } from '$lib/observability';
import type {
  CurriculumContentOption,
  EditorCurriculum,
  EnrolledJourneyCard,
  JourneyCardView,
  JourneyCoursePage,
  JourneyListItem,
  JourneyPageRecord,
} from '$lib/page-builder';
import type { SellPreview } from '$lib/page-builder/render';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';
import { persistPracticeCompletion } from '$lib/server/journeys/round-d-seam';
import { getSubdomainContext } from '$lib/utils/subdomain';

// ─────────────────────────────────────────────────────────────────────────────
// WP-3 · Public course sales page (awaited shell + streamed preview)
// ─────────────────────────────────────────────────────────────────────────────

const coursePageSchema = z.object({ slug: z.string().min(1) });

/**
 * Public sales-page read (WP-3), implementing the frozen `GetCoursePageQuery`
 * contract. Resolves the org from the request HOST (org subdomain → slug →
 * `getPublicInfo`, public + KV-cached), then reads the published landing page +
 * course by (orgId, slug). Returns `null` off a non-org host or when no
 * published page matches (→ the load throws 404). Fully PUBLIC — no `canView`.
 */
export const getCoursePage = query(
  coursePageSchema,
  async ({ slug }): Promise<JourneyCoursePage | null> => {
    const { platform, cookies, url } = getRequestEvent();
    const context = getSubdomainContext(url.hostname);
    if (context.type !== 'organization') return null;

    const api = createServerApi(platform, cookies);
    const org = await api.org.getPublicInfo(context.slug);
    if (!org || typeof org !== 'object' || !('id' in org)) return null;

    return api.access.coursePage(org.id, slug);
  }
);

const sellPreviewSchema = z.object({
  // `pageId` is accepted for the frozen seam contract; the sell-preview media
  // lives on the COURSE (`introVideoMediaId` / `previewVideoMediaId`; SPEC §10),
  // so only `courseId` is used to resolve the clips.
  pageId: z.string().uuid(),
  courseId: z.string().uuid(),
});

/**
 * Resolve the public 30s sell previews for a page's intro/reel media (SPEC §10)
 * — NO auth, NO `canView` (HARDENING §E). Streamed off the critical path in the
 * sales load. Reuses the SAME public preview path (`hlsPreviewKey` → CDN URL, no
 * signing) the org-landing hero consumes; the content-api resolves the URL base.
 */
export const resolveSellPreview = query(
  sellPreviewSchema,
  async ({ courseId }): Promise<SellPreview | null> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.access.courseSellPreview(courseId);
  }
);

const markCompleteSchema = z.object({
  contentId: z.string().uuid(),
  source: z.enum(['manual', 'auto']),
});

/**
 * Record a practice completion (SPEC §11 / D-E). Writes the
 * `practice_completions` row — the SOURCE OF TRUTH for course progress — once
 * per (user, content). Called for an explicit "Mark complete" (`manual`) and on
 * a media's genuine 100% finish (`auto`). Auth-gated: completion belongs to a
 * signed-in member.
 *
 * The actual DB write is Round-D (mocked in the seam today); the command
 * contract, auth gate, and validation are real.
 */
export const markPracticeCompleted = command(
  markCompleteSchema,
  async ({ contentId, source }): Promise<PracticeCompletionRecord> => {
    const event = getRequestEvent();
    const userId = event.locals.user?.id;
    if (!userId) error(401, 'Sign in to record progress');

    return persistPracticeCompletion(event, userId, { contentId, source });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Codex-oi2w4 · Member discovery (home / explore / library surfacing)
//
// `listPublishedJourneys` is PUBLIC (org from host, no auth); `listEnrolledJourneys`
// is per-user (the forwarded session cookie → the worker's `userId`; guests get an
// empty shelf). Both resolve the org from the request host, mirroring
// `getCoursePage`; on a non-org host they return []. Streamed callers add a
// `.catch(() => [])` at the load (apps/web CLAUDE.md "Shell + Stream").
// ─────────────────────────────────────────────────────────────────────────────

const discoverJourneysSchema = z
  .object({
    featured: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

/**
 * Public discovery list — PUBLISHED course-journeys for the org home "featured"
 * rail (`{ featured: true }`) + the Explore grid (`{}` / `{ limit }`). Returns
 * [] off a non-org host.
 */
export const listPublishedJourneys = query(
  discoverJourneysSchema,
  async (input): Promise<JourneyCardView[]> => {
    const { platform, cookies, url } = getRequestEvent();
    const context = getSubdomainContext(url.hostname);
    if (context.type !== 'organization') return [];

    const api = createServerApi(platform, cookies);
    const org = await api.org.getPublicInfo(context.slug);
    if (!org || typeof org !== 'object' || !('id' in org)) return [];

    return api.access.listPublishedJourneys((org as { id: string }).id, {
      featured: input?.featured,
      limit: input?.limit,
    });
  }
);

/**
 * The session user's ENROLLED journeys in the current org (library "Your
 * journeys" shelf + continue rail). Self-scoped: the worker derives `userId`
 * from the forwarded session, so guests get []; a non-org host also returns [].
 */
export const listEnrolledJourneys = query(
  async (): Promise<EnrolledJourneyCard[]> => {
    const { platform, cookies, url, locals } = getRequestEvent();
    if (!locals.user) return [];

    const context = getSubdomainContext(url.hostname);
    if (context.type !== 'organization') return [];

    const api = createServerApi(platform, cookies);
    const org = await api.org.getPublicInfo(context.slug);
    if (!org || typeof org !== 'object' || !('id' in org)) return [];

    return api.access.listEnrolledJourneys((org as { id: string }).id);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Codex-isr02 · Studio journey MANAGEMENT (list / builder-load / create / save)
//
// The creator write-path — the REAL remotes that replace the aggressive-mode
// `journey-queries.mock`. All hit the content-api `requireOrgManagement` routes
// (owner/admin); the worker re-derives scope from the session, so a client can
// never redirect an operation to an org it doesn't manage. The org is resolved
// from the studio's request HOST (org subdomain → slug → id), mirroring
// `getCoursePage` above.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the current studio org (host subdomain → `getPublicInfo` id) plus a
 * session-forwarding API client. Returns `null` off a non-org host. Not exported
 * — `.remote.ts` may export only remote functions.
 */
async function resolveStudioOrg(): Promise<{
  api: ReturnType<typeof createServerApi>;
  orgId: string;
} | null> {
  const { platform, cookies, url } = getRequestEvent();
  const context = getSubdomainContext(url.hostname);
  if (context.type !== 'organization') return null;
  const api = createServerApi(platform, cookies);
  const org = await api.org.getPublicInfo(context.slug);
  if (!org || typeof org !== 'object' || !('id' in org)) return null;
  return { api, orgId: (org as { id: string }).id };
}

const listJourneysSchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

/**
 * Studio index list (frozen `ListJourneysQuery`). The org is resolved from the
 * request HOST via `resolveStudioOrg` — consistent with the sibling studio
 * remotes and least-privilege. The `organizationId` in the input is accepted for
 * the frozen contract but is NOT trusted here (review L2); the worker's
 * `requireOrgManagement` is the authority in any case.
 */
export const listJourneys = query(
  listJourneysSchema,
  async ({ status }): Promise<JourneyListItem[]> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return [];
    return ctx.api.access.listJourneys(ctx.orgId, status);
  }
);

const listJourneyRevenueSchema = z
  .object({ organizationId: z.string().uuid() })
  .optional();

/**
 * Studio index BATCH revenue (Codex-9p47t) — authoritative gross 30d revenue per
 * journey, keyed by landing-page id (the figure `listJourneys` omits to avoid
 * drift from the per-journey Insights read). Runs as a SEPARATE query from
 * `listJourneys` so the row list paints immediately and the badge streams in
 * (SPA-native "await critical, stream secondary"). Org from the request HOST via
 * `resolveStudioOrg`; the input org is not trusted (the worker's
 * `requireOrgManagement` is the authority). `{}` off a non-org host.
 */
export const listJourneyRevenue = query(
  listJourneyRevenueSchema,
  async (): Promise<Record<string, number>> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return {};
    return ctx.api.access.listJourneyRevenue(ctx.orgId, '30d');
  }
);

const journeyIdSchema = z.object({ id: z.string().uuid() });

/**
 * Load a page draft into the builder (frozen `GetJourneyForBuilderQuery`).
 * Org-scoped by the worker → `null` for a foreign/missing page (IDOR-safe).
 */
export const getJourneyForBuilder = query(
  journeyIdSchema,
  async ({ id }): Promise<JourneyPageRecord | null> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return null;
    return ctx.api.access.getJourneyForBuilder(ctx.orgId, id);
  }
);

/**
 * Create a journey (draft) and return its page id + slug. A `course` page also
 * creates the subject course row (one transaction, worker-side).
 */
export const createJourney = command(
  createJourneyBodySchema,
  async (input): Promise<{ id: string; slug: string }> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) {
      error(400, 'Journeys can only be created within an organization');
    }
    return ctx.api.access.createJourney(ctx.orgId, input);
  }
);

/** Persist the builder's draft (frozen save command). */
export const saveJourneyPage = command(
  saveJourneyPageBodySchema,
  async (record): Promise<void> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) {
      error(400, 'Journeys can only be saved within an organization');
    }
    await ctx.api.access.saveJourneyPage(ctx.orgId, record);
  }
);

/**
 * Set the journey's ways-in + prices (pence, GBP) — the pricing panel's write.
 * Distinct from {@link saveJourneyPage}: the worker persists the offer AND the
 * authoritative `courses.price_cents` in one transaction, so a price change makes
 * the journey buyable without republishing the page body.
 */
export const updateJourneyOffer = command(
  z.object({
    pageId: z.string().uuid(),
    offer: updateJourneyOfferBodySchema,
  }),
  async ({ pageId, offer }) => {
    const ctx = await resolveStudioOrg();
    if (!ctx) {
      error(400, 'Journey pricing can only be set within an organization');
    }
    try {
      // `command()` infers a `.nullable()` field as OPTIONAL (the same quirk the
      // save schema's slug comment documents), so the parsed prices arrive as
      // `number | undefined`. The worker's `priceCentsSchema` is nullable but NOT
      // optional — an absent key 400s — so restore the explicit nulls here rather
      // than let "no price" travel as a missing key.
      return await ctx.api.access.updateJourneyOffer(ctx.orgId, pageId, {
        tiersEnabled: offer.tiersEnabled,
        subscriptionEnabled: offer.subscriptionEnabled,
        subscriptionPriceCents: offer.subscriptionPriceCents ?? null,
        oneOffEnabled: offer.oneOffEnabled,
        oneOffPriceCents: offer.oneOffPriceCents ?? null,
      });
    } catch (err) {
      // A 4xx here is the service's own pricing guidance ("Set a one-off price,
      // or turn the one-off path off") — user-actionable, so forward it through
      // `error()` where SvelteKit will deliver the text to the client toast. A
      // bare throw would surface only a generic failure, which is how an
      // unsellable offer could look like a mystery instead of a fixable mistake.
      // 5xx is NOT forwarded: it may carry internals, so it propagates as-is.
      if (ApiError.isApiError(err) && err.status >= 400 && err.status < 500) {
        error(err.status, err.message);
      }
      throw err;
    }
  }
);

/**
 * Studio LIVE-PREVIEW read (Codex-isr02 P0b-2). Resolves the sell-page envelope
 * for ANY status (drafts included) so the builder iframe can render an
 * unpublished draft. Management-gated by the worker (`requireOrgManagement`); the
 * org is resolved from the request HOST. Returns null off a non-org host, for a
 * non-manager (the worker denies → caught here), or when no such page exists —
 * so the public sell load's fallback fail-closes to a 404. Reuses the public
 * `coursePageSchema` (`{ slug }`).
 */
export const getCoursePagePreview = query(
  coursePageSchema,
  async ({ slug }): Promise<JourneyCoursePage | null> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return null;
    try {
      return await ctx.api.access.coursePagePreview(ctx.orgId, slug);
    } catch (err) {
      // Fail-closed: ANY failure → no preview → the caller 404s. A 403 is the
      // EXPECTED non-manager denial (the worker's requireOrgManagement), so it
      // stays silent; log only UNEXPECTED failures (5xx / timeout) so a transient
      // worker outage degrading a real manager's preview to a 404 isn't invisible.
      const status = (err as { status?: number } | null)?.status;
      if (status !== 403) {
        logger.error('journey draft preview read failed', {
          error: err instanceof Error ? err.message : String(err),
          status,
        });
      }
      return null;
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Codex-03cwh · Studio curriculum editor (two-pane tree + inspector + picker)
// ─────────────────────────────────────────────────────────────────────────────

const curriculumPageSchema = z.object({ pageId: z.string().uuid() });

/**
 * The admin curriculum for the two-pane editor. Org resolved from the request
 * HOST via `resolveStudioOrg`; the worker's `requireOrgManagement` is the
 * authority + resolves the subject course from the page id (a foreign/missing/
 * non-course page 404s → this rejects). `null` only off a non-org host.
 */
export const getCourseCurriculum = query(
  curriculumPageSchema,
  async ({ pageId }): Promise<EditorCurriculum | null> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return null;
    return ctx.api.access.getCourseCurriculum(ctx.orgId, pageId);
  }
);

const listCurriculumContentSchema = z.object({
  contentType: z.enum(['video', 'audio', 'written']).optional(),
  search: z.string().trim().max(200).optional(),
});

/**
 * "Choose from your library" PICKER options — the org's existing content the
 * editor can attach as a practice. REUSES the studio content-list read
 * (`api.content.list`, scope = the signed-in creator's own content, org-scoped)
 * rather than a new endpoint; drafts are included (a curriculum is built before
 * its media publishes). `[]` off a non-org host. The space guard on save is the
 * authority — this is only the UI candidate list.
 */
export const listCurriculumContentOptions = query(
  listCurriculumContentSchema,
  async ({ contentType, search }): Promise<CurriculumContentOption[]> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) return [];
    const params = new URLSearchParams();
    params.set('organizationId', ctx.orgId);
    params.set('limit', '100');
    if (contentType) params.set('contentType', contentType);
    if (search) params.set('search', search);
    const res = await ctx.api.content.list(params);
    return (res?.items ?? []).map((c) => ({
      contentId: c.id,
      title: c.title,
      contentType:
        c.contentType === 'audio' || c.contentType === 'written'
          ? c.contentType
          : 'video',
      status:
        c.status === 'published' || c.status === 'archived'
          ? c.status
          : 'draft',
      thumbnailUrl: c.thumbnailUrl ?? null,
    }));
  }
);

const saveCurriculumSchema = saveCurriculumBodySchema.extend({
  pageId: z.string().uuid(),
});

/**
 * Bulk-save the whole curriculum (stages + practice joins) for the journey's
 * subject course. The worker reconciles in one transaction (space-guarding
 * every practice's content to the org) and returns the freshly-persisted
 * curriculum — the editor swaps its optimistic state for this on success.
 */
export const saveCourseCurriculum = command(
  saveCurriculumSchema,
  async ({ pageId, stages }): Promise<EditorCurriculum> => {
    const ctx = await resolveStudioOrg();
    if (!ctx) {
      error(400, 'Curriculum can only be saved within an organization');
    }
    // `command()` infers the schema's `.nullable()` fields as OPTIONAL (dropping
    // `null`), so normalise `id`/`gloss` back to `T | null` for the api client —
    // an absent/undefined `id` is a new stage the server will assign.
    return ctx.api.access.saveCourseCurriculum(ctx.orgId, pageId, {
      stages: stages.map((s) => ({
        id: s.id ?? null,
        name: s.name,
        gloss: s.gloss ?? null,
        practices: s.practices,
      })),
    });
  }
);
