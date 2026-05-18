/**
 * Revenue-Share Agreement Routes (Codex-hqke2 — WP-3 of epic Codex-nk4km)
 *
 * HTTP boundary over `@codex/agreements` `AgreementService` (WP-2 / PR
 * #210). All endpoints use `procedure()` and consume services via
 * `ctx.services.agreements` — never instantiate the service inline.
 *
 * Authorisation contract:
 *
 *   - Owner-side mutations (`POST /agreements/propose`) and owner-side
 *     reads (`GET /agreements`) gate at the route layer with
 *     `requireOrgMembership: true` to resolve `ctx.organizationId`. The
 *     SERVICE then enforces strict ownership via `assertActiveOwner` —
 *     the route does NOT re-check owner-role. This keeps the
 *     authorisation rules in one place and means a future Owner-vs-Admin
 *     split lands once, in the service, without rewriting routes.
 *
 *   - Counterparty mutations (`accept` / `decline` / `counter` /
 *     `withdraw`) gate at the route layer with `auth: 'required'` only
 *     — the service determines the counterparty role from the parent
 *     proposal's `proposedByRole` and matches against `ctx.user.id`.
 *
 *   - `terminate` is open to either party — service enforces.
 *
 *   - Creator self-read (`GET /agreements/me`) gates at the route layer
 *     with `auth: 'required'` only — the service-side query is already
 *     scoped on `creatorId = ctx.user.id`.
 *
 * Anonymisation contract (visibility decision in the epic plan):
 *
 *   - Owner-view (`GET /agreements`) returns every active row on the
 *     org with full identifying fields. No masking.
 *
 *   - Creator-view (`GET /agreements/me`) returns the creator's own
 *     rows ENRICHED with a single aggregate slice for the rest of the
 *     org:
 *       `peers: { count: number, aggregateSharePercent: number }`
 *     The aggregate is computed in the route handler — the SERVICE
 *     stays free of UI-visibility logic so a future BO/internal tool can
 *     consume the unshaped query if needed. NEVER include peer
 *     `creatorId` / `userId` / display fields in the creator-view
 *     response. The test suite has explicit pin tests for this.
 *
 * Error mapping:
 *
 *   - Typed errors (`AgreementNotFoundError`, `InvalidProposalStateError`,
 *     `ShareExceedsAvailableError`, `ForbiddenError`) propagate up to
 *     `mapErrorToResponse()` via `procedure()`. Routes do NOT catch.
 *
 * See plan `/Users/brucemckay/.claude/plans/ok-awesome-we-unified-flamingo.md`
 * sections "Service Layer / Worker API" and "Visibility" decision.
 */

import { NotFoundError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import {
  agreementIdParamSchema,
  counterProposeInputSchema,
  declineProposalInputSchema,
  getNegotiationThreadQuerySchema,
  listAgreementsQuerySchema,
  ownerThreadParamSchema,
  proposalIdParamSchema,
  proposeAgreementInputSchema,
  proposeAgreementQuerySchema,
  terminateAgreementInputSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const agreements = new Hono<HonoEnv>();

// ─── Owner-side mutations ─────────────────────────────────────────────────

/**
 * POST /agreements/propose?organizationId=<uuid>
 *
 * Owner-initiated round 1 proposal. The target `organizationId` is in
 * the QUERY STRING (not the body) — `procedure()`'s `resolveOrganizationId`
 * only reads URL params, subdomain, or query string. Policy enforcement
 * runs before input validation, so a body-only orgId never reaches the
 * resolver and the request 400s with `ORG_CONTEXT_REQUIRED`. The body
 * carries the per-agreement fields: creator / revenue-type / share /
 * term / note / effectiveFrom.
 *
 * The service enforces:
 *   - actor is an active owner of the org (`assertActiveOwner`)
 *   - target user is an active member of the org (`assertActiveMember`)
 *   - no thread is already in flight for the same triple
 *   - proposed share fits within the post-platform pool
 *
 * Returns the new proposal row (`{ data: AgreementProposal }`) with HTTP
 * 201 — POST-create semantics matching the rest of the worker.
 */
agreements.post(
  '/propose',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      query: proposeAgreementQuerySchema,
      body: proposeAgreementInputSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      // Forward `ctx.organizationId` (resolved from `?organizationId=`
      // in the query by `procedure()`'s membership gate) so a client
      // cannot redirect the propose into a different org. This mirrors
      // the hardening pattern documented in `routes/sales.ts`.
      return await ctx.services.agreements.proposeAgreement({
        organizationId: ctx.organizationId,
        creatorId: ctx.input.body.creatorId,
        revenueType: ctx.input.body.revenueType,
        sharePercent: ctx.input.body.sharePercent,
        termMonths: ctx.input.body.termMonths,
        note: ctx.input.body.note ?? null,
        proposedByUserId: ctx.user.id,
        effectiveFrom: ctx.input.body.effectiveFrom,
      });
    },
  })
);

