/**
 * Revenue-Share Agreement Remote Functions (Codex-s80r6 — WP-7)
 *
 * Wraps the ecom-api `/agreements` routes (WP-3, see
 * `workers/ecom-api/src/routes/agreements.ts`). Owner-side bindings power
 * the studio settings → revenue-share tab; creator-side bindings power
 * the /studio/negotiations page in WP-8.
 *
 * Unit semantics for `sharePercent`: basis points (0-10000) of the
 * post-platform pool. Platform fee is NEVER part of this value — UI
 * copy must say "of post-platform [revenue_type] revenue" per the C1
 * math semantic (see `project_revenue_share_decisions.md`).
 *
 * All commands re-fetch the relevant query collection on success; the
 * settings page wires `await query.refresh()` after each command.
 */

import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─── Schemas ──────────────────────────────────────────────────────────────

const revenueTypeSchema = z.enum(['subscription', 'content_purchase']);

const listAgreementsArgsSchema = z.object({
  organizationId: z.string().uuid(),
  revenueType: revenueTypeSchema.optional(),
});

const getThreadArgsSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  revenueType: revenueTypeSchema,
});

const proposeAgreementArgsSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  revenueType: revenueTypeSchema,
  sharePercent: z.number().int().min(0).max(10000),
  termMonths: z.number().int().min(1).max(120),
  note: z.string().trim().max(500).optional(),
  effectiveFrom: z.string().datetime().optional(),
});

const counterArgsSchema = z.object({
  proposalId: z.string().uuid(),
  sharePercent: z.number().int().min(0).max(10000),
  termMonths: z.number().int().min(1).max(120),
  note: z.string().trim().max(500).optional(),
});

const proposalIdArgSchema = z.object({
  proposalId: z.string().uuid(),
});

const declineArgsSchema = z.object({
  proposalId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

const terminateArgsSchema = z.object({
  agreementId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

// ─── Queries ──────────────────────────────────────────────────────────────

/**
 * Active agreements for the org — owner-view full list.
 * Re-fetched on every mutation via `.refresh()`.
 */
export const listActiveAgreements = query(
  listAgreementsArgsSchema,
  async ({ organizationId, revenueType }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.list(
      organizationId,
      revenueType ? { revenueType } : undefined
    );
  }
);

/**
 * Negotiation thread for one (creator, revenueType) on this org.
 * Empty array if no thread exists. Used by the AgreementCard "View thread"
 * action + by direct linking from email notifications.
 */
export const getAgreementThread = query(
  getThreadArgsSchema,
  async ({ organizationId, creatorId, revenueType }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.getThread(organizationId, creatorId, revenueType);
  }
);

/**
 * Creator-view: my agreements across all orgs. Used by WP-8 (/studio/
 * negotiations). Surfaces `peers` aggregate for each row.
 */
export const listMyAgreements = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.agreements.listForCreator();
});

/**
 * Creator-view portfolio aggregator (WP-8 — Codex-bw2wf). Drives the
 * /studio/negotiations page: active + pending-action-required +
 * waiting-on-org + past in a single round-trip.
 *
 * Anonymisation contract: peer aggregates only, never identifiers. The
 * UI consumes the masked data as-is.
 */
export const getMyAgreementPortfolio = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.agreements.getCreatorPortfolio();
});

/**
 * Creator-view: full negotiation thread by ANY proposal id within the
 * thread. Used by the agreement-detail page on /studio/negotiations/[id].
 * Worker enumerates threads where the caller is the named creator,
 * including pending-only threads (round-1 owner proposals not yet
 * accepted).
 */
export const getMyAgreementThread = query(
  proposalIdArgSchema,
  async ({ proposalId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.getMyThread(proposalId);
  }
);

// ─── Commands ─────────────────────────────────────────────────────────────

/**
 * Owner round-1 propose. `organizationId` is in the query string per the
 * `procedure()` resolver contract (body org would 400 with
 * ORG_CONTEXT_REQUIRED).
 */
export const proposeAgreement = command(
  proposeAgreementArgsSchema,
  async ({ organizationId, ...input }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.propose(organizationId, input);
  }
);

/**
 * Counter-proposal — role flips on the parent. Service derives role,
 * returns the new child row.
 */
export const counterAgreement = command(
  counterArgsSchema,
  async ({ proposalId, ...input }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.counter(proposalId, input);
  }
);

/** Accept an open proposal — supersedes siblings + terminates predecessor. */
export const acceptAgreement = command(
  proposalIdArgSchema,
  async ({ proposalId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.accept(proposalId);
  }
);

/** Decline an open proposal — optional reason captured for audit. */
export const declineAgreement = command(
  declineArgsSchema,
  async ({ proposalId, reason }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.decline(proposalId, reason ? { reason } : undefined);
  }
);

/** Withdraw a proposal — only the proposing side may withdraw. */
export const withdrawAgreement = command(
  proposalIdArgSchema,
  async ({ proposalId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.withdraw(proposalId);
  }
);

/** Terminate an active agreement — either party may invoke. */
export const terminateAgreement = command(
  terminateArgsSchema,
  async ({ agreementId, reason }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.agreements.terminate(
      agreementId,
      reason ? { reason } : undefined
    );
  }
);
