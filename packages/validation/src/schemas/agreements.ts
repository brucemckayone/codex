import { z } from 'zod';
import { userIdSchema, uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * @codex/agreements — Zod schemas for WP-3 route inputs (Codex-hqke2,
 * epic Codex-nk4km).
 *
 * Single source of truth for the body / query / params shapes the
 * `workers/ecom-api/src/routes/agreements.ts` router validates. Mirrors
 * the public `AgreementService` input interfaces in
 * `packages/agreements/src/services/agreement-service.ts` so any drift
 * between the service and the API boundary surfaces at typecheck time.
 *
 * Unit semantics for `sharePercent`: basis points (0-10000) of the
 * post-platform pool, mirroring the `proposed_creator_share_percent`
 * column. Platform fee is deliberately NOT part of this value — see
 * `agreement-math.ts` file header.
 *
 * Unit semantics for `termMonths`: months. `null` is a future
 * "indefinite agreement" affordance, but we don't surface it through the
 * API yet — propose/counter routes only accept a finite positive
 * integer. If a future UI needs indefinite, accept `null` here and
 * pass-through to the service.
 *
 * Note / reason fields cap at 500 chars to match the DB columns (`note`
 * and `decline_reason` are `text` but the UI surfaces a single-line
 * input; cap defensively to keep payloads small).
 */

// ─── Shared primitives ────────────────────────────────────────────────────

/**
 * Revenue type enum — mirrors the schema CHECK constraint on
 * `agreement_proposals.revenue_type` and `creator_organization_agreements.
 * revenue_type`. A creator can hold ONE active agreement of each type per
 * org simultaneously (enforced by the partial unique index).
 */
export const agreementRevenueTypeEnum = z.enum(
  ['subscription', 'content_purchase'],
  { message: "Revenue type must be 'subscription' or 'content_purchase'" }
);

/**
 * Basis-point share — inclusive 0–10000, integer only. 0 is the legal
 * minimum (creator opts out), 10000 is the legal maximum (creator takes
 * the entire post-platform pool, org owner residual collapses to zero).
 */
const sharePercentSchema = z
  .number()
  .int({ message: 'Share percent must be an integer (basis points)' })
  .min(0, { message: 'Share percent must be at least 0 basis points' })
  .max(10000, {
    message: 'Share percent must be at most 10000 basis points',
  });

/**
 * Term length in months. 1–120 (1 month to 10 years).
 *
 * The service signature accepts `number | null` (`null` = indefinite),
 * but the API surface only exposes finite terms for now — the UI doesn't
 * have an "indefinite" affordance. Drop this restriction and pipe
 * through to the service when product needs it.
 */
const termMonthsSchema = z
  .number()
  .int({ message: 'Term must be a whole number of months' })
  .min(1, { message: 'Term must be at least 1 month' })
  .max(120, { message: 'Term must be at most 120 months (10 years)' });

const noteSchema = z
  .string()
  .trim()
  .max(500, { message: 'Note must be 500 characters or less' })
  .optional();

const reasonSchema = z
  .string()
  .trim()
  .max(500, { message: 'Reason must be 500 characters or less' })
  .optional();

// ─── Path / param schemas ─────────────────────────────────────────────────

/**
 * `:proposalId` URL parameter (proposal mutations: accept / decline /
 * counter / withdraw).
 */
export const proposalIdParamSchema = z.object({
  proposalId: uuidSchema,
});
export type ProposalIdParamInput = z.infer<typeof proposalIdParamSchema>;

/**
 * `:agreementId` URL parameter (terminate).
 */
export const agreementIdParamSchema = z.object({
  agreementId: uuidSchema,
});
export type AgreementIdParamInput = z.infer<typeof agreementIdParamSchema>;

// ─── Body schemas ─────────────────────────────────────────────────────────

/**
 * POST /agreements/propose — owner-initiated round 1 proposal.
 *
 * `organizationId` is NOT in the body — it lives in the query string
 * (see `proposeAgreementQuerySchema`). Rationale: `procedure()`'s
 * `resolveOrganizationId()` reads URL params, subdomain, or `?organizationId`
 * query — NEVER the body. And policy enforcement (Step 1) runs BEFORE
 * input validation (Step 3), so the body has not been parsed by the time
 * the org resolver needs the id. Putting orgId in the body silently
 * 400s with ORG_CONTEXT_REQUIRED on every real request.
 *
 * The service then enforces `assertActiveOwner` against the actor — the
 * route layer doesn't re-check ownership.
 */
export const proposeAgreementInputSchema = z.object({
  // BetterAuth issues text IDs (not UUIDs) for users — see
  // `packages/database/src/schema/users.ts` (`id: text('id')`). `userIdSchema`
  // accepts that 1-64-char format; using `uuidSchema` here 400-rejects every
  // real propose call. Same applies to the other user-id fields below.
  creatorId: userIdSchema,
  revenueType: agreementRevenueTypeEnum,
  sharePercent: sharePercentSchema,
  termMonths: termMonthsSchema,
  note: noteSchema,
  /**
   * Defaults to `now()` in the service when omitted. `z.coerce.date()`
   * accepts both ISO 8601 strings and JS Date instances — same shape the
   * service signature expects.
   */
  effectiveFrom: z.coerce.date().optional(),
});
export type ProposeAgreementInput = z.infer<typeof proposeAgreementInputSchema>;

/**
 * POST /agreements/propose — query string. Carries `organizationId` so
 * `procedure()`'s membership gate can resolve `ctx.organizationId` from
 * the query fallback path. See `proposeAgreementInputSchema` doc for the
 * full reason this can't live in the body.
 */
export const proposeAgreementQuerySchema = z.object({
  organizationId: uuidSchema,
});
export type ProposeAgreementQueryInput = z.infer<
  typeof proposeAgreementQuerySchema
>;

/**
 * POST /agreements/:proposalId/counter — alternates roles round-by-round.
 *
 * The proposal id is in the URL params; this body covers the new round's
 * terms. The service derives the counterparty role from the parent
 * proposal's `proposedByRole`, so the route does not need to thread the
 * actor role explicitly.
 */
export const counterProposeInputSchema = z.object({
  sharePercent: sharePercentSchema,
  termMonths: termMonthsSchema,
  note: noteSchema,
});
export type CounterProposeInput = z.infer<typeof counterProposeInputSchema>;

/**
 * POST /agreements/:proposalId/accept — body is empty for now (single
 * action, no parameters). Modelled as a schema so the procedure pipeline
 * still runs body validation — future extension (e.g. capture an
 * acceptance note) lands as additional optional fields without changing
 * the route signature.
 */
export const acceptProposalInputSchema = z.object({});
export type AcceptProposalInput = z.infer<typeof acceptProposalInputSchema>;

/**
 * POST /agreements/:proposalId/decline — optional reason.
 */
export const declineProposalInputSchema = z.object({
  reason: reasonSchema,
});
export type DeclineProposalInput = z.infer<typeof declineProposalInputSchema>;

/**
 * POST /agreements/:proposalId/withdraw — no body fields today.
 */
export const withdrawProposalInputSchema = z.object({});
export type WithdrawProposalInput = z.infer<typeof withdrawProposalInputSchema>;

/**
 * POST /agreements/:agreementId/terminate — optional reason.
 */
export const terminateAgreementInputSchema = z.object({
  reason: reasonSchema,
});
export type TerminateAgreementInput = z.infer<
  typeof terminateAgreementInputSchema
>;

// ─── Query schemas ────────────────────────────────────────────────────────

/**
 * GET /agreements?... — list filter for the owner-view endpoint. The
 * `organizationId` field is consumed by `procedure()`'s membership gate
 * to resolve `ctx.organizationId`; the service receives the
 * authenticated `ctx.organizationId` and ignores the query value
 * thereafter (same hardening pattern as `/sales`, see
 * `feedback_secure_route_org_resolution`).
 *
 * `creatorId` is reserved for a future cross-org owner view of one
 * specific creator's agreements; today the service doesn't filter on it
 * because owner-view is always "every active agreement on MY org".
 */
export const listAgreementsQuerySchema = paginationSchema.extend({
  organizationId: uuidSchema.optional(),
  creatorId: userIdSchema.optional(),
  revenueType: agreementRevenueTypeEnum.optional(),
});
export type ListAgreementsQueryInput = z.infer<
  typeof listAgreementsQuerySchema
>;

/**
 * GET /agreements/:orgSlug/:creatorId/thread?revenueType=...
 *
 * Used by the owner-view negotiation thread page. `revenueType` is the
 * dimension that disambiguates the thread (one creator can have a
 * subscription thread + a content_purchase thread independently).
 */
export const getNegotiationThreadQuerySchema = z.object({
  revenueType: agreementRevenueTypeEnum,
});
export type GetNegotiationThreadQueryInput = z.infer<
  typeof getNegotiationThreadQuerySchema
>;

/**
 * GET /agreements/threads/:creatorId — owner-view thread params.
 */
export const ownerThreadParamSchema = z.object({
  creatorId: userIdSchema,
});
export type OwnerThreadParamInput = z.infer<typeof ownerThreadParamSchema>;

/**
 * GET /agreements/pending — owner-view open-proposal feed (WP-9 — Codex-k9no0).
 *
 * Powers the FocusRail "counter-proposal received" signal on the owner
 * studio dashboard. `proposedByRole='creator'` returns ONLY the open
 * proposals where the creator countered (or initiated, in a future
 * reverse-proposal world) — i.e. proposals waiting on owner action.
 *
 * `organizationId` is in the query string per the org-resolution
 * contract (see `feedback_secure_route_org_resolution`); the service
 * receives `ctx.organizationId` and ignores the body value.
 */
export const listPendingProposalsQuerySchema = z.object({
  organizationId: uuidSchema.optional(),
  proposedByRole: z.enum(['owner', 'creator']).optional(),
});
export type ListPendingProposalsQueryInput = z.infer<
  typeof listPendingProposalsQuerySchema
>;