// ─── Counterparty mutations ───────────────────────────────────────────────

/**
 * POST /agreements/:proposalId/counter
 *
 * Counter-proposal. The service derives the actor role from the parent
 * proposal (`proposed_by_role` flips), so the route's auth gate is
 * just `auth: 'required'`. The service rejects the request with
 * `ForbiddenError` if `ctx.user.id` is not the appropriate counterparty.
 *
 * Successful counters return the NEW child proposal row with 201.
 */
agreements.post(
  '/:proposalId/counter',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: proposalIdParamSchema,
      body: counterProposeInputSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.agreements.counterPropose({
        proposalId: ctx.input.params.proposalId,
        sharePercent: ctx.input.body.sharePercent,
        termMonths: ctx.input.body.termMonths,
        note: ctx.input.body.note ?? null,
        counteredByUserId: ctx.user.id,
      });
    },
  })
);

/**
 * POST /agreements/:proposalId/accept
 *
 * Accept an open proposal. Service performs the atomic 6-step write
 * (mark accepted → supersede siblings → terminate predecessor active
 * agreement → insert new active row with dual-write of the legacy
 * `organization_fee_percentage` column). Returns the new active
 * `CreatorOrganizationAgreement` row with 201 — accepting a proposal
 * CREATES a new active agreement row + supersedes prior, so the
 * create-semantic status applies even though the verb is "accept".
 */
agreements.post(
  '/:proposalId/accept',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: proposalIdParamSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.agreements.acceptProposal({
        proposalId: ctx.input.params.proposalId,
        acceptedByUserId: ctx.user.id,
      });
    },
  })
);

/**
 * POST /agreements/:proposalId/decline
 *
 * Decline an open proposal. Optional reason captured in
 * `agreement_proposals.decline_reason` for audit.
 */
agreements.post(
  '/:proposalId/decline',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: proposalIdParamSchema,
      body: declineProposalInputSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.agreements.declineProposal({
        proposalId: ctx.input.params.proposalId,
        declinedByUserId: ctx.user.id,
        reason: ctx.input.body.reason ?? null,
      });
    },
  })
);

/**
 * POST /agreements/:proposalId/withdraw
 *
 * Withdraw an open proposal. Only the side that proposed may withdraw —
 * service enforces.
 */
agreements.post(
  '/:proposalId/withdraw',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: proposalIdParamSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.agreements.withdrawProposal({
        proposalId: ctx.input.params.proposalId,
        withdrawnByUserId: ctx.user.id,
      });
    },
  })
);

// ─── Termination ──────────────────────────────────────────────────────────

/**
 * POST /agreements/:agreementId/terminate
 *
 * Soft-terminate an active agreement. Either party may invoke — the
 * service accepts the request if the actor is the named creator OR an
 * active owner of the org. Mid-invoice termination semantics per the
 * locked epic decision (Q3): no pro-rating, active-as-of-invoice-date
 * receives the full cut for that period.
 */
agreements.post(
  '/:agreementId/terminate',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: agreementIdParamSchema,
      body: terminateAgreementInputSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.agreements.terminateAgreement({
        agreementId: ctx.input.params.agreementId,
        terminatedByUserId: ctx.user.id,
        reason: ctx.input.body.reason ?? null,
      });
    },
  })
);

// ─── Owner-side reads ─────────────────────────────────────────────────────

/**
 * GET /agreements?organizationId=...
 *
 * Owner/admin-view list of active agreements on the org. Gated with
 * `requireOrgManagement: true` (owner OR admin only) — rank-and-file
 * members must NOT see peer creator shares. The service receives
 * `ctx.organizationId` (resolved from membership, not the body) so a
 * forged `organizationId` query param cannot redirect the read to
 * another org.
 *
 * Returns a paginated envelope even though the service returns the full
 * list — keeps the contract consistent with every other list endpoint in
 * the worker and gives the UI room to switch to server-side pagination
 * if the active count ever grows beyond what fits on one page.
 */
agreements.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: listAgreementsQuerySchema },
    handler: async (ctx) => {
      const items = await ctx.services.agreements.getActiveAgreements({
        organizationId: ctx.organizationId,
      });
      // Owner-view filtering by revenueType is shaping in the route — the
      // service intentionally returns both buckets in one query to avoid
      // N+1 on the studio settings page.
      const filtered = ctx.input.query.revenueType
        ? items.filter((a) => a.revenueType === ctx.input.query.revenueType)
        : items;
      // TODO(pagination): proper page+limit support when row counts grow
      // beyond a single studio-page render. Today the synthetic envelope
      // returns all rows as one page; the service is the natural place
      // to push offset/limit when that ceiling is reached.
      return new PaginatedResult(filtered, {
        page: 1,
        limit: filtered.length,
        total: filtered.length,
        totalPages: 1,
      });
    },
  })
);

/**
 * GET /agreements/threads/:creatorId?revenueType=...
 *
 * Owner/admin-view negotiation thread for one (creator, revenueType)
 * triple on this org. Returns chronological proposal history — used by
 * the studio settings/revenue-share page to render the negotiation
 * timeline.
 *
 * Gated with `requireOrgManagement: true` (owner OR admin only) — same
 * reasoning as GET /agreements: rank-and-file members must not see peer
 * negotiation details. The service will fall through with an empty
 * array if no thread exists yet for the triple.
 */
agreements.get(
  '/threads/:creatorId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: ownerThreadParamSchema,
      query: getNegotiationThreadQuerySchema,
    },
    handler: async (ctx) => {
      return await ctx.services.agreements.getNegotiationThread({
        organizationId: ctx.organizationId,
        creatorId: ctx.input.params.creatorId,
        revenueType: ctx.input.query.revenueType,
      });
    },
  })
);

// ─── Creator-side reads ───────────────────────────────────────────────────

/**
 * Internal type for the creator-view enriched row. The shape is
 * intentionally NOT exported from `@codex/agreements` — anonymisation is
 * a UI-visibility concern owned by this route boundary, not the service
 * layer. If a different consumer wants the unshaped data, they call
 * `service.getActiveAgreementsForCreator()` directly.
 */
interface CreatorAgreementWithPeers {
  id: string;
  organizationId: string;
  creatorId: string;
  revenueType: string;
  status: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  organizationFeePercentage: number;
  currentProposalId: string | null;
  terminatedAt: Date | null;
  /**
   * Anonymised aggregate of every OTHER active creator in the SAME
   * (orgId, revenueType) pool. Subscription peers and content_purchase
   * peers are NEVER combined — they are separate revenue pools per the
   * locked epic decision Q1 (see `project_revenue_share_decisions.md`).
   */
  peers: {
    count: number;
    /**
     * Sum of basis-point shares across peer creators in this SAME
     * (orgId, revenueType) pool, 0–10000. Used by the UI to show "your
     * share vs. the rest of the team in this pool". Per the locked epic
     * decision Q1, subscription and content_purchase are separate
     * pools — peers across pools are never aggregated together.
     *
     * Computed from `10000 - organizationFeePercentage` per row (legacy
     * column; dual-written by `acceptProposal`). When WP-4 swaps the
     * read path to `current_proposal_id.proposed_creator_share_percent`,
     * this computation should track.
     */
    aggregateSharePercent: number;
  };
}

/**
 * GET /agreements/me
 *
 * Creator-view portfolio across every org the caller has agreements
 * with. Service returns the creator's own rows (already scoped on
 * `creatorId = ctx.user.id`); this handler ENRICHES each row with an
 * anonymised aggregate of every other active creator on the same org
 * (`peers.count` + `peers.aggregateSharePercent`).
 *
 * Per-org peer queries are unavoidable today — the service intentionally
 * keeps its query surface narrow, and the orgs the caller participates
 * in are typically few (1-3 in practice). If a power user ever ends up
 * with many orgs, we can add a batched `getActiveAgreementsForOrgs`
 * service method without changing this response shape.
 *
 * NEVER include peer identifying fields (peer creatorId / userId /
 * display fields) in the response — the test suite has explicit
 * coverage of this.
 */
agreements.get(
  '/me',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      const own = await ctx.services.agreements.getActiveAgreementsForCreator({
        creatorId: ctx.user.id,
      });

      // Dedup org ids — many of the caller's rows are likely on the
      // same org (subscription + content_purchase agreements with the
      // same org) so we share one peer fetch across them.
      const uniqueOrgIds = Array.from(
        new Set(own.map((a) => a.organizationId))
      );

      // Peer aggregate keyed on `(orgId, revenueType)`. Per the locked
      // epic decision Q1 (`project_revenue_share_decisions.md`),
      // subscription and content_purchase are SEPARATE revenue pools —
      // peers must never be aggregated across pools.
      const peerByOrgAndType = new Map<
        string,
        { count: number; aggregateSharePercent: number }
      >();
      await Promise.all(
        uniqueOrgIds.map(async (orgId) => {
          const all = await ctx.services.agreements.getActiveAgreements({
            organizationId: orgId,
          });
          for (const revType of ['subscription', 'content_purchase'] as const) {
            const peersInType = all.filter(
              (row) =>
                row.revenueType === revType && row.creatorId !== ctx.user.id
            );
            // The legacy `organization_fee_percentage` column is the
            // dual-write source of truth for active rows today (per WP-1
            // discoveries). `share = 10000 - fee`.
            const aggregate = peersInType.reduce(
              (sum, p) => sum + (10000 - p.organizationFeePercentage),
              0
            );
            peerByOrgAndType.set(`${orgId}:${revType}`, {
              count: peersInType.length,
              aggregateSharePercent: aggregate,
            });
          }
        })
      );

      const enriched: CreatorAgreementWithPeers[] = own.map((row) => {
        const peers = peerByOrgAndType.get(
          `${row.organizationId}:${row.revenueType}`
        ) ?? {
          count: 0,
          aggregateSharePercent: 0,
        };
        return {
          id: row.id,
          organizationId: row.organizationId,
          creatorId: row.creatorId,
          revenueType: row.revenueType,
          status: row.status,
          effectiveFrom: row.effectiveFrom,
          effectiveUntil: row.effectiveUntil,
          organizationFeePercentage: row.organizationFeePercentage,
          currentProposalId: row.currentProposalId,
          terminatedAt: row.terminatedAt,
          peers,
        };
      });

      return new PaginatedResult(enriched, {
        page: 1,
        limit: enriched.length,
        total: enriched.length,
        totalPages: 1,
      });
    },
  })
);

/**
 * GET /agreements/me/threads/:proposalId
 *
 * Creator-view of a single negotiation thread, fetched by any proposal
 * id within the thread. The handler:
 *   1. asserts the proposal exists and that the caller is the named
 *      creator (`ForbiddenError` otherwise)
 *   2. returns the full chronological thread for the (org, creator,
 *      revenueType) triple
 *
 * Since the creator is the only non-owner party on their own thread,
 * no anonymisation is needed — the proposals show owner and creator
 * actions side by side, both of which the creator is entitled to see.
 *
 * We use a service-level "list this thread by proposal id" composition
 * because the service intentionally doesn't expose a `getProposal(id)`
 * surface; we fetch the thread by triple, then narrow to the row(s)
 * matching the proposal id to assert membership.
 */
agreements.get(
  '/me/threads/:proposalId',
  procedure({
    policy: { auth: 'required' },
    input: { params: proposalIdParamSchema },
    handler: async (ctx) => {
      // Pull the creator's own agreements first to enumerate which
      // (org, revenueType) threads they participate in, then locate the
      // requested proposal among them. This keeps the service surface
      // narrow and never reveals threads the caller isn't on.
      const own = await ctx.services.agreements.getActiveAgreementsForCreator({
        creatorId: ctx.user.id,
      });

      // Parallel fetch: each thread is one DB roundtrip; with M
      // agreements across orgs this is M parallel queries, not M
      // sequential. The DB CHECK constraint guarantees `revenueType` is
      // one of the two enum values, but we runtime-guard before the
      // narrowing cast so a future schema change surfaces loudly rather
      // than silently lying to the type system.
      const candidates = await Promise.all(
        own.map((a) => {
          if (
            a.revenueType !== 'subscription' &&
            a.revenueType !== 'content_purchase'
          ) {
            throw new Error(
              `Unexpected revenueType on agreement ${a.id}: ${a.revenueType}`
            );
          }
          return ctx.services.agreements.getNegotiationThread({
            organizationId: a.organizationId,
            creatorId: ctx.user.id,
            revenueType: a.revenueType,
          });
        })
      );

      const match = candidates.find((thread) =>
        thread.some((p) => p.id === ctx.input.params.proposalId)
      );
      if (match) {
        return match;
      }

      // Fall through: the caller has no thread containing this
      // proposal. Surface a 404 rather than a 403 so the route does NOT
      // confirm or deny existence — same hardening pattern as
      // single-row GETs across the codebase.
      throw new NotFoundError('Proposal thread not found', {
        proposalId: ctx.input.params.proposalId,
      });
    },
  })
);

export default agreements;
