/**
 * @codex/agreements — AgreementService
 *
 * State machine for revenue-share negotiations + lifecycle of the
 * resulting `creator_organization_agreements` rows. Drives the schema
 * landed in WP-1 (PR #207) and feeds the payout pipeline WP-4 will
 * rewire.
 *
 * Reference reading before editing:
 *   - `packages/database/src/schema/ecommerce.ts` (agreementProposals,
 *     creatorOrganizationAgreements, *Relations)
 *   - `~/.claude/projects/.../memory/project_revenue_share_wp1_discoveries.md`
 *     (three load-bearing constraints below — owner-resolution via
 *     memberships, dual-write legacy fee column, Drizzle relationName).
 *   - `~/.claude/projects/.../memory/project_revenue_share_decisions.md`
 *     (creator share snapshotted; platform fee read fresh in the payout
 *     pipeline — but NOT in share-validation, see `agreement-math.ts`).
 *
 * Every multi-step write goes through `this.db.transaction()` so the
 * database is never left in a half-applied state — agreement acceptance
 * in particular touches three tables (proposal, prior active agreement,
 * new active agreement) plus marks siblings superseded.
 *
 * Concurrency:
 * - counter, accept, decline and withdraw lock their proposal row, and
 *   terminate its agreement row (`SELECT … FOR UPDATE`), before the status
 *   check, so two callers cannot both see `status='open'` and both proceed.
 * - propose, counter and accept also take one transaction-scoped advisory
 *   lock per organisation and revenue type (`lockAgreementShares`) before
 *   the open-thread check and the sum-of-shares read (Codex-2hxff.19 AGR-04,
 *   AGR-13). A new proposal has no row to lock, and two accepts for
 *   different creators lock different proposals, so without it two proposes
 *   could both open a thread and two accepts could take the pool past 100%.
 *   It comes after the proposal row and the membership, keeping the lock
 *   order in packages/organization/CLAUDE.md (Codex-kk9nv.8).
 *
 * Shares are read from the accepted proposal through `current_proposal_id`,
 * never from the legacy `organization_fee_percentage` (Codex-2hxff.19
 * AGR-08), which acceptance still writes.
 */

import { whereNotDeleted } from '@codex/database';
import {
  agreementProposals,
  creatorOrganizationAgreements,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import {
  BaseService,
  ForbiddenError,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { EnvName } from '@codex/urls';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  AgreementNotFoundError,
  FutureStartNotAllowedError,
  InvalidProposalStateError,
} from '../errors';
import type {
  AgreementProposal,
  CreatorOrganizationAgreement,
  RevenueType,
} from '../types';
import {
  type AgreementEmailRecipient,
  buildAgreementEmailLink,
  isEnvName,
} from './agreement-links';
import {
  formatRevenueTypeLabel,
  legacyOrgFeeFromCreatorShare,
  validateProposedShare,
} from './agreement-math';
import type { ResolverLogger } from './agreement-resolver';

// ─── Public input shapes ──────────────────────────────────────────────────

export interface ProposeAgreementInput {
  organizationId: string;
  creatorId: string;
  revenueType: RevenueType;
  /** Basis points 0–10000. */
  sharePercent: number;
  /** Soft-lock review window in months. `null` = indefinite. */
  termMonths: number | null;
  note?: string | null;
  /** User initiating the propose; must be an active owner of the org. */
  proposedByUserId: string;
  /** Defaults to `new Date()` if omitted. */
  effectiveFrom?: Date;
}

export interface CounterProposeInput {
  /** The proposal being countered. Must currently be `status='open'`. */
  proposalId: string;
  sharePercent: number;
  termMonths: number | null;
  note?: string | null;
  /** Must be the counterparty of the proposal being countered. */
  counteredByUserId: string;
}

export interface AcceptProposalInput {
  proposalId: string;
  /** Must be the counterparty of the proposal being accepted. */
  acceptedByUserId: string;
}

export interface DeclineProposalInput {
  proposalId: string;
  /** Must be the counterparty of the proposal being declined. */
  declinedByUserId: string;
  reason?: string | null;
}

export interface WithdrawProposalInput {
  proposalId: string;
  /** Must be the *proposing* party. */
  withdrawnByUserId: string;
}

export interface TerminateAgreementInput {
  agreementId: string;
  /** Must be the org owner or the creator named on the agreement. */
  terminatedByUserId: string;
  reason?: string | null;
}

// ─── Service config ───────────────────────────────────────────────────────

/**
 * Template names fired by AgreementService lifecycle methods (WP-5 —
 * Codex-90de9). String literals so the service stays decoupled from
 * `@codex/notifications` — the registry wires a `mailer` thunk that
 * understands the worker-to-worker transport, and the service just
 * names the template.
 */
export type AgreementTemplateName =
  | 'agreement-proposed-by-owner'
  | 'agreement-countered-by-creator'
  | 'agreement-countered-by-owner'
  | 'agreement-accepted'
  | 'agreement-declined'
  | 'agreement-terminated'
  | 'agreement-expiring-soon';

/**
 * Fire-and-forget mailer thunk used by the lifecycle hooks. Matches the
 * shape of `SendEmailToWorkerParams` from `@codex/worker-utils` so the
 * registry can wire `sendEmailToWorker(env, ctx, params)` directly.
 *
 * Returns `void` — failures are the mailer's concern. The service has
 * a try/catch around every call site so a thrown error never bubbles
 * up and rolls back the agreement transaction (which has already
 * committed by the time the mailer fires — agreement is source of
 * truth, notification is observation).
 */
export type AgreementLifecycleMailer = (params: {
  to: string;
  toName?: string;
  templateName: AgreementTemplateName;
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

/**
 * `ExecutionContext.waitUntil`-shaped hook. Inlined here (instead of
 * importing from `@codex/cache`) to keep the service's dep surface
 * minimal — same shape used across the registry's other services.
 */
export type AgreementWaitUntilFn = (promise: Promise<unknown>) => void;

/**
 * Constructor config. As of the PR #210 review, the service no longer
 * threads `FeeConfigService` through share validation — `agreement-math`
 * reasons purely about the post-platform pool. Platform fee is still
 * read fresh in the WP-4 payout pipeline; if a future feature needs it
 * inside this service (e.g. a /preview endpoint that breaks down org
 * residual after platform fee), re-add the dep at that point.
 *
 * WP-5 (Codex-90de9) adds an optional `mailer` thunk used by the
 * lifecycle hooks to fire notifications after a successful mutation.
 * When absent (narrow unit tests, legacy harnesses), all mutations
 * still succeed — only the email side-effect is skipped.
 *
 * The email links are built from `environment`, which must therefore be an
 * env name `@codex/urls` can route (`production`, `staging`, `dev`,
 * `development`, `test`); the constructor throws otherwise, so a
 * misconfigured worker fails at wiring, not at the first notification. It
 * replaced a mandatory `webAppUrl` (Codex-2hxff.20 AGR-10): that apex host
 * has no Studio, so every link built on it was dead.
 *
 * `waitUntil` (per Codex-0omga) is the optional `ExecutionContext.waitUntil`
 * hook used to push the entire lifecycle dispatch (user / org lookups +
 * mailer fire) off the request critical path. When omitted (narrow unit
 * tests, legacy harnesses) the dispatch runs inline AFTER the agreement
 * transaction commits, which is still correct — just slightly slower
 * for the request response.
 */
export interface AgreementServiceConfig extends ServiceConfig {
  mailer?: AgreementLifecycleMailer;
  /**
   * Optional `ExecutionContext.waitUntil` (or equivalent). Production
   * code threads the worker `ExecutionContext.waitUntil` through here so
   * the lookup-and-dispatch phase of lifecycle notifications doesn't
   * block the API response.
   */
  waitUntil?: AgreementWaitUntilFn;
}

/**
 * An agreement row with the creator's share of the post-platform pool in
 * basis points, read from its accepted proposal through `current_proposal_id`
 * (Codex-2hxff.19 AGR-08). `null` when the proposal link is gone: the
 * resolver pays such an agreement nothing, and the read that returned it has
 * logged it (`reportMissingProposal`). The legacy
 * `organization_fee_percentage` stays on the row for the web pages that
 * still rebuild the share from it.
 */
export type AgreementWithShare = CreatorOrganizationAgreement & {
  creatorSharePercent: number | null;
};

/** The relational `with` that brings an agreement's share along. */
const WITH_CURRENT_SHARE = {
  currentProposal: { columns: { proposedCreatorSharePercent: true } },
} as const;

/**
 * An agreement with no accepted proposal linked has no share, and the
 * resolver pays it nothing. Every service path that meets one reports it
 * here, at error with an errorId and the agreement's id, so it can be
 * repaired: the lists (`withShare`), the review-reminder scan, the 100%
 * check and the termination email.
 */
function reportMissingProposal(
  obs: ResolverLogger,
  context: { agreementId: string; organizationId: string } & Record<
    string,
    unknown
  >
): void {
  obs.error('agreement has no current proposal; it pays nothing', {
    errorId: crypto.randomUUID(),
    ...context,
  });
}

function withShare(
  {
    currentProposal,
    ...agreement
  }: CreatorOrganizationAgreement & {
    currentProposal: { proposedCreatorSharePercent: number } | null;
  },
  obs: ResolverLogger
): AgreementWithShare {
  if (!currentProposal) {
    reportMissingProposal(obs, {
      agreementId: agreement.id,
      organizationId: agreement.organizationId,
    });
  }
  return {
    ...agreement,
    creatorSharePercent: currentProposal?.proposedCreatorSharePercent ?? null,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────

/**
 * Transaction handle type — the parameter the callback receives from
 * `db.transaction()`. Extracted once here so the helper signatures don't
 * each repeat the nested `Parameters<Parameters<...>[0]>[0]` chain.
 */
type Tx = Parameters<Parameters<AgreementService['db']['transaction']>[0]>[0];

/** One lifecycle email, as a mutation hands it to the dispatcher. */
interface LifecycleEmailParams {
  recipientUserId: string;
  /** Which side the recipient is on: it picks the page their link opens. */
  recipientSide: 'owner' | 'creator';
  organizationId: string;
  templateName: AgreementTemplateName;
  extraContext: Record<string, string>;
  /**
   * A proposal id in the thread, for the creator's link. `null` sends the
   * creator to their negotiations list. The owner's link never uses it.
   */
  threadId: string | null;
  /** `null` when there is nobody to name: the email says "The other party". */
  counterpartyUserId: string | null;
  revenueType: RevenueType;
  sharePercent: number;
  termMonths: number | null;
  note?: string | null;
}

export class AgreementService extends BaseService {
  private readonly mailer: AgreementLifecycleMailer | undefined;
  private readonly envName: EnvName;
  private readonly waitUntil: AgreementWaitUntilFn | undefined;

  constructor(config: AgreementServiceConfig) {
    super(config);
    if (!isEnvName(config.environment)) {
      // Fail fast: every email link is built from the env name, and an
      // unknown one has no host to send a recipient to.
      throw new InternalServiceError(
        'AgreementService requires a known `environment` to build email links'
      );
    }
    this.mailer = config.mailer;
    this.envName = config.environment;
    this.waitUntil = config.waitUntil;
  }

  // ── Public: propose ─────────────────────────────────────────────────────

  /**
   * Owner-initiated initial proposal (round 1). Per the plan, only the
   * organization owner can open a negotiation. Subsequent rounds are
   * created via `counterPropose`.
   *
   * Validates:
   *   1. proposer is an active owner of the org
   *   2. creator is an active member of the org (any role; org may have
   *      promoted a member to "creator" or kept them as "member" — we
   *      gate on membership, not on role, to allow paying any team
   *      member out of pooled revenue)
   *   3. no other proposal in this (org, creator, revenue_type) thread
   *      is currently `open` or `countered` (one negotiation at a time
   *      per bucket — keeps the UI sane)
   *   4. proposed share + active sibling shares ≤ 100% of the
   *      post-platform pool (see `agreement-math.ts` header for the
   *      unit semantics)
   */
  async proposeAgreement(
    input: ProposeAgreementInput
  ): Promise<AgreementProposal> {
    try {
      assertNotFutureStart(input.effectiveFrom, new Date());
      const proposal = await this.db.transaction(async (tx) => {
        await this.assertActiveOwner(
          tx,
          input.organizationId,
          input.proposedByUserId
        );
        await this.assertActiveMember(
          tx,
          input.organizationId,
          input.creatorId
        );
        // Before the open-thread check: there is no row to lock yet, so two
        // proposes for one creator would otherwise both open a thread.
        await this.lockAgreementShares(
          tx,
          input.organizationId,
          input.revenueType
        );
        await this.assertNoOpenThread(
          tx,
          input.organizationId,
          input.creatorId,
          input.revenueType
        );

        // Existing active shares ELSEWHERE in the org for this revenue
        // type — these reduce the headroom. We deliberately exclude
        // (org, creator, revenue_type) because no active agreement
        // for that triple can exist (partial unique index) and the
        // payout splitter sums per-creator, not per-row.
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          input.organizationId,
          input.revenueType,
          { excludeCreatorId: input.creatorId }
        );

        validateProposedShare({
          proposedSharePercent: input.sharePercent,
          existingActiveShares,
        });

        const [row] = await tx
          .insert(agreementProposals)
          .values({
            organizationId: input.organizationId,
            creatorId: input.creatorId,
            revenueType: input.revenueType,
            parentProposalId: null,
            roundNumber: 1,
            proposedByUserId: input.proposedByUserId,
            proposedByRole: 'owner',
            proposedCreatorSharePercent: input.sharePercent,
            proposedTermMonths: input.termMonths,
            proposedEffectiveFrom: input.effectiveFrom ?? new Date(),
            note: input.note ?? null,
            status: 'open',
          })
          .returning();

        if (!row) {
          throw new InternalServiceError('Failed to insert agreement proposal');
        }
        return row;
      });

      // WP-5: notify the recipient AFTER the transaction commits. The
      // owner is the initiator, so the creator is the recipient.
      // Failures are caught + logged inside the dispatcher — never roll
      // back the (already committed) agreement state.
      await this.dispatchLifecycleEmail({
        recipientUserId: proposal.creatorId,
        recipientSide: 'creator',
        organizationId: proposal.organizationId,
        templateName: 'agreement-proposed-by-owner',
        extraContext: {},
        threadId: proposal.id,
        counterpartyUserId: proposal.proposedByUserId,
        revenueType: proposal.revenueType as RevenueType,
        sharePercent: proposal.proposedCreatorSharePercent,
        termMonths: proposal.proposedTermMonths,
        note: proposal.note,
      });

      return proposal;
    } catch (error) {
      this.handleError(error, 'proposeAgreement');
    }
  }

  // ── Public: counter ─────────────────────────────────────────────────────

  /**
   * Counter-proposal — same negotiation thread, next round, flipped role.
   *
   * The parent proposal must currently be `status='open'`. The actor must
   * be the *counterparty* — if the parent was proposed by an owner, the
   * actor must be the creator named on the proposal (and vice versa for
   * owner-counters-creator). The parent transitions to `'countered'` in
   * the same transaction so the read-side never observes two `open`
   * rows in a thread.
   */
  async counterPropose(input: CounterProposeInput): Promise<AgreementProposal> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const parent = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (parent.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be countered',
            {
              proposalId: parent.id,
              currentStatus: parent.status,
              attemptedAction: 'counter',
            }
          );
        }

        // Neither side can keep negotiating once the creator has left
        // the organisation (AGR-09).
        await this.assertActiveMember(
          tx,
          parent.organizationId,
          parent.creatorId
        );

        // Counter-party check. If the parent was owner-proposed, only
        // the named creator may counter. If creator-proposed, only an
        // active owner of the org may counter.
        const counteringRole: 'owner' | 'creator' =
          parent.proposedByRole === 'owner' ? 'creator' : 'owner';

        if (counteringRole === 'creator') {
          if (parent.creatorId !== input.counteredByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may counter this proposal',
              { proposalId: parent.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            parent.organizationId,
            input.counteredByUserId
          );
        }

        // Re-check share against current world. The counter may land
        // months after the parent — sibling agreements may have shifted.
        await this.lockAgreementShares(
          tx,
          parent.organizationId,
          parent.revenueType as RevenueType
        );
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          parent.organizationId,
          parent.revenueType as RevenueType,
          { excludeCreatorId: parent.creatorId }
        );
        validateProposedShare({
          proposedSharePercent: input.sharePercent,
          existingActiveShares,
        });

        // Parent → countered. responded_* captures who closed the parent
        // row out, separate from who created the new child row.
        await tx
          .update(agreementProposals)
          .set({
            status: 'countered',
            respondedAt: new Date(),
            respondedByUserId: input.counteredByUserId,
            updatedAt: new Date(),
          })
          .where(eq(agreementProposals.id, parent.id));

        const [child] = await tx
          .insert(agreementProposals)
          .values({
            organizationId: parent.organizationId,
            creatorId: parent.creatorId,
            revenueType: parent.revenueType,
            parentProposalId: parent.id,
            roundNumber: parent.roundNumber + 1,
            proposedByUserId: input.counteredByUserId,
            proposedByRole: counteringRole,
            proposedCreatorSharePercent: input.sharePercent,
            proposedTermMonths: input.termMonths,
            // Counter-proposals inherit the parent's effective_from —
            // the negotiation is about the same contract window, not a
            // new start date.
            proposedEffectiveFrom: parent.proposedEffectiveFrom,
            note: input.note ?? null,
            status: 'open',
          })
          .returning();

        if (!child) {
          throw new InternalServiceError('Failed to insert counter proposal');
        }
        // Surface both the new child row AND the parent's
        // `proposedByUserId` so the post-commit dispatcher can address
        // the email correctly. For a creator-counter the parent's
        // proposer was the owner (recipient of this counter); for an
        // owner-counter the parent's proposer was the creator (now the
        // OG creator who must learn the owner re-countered).
        return { child, counteringRole, parent };
      });

      // WP-5: notify the counterparty AFTER the transaction commits.
      // Recipient mapping:
      //   - creator counters → owner receives 'agreement-countered-by-creator'
      //     (the owner who originally proposed; we use the parent's
      //     proposedByUserId because that's the deterministic OG-owner
      //     identity on this thread, even if the org has multiple owners)
      //   - owner counters   → creator receives 'agreement-countered-by-owner'
      //     (always parent.creatorId — the named creator on the thread)
      const isCreatorCounter = result.counteringRole === 'creator';
      const recipientUserId = isCreatorCounter
        ? result.parent.proposedByUserId
        : result.child.creatorId;
      await this.dispatchLifecycleEmail({
        recipientUserId,
        recipientSide: isCreatorCounter ? 'owner' : 'creator',
        organizationId: result.child.organizationId,
        templateName: isCreatorCounter
          ? 'agreement-countered-by-creator'
          : 'agreement-countered-by-owner',
        extraContext: {},
        threadId: result.child.id,
        counterpartyUserId: input.counteredByUserId,
        revenueType: result.child.revenueType as RevenueType,
        sharePercent: result.child.proposedCreatorSharePercent,
        termMonths: result.child.proposedTermMonths,
        note: result.child.note,
      });

      return result.child;
    } catch (error) {
      this.handleError(error, 'counterPropose');
    }
  }

  // ── Public: accept ──────────────────────────────────────────────────────

  /**
   * Accept an open proposal. Atomically:
   *   1. validates the actor is the counterparty
   *   2. re-validates the share against the current world
   *   3. marks the accepted proposal `status='accepted'`
   *   4. marks any sibling `open|countered` proposals in the thread
   *      `status='superseded'` (defence in depth — the partial unique
   *      index alone would not catch a stranded open row in the same
   *      thread because that index is on the AGREEMENT table, not the
   *      proposal table)
   *   5. marks any prior `active` agreement for the triple
   *      `status='terminated'` (auto-terminate the predecessor; the
   *      partial unique index enforces this anyway, but explicit
   *      gives a clean audit trail with `terminationReason` set)
   *   6. inserts the new `creator_organization_agreements` row with
   *      `status='active'`, links it back via `current_proposal_id`,
   *      and dual-writes the legacy `organization_fee_percentage`
   *      column per WP-1 discovery.
   */
  async acceptProposal(
    input: AcceptProposalInput
  ): Promise<CreatorOrganizationAgreement> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be accepted',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'accept',
            }
          );
        }

        // A removed creator's proposals are withdrawn on removal; this
        // also closes the race with a removal in flight (AGR-09).
        await this.assertActiveMember(
          tx,
          proposal.organizationId,
          proposal.creatorId
        );

        // Counter-party authorisation: the side that did NOT propose
        // is the one allowed to accept. Defensive: if a future bug ever
        // creates a proposal whose `proposed_by_user_id` equals the
        // creator slot AND `proposed_by_role='owner'`, this check still
        // does the right thing because we look at the role, not the
        // user-id.
        if (proposal.proposedByRole === 'owner') {
          if (proposal.creatorId !== input.acceptedByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may accept this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.acceptedByUserId
          );
        }

        // Re-validate share at accept time — siblings may have moved. Under
        // the pool's lock: two accepts for different creators lock different
        // proposals, and would otherwise both pass the sum.
        await this.lockAgreementShares(
          tx,
          proposal.organizationId,
          proposal.revenueType as RevenueType
        );
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          proposal.organizationId,
          proposal.revenueType as RevenueType,
          { excludeCreatorId: proposal.creatorId }
        );
        validateProposedShare({
          proposedSharePercent: proposal.proposedCreatorSharePercent,
          existingActiveShares,
        });

        const now = new Date();
        // A proposal made before the rule may still start in the future
        // (Codex-2hxff.63): step (5) would end the current agreement now.
        assertNotFutureStart(proposal.proposedEffectiveFrom, now);

        // (3) Mark the proposal accepted.
        await tx
          .update(agreementProposals)
          .set({
            status: 'accepted',
            respondedAt: now,
            respondedByUserId: input.acceptedByUserId,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id));

        // (4) Supersede sibling open/countered proposals in the thread.
        await tx
          .update(agreementProposals)
          .set({ status: 'superseded', updatedAt: now })
          .where(
            and(
              eq(agreementProposals.organizationId, proposal.organizationId),
              eq(agreementProposals.creatorId, proposal.creatorId),
              eq(agreementProposals.revenueType, proposal.revenueType),
              ne(agreementProposals.id, proposal.id),
              inArray(agreementProposals.status, ['open', 'countered'])
            )
          );

        // (5) Terminate the predecessor active agreement, if any.
        await tx
          .update(creatorOrganizationAgreements)
          .set({
            status: 'terminated',
            terminatedAt: now,
            terminatedByUserId: input.acceptedByUserId,
            terminationReason: 'Superseded by accepted proposal',
            updatedAt: now,
          })
          .where(
            and(
              eq(
                creatorOrganizationAgreements.organizationId,
                proposal.organizationId
              ),
              eq(creatorOrganizationAgreements.creatorId, proposal.creatorId),
              eq(
                creatorOrganizationAgreements.revenueType,
                proposal.revenueType
              ),
              eq(creatorOrganizationAgreements.status, 'active')
            )
          );

        // (6) Insert the new active agreement.
        // Dual-write (WP-1 discovery): the legacy
        // `organization_fee_percentage` column is NOT NULL, and web pages
        // still rebuild the share from it, so it is written as
        // `10000 - share` (`legacyOrgFeeFromCreatorShare()`). Every server
        // read takes the share from the proposal (Codex-2hxff.19 AGR-08).
        const [agreement] = await tx
          .insert(creatorOrganizationAgreements)
          .values({
            creatorId: proposal.creatorId,
            organizationId: proposal.organizationId,
            organizationFeePercentage: legacyOrgFeeFromCreatorShare(
              proposal.proposedCreatorSharePercent
            ),
            revenueType: proposal.revenueType,
            status: 'active',
            currentProposalId: proposal.id,
            effectiveFrom: proposal.proposedEffectiveFrom,
            effectiveUntil: this.computeEffectiveUntil(
              proposal.proposedEffectiveFrom,
              proposal.proposedTermMonths
            ),
          })
          .returning();

        if (!agreement) {
          throw new InternalServiceError(
            'Failed to insert creator organization agreement'
          );
        }
        // Surface both the new active agreement row AND the original
        // proposal so the post-commit dispatcher can read the snapshotted
        // share + the proposer identity. The proposal's
        // `proposedByUserId` is the deterministic owner identity for
        // owner-initiated threads (creator-initiated proposals are not
        // currently supported but the dispatcher honours
        // `proposedByRole` to address the email correctly if/when they
        // are).
        return { agreement, proposal };
      });

      // WP-5: both parties receive 'agreement-accepted'. The recipient
      // pair depends on who initiated the thread:
      //   - owner-initiated thread → owner = proposal.proposedByUserId,
      //     creator = proposal.creatorId
      //   - creator-initiated thread → owner = whoever accepted (input.acceptedByUserId,
      //     since only an active org owner could have accepted a
      //     creator-proposed counter), creator = proposal.proposedByUserId
      const ownerSideUserId =
        result.proposal.proposedByRole === 'owner'
          ? result.proposal.proposedByUserId
          : input.acceptedByUserId;
      const creatorSideUserId = result.proposal.creatorId;
      const effectiveFromDate = this.formatDate(result.agreement.effectiveFrom);
      const sharePercent = result.proposal.proposedCreatorSharePercent;
      const termMonths = result.proposal.proposedTermMonths;
      const note = result.proposal.note;
      // Notify both parties in parallel — failures inside the
      // dispatcher are caught individually so one slow lookup or one
      // missing user row doesn't poison the other branch.
      await Promise.all([
        this.dispatchLifecycleEmail({
          recipientUserId: creatorSideUserId,
          recipientSide: 'creator',
          organizationId: result.agreement.organizationId,
          templateName: 'agreement-accepted',
          extraContext: { effectiveFromDate },
          threadId: result.proposal.id,
          counterpartyUserId: ownerSideUserId,
          revenueType: result.agreement.revenueType as RevenueType,
          sharePercent,
          termMonths,
          note,
        }),
        this.dispatchLifecycleEmail({
          recipientUserId: ownerSideUserId,
          recipientSide: 'owner',
          organizationId: result.agreement.organizationId,
          templateName: 'agreement-accepted',
          extraContext: { effectiveFromDate },
          threadId: result.proposal.id,
          counterpartyUserId: creatorSideUserId,
          revenueType: result.agreement.revenueType as RevenueType,
          sharePercent,
          termMonths,
          note,
        }),
      ]);

      return result.agreement;
    } catch (error) {
      this.handleError(error, 'acceptProposal');
    }
  }

  // ── Public: decline ─────────────────────────────────────────────────────

  async declineProposal(
    input: DeclineProposalInput
  ): Promise<AgreementProposal> {
    try {
      const declined = await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be declined',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'decline',
            }
          );
        }

        if (proposal.proposedByRole === 'owner') {
          if (proposal.creatorId !== input.declinedByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may decline this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.declinedByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(agreementProposals)
          .set({
            status: 'declined',
            respondedAt: now,
            respondedByUserId: input.declinedByUserId,
            declineReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update proposal to declined'
          );
        }
        return updated;
      });

      // WP-5: both parties receive 'agreement-declined'. Owner/creator
      // mapping mirrors acceptProposal — for owner-initiated threads
      // the owner is `proposedByUserId`; for creator-initiated threads
      // the owner is the actor who declined (input.declinedByUserId).
      const ownerSideUserId =
        declined.proposedByRole === 'owner'
          ? declined.proposedByUserId
          : input.declinedByUserId;
      const creatorSideUserId = declined.creatorId;
      const declineReason = input.reason ?? '';
      const sharePercent = declined.proposedCreatorSharePercent;
      const termMonths = declined.proposedTermMonths;
      await Promise.all([
        this.dispatchLifecycleEmail({
          recipientUserId: creatorSideUserId,
          recipientSide: 'creator',
          organizationId: declined.organizationId,
          templateName: 'agreement-declined',
          extraContext: { declineReason },
          // The creator's negotiations list, not the thread: the creator
          // thread route finds a thread only through an open, countered or
          // accepted proposal, so a round-1 decline has none and its link
          // would 404. The list shows it under "Past" (Codex-2hxff.20 AGR-10).
          threadId: null,
          counterpartyUserId: ownerSideUserId,
          revenueType: declined.revenueType as RevenueType,
          sharePercent,
          termMonths,
          note: declined.note,
        }),
        this.dispatchLifecycleEmail({
          recipientUserId: ownerSideUserId,
          recipientSide: 'owner',
          organizationId: declined.organizationId,
          templateName: 'agreement-declined',
          extraContext: { declineReason },
          threadId: declined.id,
          counterpartyUserId: creatorSideUserId,
          revenueType: declined.revenueType as RevenueType,
          sharePercent,
          termMonths,
          note: declined.note,
        }),
      ]);

      return declined;
    } catch (error) {
      this.handleError(error, 'declineProposal');
    }
  }

  // ── Public: withdraw ────────────────────────────────────────────────────

  async withdrawProposal(
    input: WithdrawProposalInput
  ): Promise<AgreementProposal> {
    try {
      return await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be withdrawn',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'withdraw',
            }
          );
        }

        // Withdraw is "the side that PROPOSED rescinds the offer". For
        // owner-proposed rows, the actor must be an active owner of the
        // org (allows co-owners to clean up after each other). For
        // creator-proposed counters, the actor must be the named
        // creator.
        if (proposal.proposedByRole === 'creator') {
          if (proposal.creatorId !== input.withdrawnByUserId) {
            throw new ForbiddenError(
              'Only the proposing creator may withdraw this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.withdrawnByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(agreementProposals)
          .set({
            status: 'withdrawn',
            respondedAt: now,
            respondedByUserId: input.withdrawnByUserId,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update proposal to withdrawn'
          );
        }
        return updated;
      });
    } catch (error) {
      this.handleError(error, 'withdrawProposal');
    }
  }

  // ── Public: terminate active agreement ──────────────────────────────────

  async terminateAgreement(
    input: TerminateAgreementInput
  ): Promise<CreatorOrganizationAgreement> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const agreement = await this.findAgreementForUpdateOrThrow(
          tx,
          input.agreementId
        );

        if (agreement.status !== 'active') {
          throw new InvalidProposalStateError(
            'Only active agreements can be terminated',
            {
              agreementId: agreement.id,
              currentStatus: agreement.status,
              attemptedAction: 'terminate',
            }
          );
        }

        // Either party may terminate — the creator named on the row, or
        // any active owner of the org. We check creator first because
        // it's a single equality compare; the membership lookup falls
        // through only when needed.
        if (agreement.creatorId !== input.terminatedByUserId) {
          await this.assertActiveOwner(
            tx,
            agreement.organizationId,
            input.terminatedByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(creatorOrganizationAgreements)
          .set({
            status: 'terminated',
            terminatedAt: now,
            terminatedByUserId: input.terminatedByUserId,
            terminationReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(creatorOrganizationAgreements.id, agreement.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update agreement to terminated'
          );
        }
        // The notice quotes the share the agreement paid: its proposal's.
        // Without one it paid nothing (the resolver skips it), so 0.
        const share = await this.currentShare(tx, updated);
        return { terminated: updated, sharePercent: share ?? 0 };
      });
      const { terminated, sharePercent } = result;

      // WP-5: notify the OTHER party (not the terminator). When the
      // creator terminated, the recipient is the first active org owner;
      // when an owner terminated, the recipient is the named creator.
      const terminatorIsCreator =
        terminated.creatorId === input.terminatedByUserId;
      let recipientUserId: string;
      if (terminatorIsCreator) {
        // Pick any active owner of the org to receive the notice.
        // Multi-owner orgs only need one notification — the org's
        // shared studio inbox surfaces it for all owners. Choosing the
        // first by membership creation order keeps this deterministic
        // for tests; the schema doesn't guarantee uniqueness of owner
        // rows but in practice there's a small bounded set.
        const [ownerRow] = await this.db
          .select({ userId: organizationMemberships.userId })
          .from(organizationMemberships)
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                terminated.organizationId
              ),
              eq(organizationMemberships.role, 'owner'),
              eq(organizationMemberships.status, 'active')
            )
          )
          .limit(1);
        if (!ownerRow) {
          // Orphaned org — no active owner to notify. Log + skip; the
          // agreement is still validly terminated.
          this.obs.warn(
            'agreement termination notice skipped: no active owner for org',
            { organizationId: terminated.organizationId }
          );
          return terminated;
        }
        recipientUserId = ownerRow.userId;
      } else {
        recipientUserId = terminated.creatorId;
      }

      await this.dispatchLifecycleEmail({
        recipientUserId,
        recipientSide: terminatorIsCreator ? 'owner' : 'creator',
        organizationId: terminated.organizationId,
        templateName: 'agreement-terminated',
        extraContext: {
          terminationReason: input.reason ?? '',
          effectiveTerminationDate: this.formatDate(
            terminated.terminatedAt ?? new Date()
          ),
        },
        // The thread's id is a PROPOSAL id: the creator page reads one, and
        // the agreement's own id there was a 404 (Codex-2hxff.20 AGR-10).
        threadId: terminated.currentProposalId,
        counterpartyUserId: input.terminatedByUserId,
        revenueType: terminated.revenueType as RevenueType,
        // From the accepted proposal, not the legacy org-fee column
        // (Codex-2hxff.19 AGR-08).
        sharePercent,
        // Termination notice doesn't include the original `term_months`
        // — we lost that detail after acceptance. Render as
        // 'effectiveUntil - effectiveFrom' if available, otherwise
        // 'Indefinite' is the honest answer at this point.
        termMonths: this.estimateTermMonths(
          terminated.effectiveFrom,
          terminated.effectiveUntil
        ),
        note: null,
      });

      return terminated;
    } catch (error) {
      this.handleError(error, 'terminateAgreement');
    }
  }

  // ── Public: reads ───────────────────────────────────────────────────────

  /**
   * Active agreements for an org. Sorted by `effectiveFrom DESC` so the
   * most recent agreements bubble up.
   *
   * Filters (WP-4 / Codex-rzfjw):
   * - `status='active'`
   * - `terminatedAt IS NULL OR terminatedAt > activeAt` (Decision Q3:
   *   no pro-rating — whoever holds an active agreement at invoice fire
   *   time receives the full cut for that period)
   * - `effectiveFrom <= activeAt` (an agreement scheduled to start in
   *   the future never receives a payout for the current invoice)
   * - NOT `effectiveUntil`: the term's end is a review date, not an expiry
   *   (owner decision AGR-01, "Keeps paying"; Codex-2hxff.17). An agreement
   *   past it is still active, here and in every payment path
   *   (`agreementsInForce`).
   * - optional `revenueType` filter (subscription | content_purchase)
   *
   * When `activeAt` is omitted, defaults to `new Date()`. The payout
   * pipeline always passes the invoice's `created` timestamp so a
   * webhook replay against the same invoice surfaces the same set of
   * agreements regardless of clock drift.
   */
  async getActiveAgreements(input: {
    organizationId: string;
    revenueType?: RevenueType;
    activeAt?: Date;
  }): Promise<AgreementWithShare[]> {
    try {
      const at = input.activeAt ?? new Date();
      const rows = await this.db.query.creatorOrganizationAgreements.findMany({
        with: WITH_CURRENT_SHARE,
        where: and(
          eq(
            creatorOrganizationAgreements.organizationId,
            input.organizationId
          ),
          // Per Decision Q3: an agreement is "active at activeAt" if
          // EITHER it is currently status='active' (never terminated,
          // and the schema check enforces terminatedAt IS NULL), OR it
          // was terminated AFTER activeAt (so it was still live at
          // invoice fire time and earns the cut for that period).
          or(
            eq(creatorOrganizationAgreements.status, 'active'),
            and(
              eq(creatorOrganizationAgreements.status, 'terminated'),
              gt(creatorOrganizationAgreements.terminatedAt, at)
            )
          ),
          lte(creatorOrganizationAgreements.effectiveFrom, at),
          input.revenueType
            ? eq(creatorOrganizationAgreements.revenueType, input.revenueType)
            : undefined
        ),
        orderBy: [desc(creatorOrganizationAgreements.effectiveFrom)],
      });
      return rows.map((row) => withShare(row, this.obs));
    } catch (error) {
      this.handleError(error, 'getActiveAgreements');
    }
  }

  /**
   * The organisation's agreements in force now, with each creator's name and
   * share — for the ownership-transfer screens (Codex-2hxff.2): the owner's
   * "your subscription income stops" warning, and the list a recipient sees
   * before accepting. Same "active now" predicates as
   * {@link getActiveAgreements}; the share is the current proposal's, as in
   * the payout path (`findActiveCreatorAgreementShare`).
   */
  async getActiveAgreementSummaries(organizationId: string): Promise<
    Array<{
      creatorId: string;
      creatorName: string;
      revenueType: RevenueType;
      shareBps: number;
      since: string;
    }>
  > {
    try {
      const now = new Date();
      const rows = await this.db
        .select({
          creatorId: creatorOrganizationAgreements.creatorId,
          creatorName: users.name,
          revenueType: creatorOrganizationAgreements.revenueType,
          shareBps: agreementProposals.proposedCreatorSharePercent,
          since: creatorOrganizationAgreements.effectiveFrom,
        })
        .from(creatorOrganizationAgreements)
        .innerJoin(
          agreementProposals,
          eq(
            agreementProposals.id,
            creatorOrganizationAgreements.currentProposalId
          )
        )
        .innerJoin(users, eq(users.id, creatorOrganizationAgreements.creatorId))
        .where(
          and(
            eq(creatorOrganizationAgreements.organizationId, organizationId),
            eq(creatorOrganizationAgreements.status, 'active'),
            lte(creatorOrganizationAgreements.effectiveFrom, now)
          )
        )
        .orderBy(asc(creatorOrganizationAgreements.effectiveFrom));
      return rows.map((row) => ({
        creatorId: row.creatorId,
        creatorName: row.creatorName,
        // `revenue_type` is varchar, held to RevenueType by its CHECK.
        revenueType: row.revenueType as RevenueType,
        shareBps: row.shareBps,
        since: row.since.toISOString(),
      }));
    } catch (error) {
      this.handleError(error, 'getActiveAgreementSummaries');
    }
  }

  /**
   * Creator's portfolio across all orgs — used by the creator-studio
   * /negotiations page. Filters to `status='active'` only with the same
   * temporal predicates as {@link getActiveAgreements}.
   */
  async getActiveAgreementsForCreator(input: {
    creatorId: string;
    revenueType?: RevenueType;
    activeAt?: Date;
  }): Promise<AgreementWithShare[]> {
    try {
      const at = input.activeAt ?? new Date();
      const rows = await this.db.query.creatorOrganizationAgreements.findMany({
        with: WITH_CURRENT_SHARE,
        where: and(
          eq(creatorOrganizationAgreements.creatorId, input.creatorId),
          // Q3 semantics (see getActiveAgreements above):
          or(
            eq(creatorOrganizationAgreements.status, 'active'),
            and(
              eq(creatorOrganizationAgreements.status, 'terminated'),
              gt(creatorOrganizationAgreements.terminatedAt, at)
            )
          ),
          lte(creatorOrganizationAgreements.effectiveFrom, at),
          input.revenueType
            ? eq(creatorOrganizationAgreements.revenueType, input.revenueType)
            : undefined
        ),
        orderBy: [desc(creatorOrganizationAgreements.effectiveFrom)],
      });
      return rows.map((row) => withShare(row, this.obs));
    } catch (error) {
      this.handleError(error, 'getActiveAgreementsForCreator');
    }
  }

  /**
   * Creator's terminated/past agreements across all orgs (`status='terminated'`).
   * Powers the creator-side `/studio/negotiations` "Past" section so users can
   * see agreements they (or the org owner) have terminated. Without this,
   * terminated agreements would be invisible to the creator: they drop out of
   * `getActiveAgreementsForCreator` once `terminatedAt <= now`, and the
   * proposal row that originated the agreement stays in `accepted` status —
   * so the existing `getProposalsForCreator(['declined','withdrawn','superseded'])`
   * enumeration never surfaces them either.
   *
   * Optional `since` cutoff lets callers bound the result set (e.g. last 90
   * days for the portfolio view). Default: no cutoff.
   */
  async getTerminatedAgreementsForCreator(input: {
    creatorId: string;
    since?: Date;
  }): Promise<AgreementWithShare[]> {
    try {
      const rows = await this.db.query.creatorOrganizationAgreements.findMany({
        with: WITH_CURRENT_SHARE,
        where: and(
          eq(creatorOrganizationAgreements.creatorId, input.creatorId),
          eq(creatorOrganizationAgreements.status, 'terminated'),
          input.since
            ? gt(creatorOrganizationAgreements.terminatedAt, input.since)
            : undefined
        ),
        orderBy: [desc(creatorOrganizationAgreements.terminatedAt)],
      });
      return rows.map((row) => withShare(row, this.obs));
    } catch (error) {
      this.handleError(error, 'getTerminatedAgreementsForCreator');
    }
  }

  /**
   * Find active agreements approaching their review date (Codex-tugez), for
   * the reminder email. The review date is not an expiry (AGR-01).
   *
   * Filters:
   *   - `status='active'` — only live agreements are reviewed
   *   - `effectiveUntil IS NOT NULL` — indefinite agreements have no review date
   *   - `effectiveUntil > now` — the review date has not already passed
   *   - `effectiveUntil <= now + daysAhead days` — within the warning window
   *   - `expiringSoonEmailSentAt IS NULL` — idempotency gate; once the cron
   *     has fired for this row, it does not refire
   *
   * Returns enriched rows: agreement + creator contact + org name and slug
   * (the slug builds the owner's email link). The cron handler iterates this list and dispatches one email per recipient
   * (creator + the first active owner of the org) per agreement.
   *
   * Soft-deleted users (creator or owner) are filtered out — there is
   * nothing to email. Orphan orgs (no active owner) still surface the
   * creator-side email; the cron handler is the place to handle the
   * owner-side lookup.
   *
   * Used by `notifications-api`'s scheduled handler. Not gated by auth —
   * the worker's cron trigger is its own authentication.
   */
  async findExpiringAgreements(input: {
    daysAhead: number;
    now?: Date;
  }): Promise<
    Array<{
      agreement: AgreementWithShare;
      creator: { id: string; email: string; name: string };
      orgName: string;
      orgSlug: string;
    }>
  > {
    try {
      const now = input.now ?? new Date();
      const windowEnd = new Date(
        now.getTime() + input.daysAhead * 24 * 60 * 60 * 1000
      );

      const rows = await this.db
        .select({
          agreement: creatorOrganizationAgreements,
          creatorSharePercent: agreementProposals.proposedCreatorSharePercent,
          creatorEmail: users.email,
          creatorName: users.name,
          orgName: organizations.name,
          orgSlug: organizations.slug,
        })
        .from(creatorOrganizationAgreements)
        .leftJoin(
          agreementProposals,
          eq(
            agreementProposals.id,
            creatorOrganizationAgreements.currentProposalId
          )
        )
        .innerJoin(users, eq(users.id, creatorOrganizationAgreements.creatorId))
        .innerJoin(
          organizations,
          eq(organizations.id, creatorOrganizationAgreements.organizationId)
        )
        .where(
          and(
            eq(creatorOrganizationAgreements.status, 'active'),
            isNull(creatorOrganizationAgreements.expiringSoonEmailSentAt),
            // Window: not yet expired AND within the warning lead time.
            gt(creatorOrganizationAgreements.effectiveUntil, now),
            lte(creatorOrganizationAgreements.effectiveUntil, windowEnd)
          )
        );

      return rows.map((r) => {
        if (r.creatorSharePercent === null) {
          reportMissingProposal(this.obs, {
            agreementId: r.agreement.id,
            organizationId: r.agreement.organizationId,
          });
        }
        return {
          agreement: {
            ...r.agreement,
            creatorSharePercent: r.creatorSharePercent,
          },
          creator: {
            id: r.agreement.creatorId,
            email: r.creatorEmail,
            name: r.creatorName,
          },
          orgName: r.orgName,
          orgSlug: r.orgSlug,
        };
      });
    } catch (error) {
      this.handleError(error, 'findExpiringAgreements');
    }
  }

  /**
   * Mark `expiring_soon_email_sent_at = now` for one agreement. Called
   * by the cron handler after a successful email dispatch so re-running
   * the sweep does NOT re-send. Per-agreement update (no batching) —
   * the sweep is daily and the row count is bounded; a transaction per
   * row is acceptable and lets us tolerate per-row failure.
   *
   * Idempotent: setting the column on an already-marked row is a no-op.
   * No transaction needed (single UPDATE).
   */
  async markExpiringSoonSent(
    agreementId: string,
    sentAt?: Date
  ): Promise<void> {
    try {
      const at = sentAt ?? new Date();
      await this.db
        .update(creatorOrganizationAgreements)
        .set({
          expiringSoonEmailSentAt: at,
          updatedAt: at,
        })
        .where(eq(creatorOrganizationAgreements.id, agreementId));
    } catch (error) {
      this.handleError(error, 'markExpiringSoonSent');
    }
  }

  /**
   * Resolve the first active owner of an org — used by the
   * agreement-expiring-soon cron to find a recipient for the org-side
   * email. Returns `null` for orphan orgs (no active owner row). The
   * cron handler logs and skips the owner-side email when this returns
   * `null`; the creator-side email still fires.
   */
  async getFirstActiveOwnerContact(organizationId: string): Promise<{
    id: string;
    email: string;
    name: string;
  } | null> {
    try {
      const [row] = await this.db
        .select({
          userId: organizationMemberships.userId,
          email: users.email,
          name: users.name,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.role, 'owner'),
            eq(organizationMemberships.status, 'active')
          )
        )
        .orderBy(asc(organizationMemberships.createdAt))
        .limit(1);
      if (!row) return null;
      return { id: row.userId, email: row.email, name: row.name };
    } catch (error) {
      this.handleError(error, 'getFirstActiveOwnerContact');
    }
  }

  /**
   * Full negotiation thread for a (org, creator, revenue_type) triple,
   * chronological. Empty array if no thread exists yet.
   *
   * The UI uses this to render the proposal history alongside the
   * accept/counter/decline controls. Round numbers are monotonic per
   * thread so the order is unambiguous.
   */
  async getNegotiationThread(input: {
    organizationId: string;
    creatorId: string;
    revenueType: RevenueType;
  }): Promise<AgreementProposal[]> {
    try {
      return await this.db.query.agreementProposals.findMany({
        where: and(
          eq(agreementProposals.organizationId, input.organizationId),
          eq(agreementProposals.creatorId, input.creatorId),
          eq(agreementProposals.revenueType, input.revenueType)
        ),
        orderBy: [
          asc(agreementProposals.roundNumber),
          asc(agreementProposals.createdAt),
        ],
      });
    } catch (error) {
      this.handleError(error, 'getNegotiationThread');
    }
  }

  /**
   * All proposals where the given user is the named creator, regardless of
   * org or revenue type. Optional `status` filter narrows the result set.
   *
   * Used by the creator-side portfolio (WP-8 — Codex-bw2wf) to surface
   * pending proposals on orgs where the creator does NOT yet have an
   * `creatorOrganizationAgreement` row — i.e. owner-initiated round-1
   * proposals that the creator hasn't accepted yet. `getActiveAgreementsForCreator`
   * alone misses these because no active agreement row exists until accept.
   *
   * Returns chronological proposals (oldest first). Empty array when the
   * caller has no proposals.
   */
  async getProposalsForCreator(input: {
    creatorId: string;
    status?: AgreementProposal['status'] | AgreementProposal['status'][];
  }): Promise<AgreementProposal[]> {
    try {
      const statusFilter = (() => {
        if (!input.status) return undefined;
        const arr = Array.isArray(input.status) ? input.status : [input.status];
        if (arr.length === 0) return undefined;
        return inArray(agreementProposals.status, arr);
      })();
      return await this.db.query.agreementProposals.findMany({
        where: and(
          eq(agreementProposals.creatorId, input.creatorId),
          statusFilter
        ),
        orderBy: [asc(agreementProposals.createdAt)],
      });
    } catch (error) {
      this.handleError(error, 'getProposalsForCreator');
    }
  }

  /**
   * All proposals on an organization, regardless of which creator they
   * target. Mirrors {@link getProposalsForCreator} but org-scoped — used
   * by WP-9 (Codex-k9no0) to surface "counter-proposal received" signals
   * on the owner studio dashboard. The org-status composite index
   * (`idx_agreement_proposals_org_status`) already exists on the schema,
   * so the typical "open proposals on this org" query is index-served.
   *
   * Optional `proposedByRole` filter lets the FocusRail aggregator pull
   * "open proposals from creators waiting on owner action" in a single
   * round-trip instead of pulling all open proposals and filtering
   * client-side.
   *
   * Returns chronological proposals (oldest first) — same ordering as
   * {@link getProposalsForCreator} so consumers can reuse the same
   * iteration code on both sides.
   *
   * Authorisation note: the SERVICE applies no auth gate; callers are
   * expected to scope the request by an org the actor is already
   * authorised to read (see the `requireOrgManagement` route gate in
   * `workers/ecom-api/src/routes/agreements.ts`).
   */
  async getProposalsForOrg(input: {
    organizationId: string;
    status?: AgreementProposal['status'] | AgreementProposal['status'][];
    proposedByRole?: 'owner' | 'creator';
  }): Promise<AgreementProposal[]> {
    try {
      const statusFilter = (() => {
        if (!input.status) return undefined;
        const arr = Array.isArray(input.status) ? input.status : [input.status];
        if (arr.length === 0) return undefined;
        return inArray(agreementProposals.status, arr);
      })();
      const roleFilter = input.proposedByRole
        ? eq(agreementProposals.proposedByRole, input.proposedByRole)
        : undefined;
      return await this.db.query.agreementProposals.findMany({
        where: and(
          eq(agreementProposals.organizationId, input.organizationId),
          statusFilter,
          roleFilter
        ),
        orderBy: [asc(agreementProposals.createdAt)],
      });
    } catch (error) {
      this.handleError(error, 'getProposalsForOrg');
    }
  }

  /**
   * Resolve a human-readable org name for one organization id. Returns
   * `null` for unknown / hard-deleted orgs (rare). Used by the
   * creator-side portfolio route to surface friendly org names — the
   * agreement rows themselves only carry the id.
   *
   * Soft-deleted orgs are deliberately included; a recently-archived
   * org with an outstanding negotiation is still useful audit context.
   */
  async getOrgName(organizationId: string): Promise<string | null> {
    return this.lookupOrgName(organizationId);
  }

  // ── Lifecycle notification dispatch (WP-5 — Codex-90de9) ────────────────

  /**
   * Format a basis-points share (0–10000) as a display string ("30%").
   * Centralised so all six lifecycle templates render the share with
   * identical formatting. Per the post-platform semantic, callers MUST
   * pass the value FROM the proposal / agreement row — the template
   * itself does not re-derive it from the legacy org-fee column.
   */
  private formatSharePercent(sharePercentBasisPoints: number): string {
    // Integer math first: 3000 bp → 30. Fractional shares (rare —
    // proposals are integer bp) fall through to `toFixed(2)` to avoid
    // float surprises like "29.999999%".
    const asPercent = sharePercentBasisPoints / 100;
    return Number.isInteger(asPercent)
      ? `${asPercent}%`
      : `${asPercent.toFixed(2)}%`;
  }

  /**
   * Format a `term_months` value into the display string used across
   * every agreement-lifecycle template. `null` = indefinite agreement
   * per the schema; the UI surface and the email copy reflect that.
   */
  private formatTermMonths(termMonths: number | null): string {
    if (termMonths == null) return 'Indefinite';
    return termMonths === 1 ? '1 month' : `${termMonths} months`;
  }

  /**
   * Format a Date for display inside email body. ISO date (YYYY-MM-DD)
   * stays locale-neutral and machine-readable. The web UI can render
   * the absolute date in the recipient's timezone via the embedded
   * deep link.
   */
  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Reconstruct the original `term_months` from the (effectiveFrom,
   * effectiveUntil) pair on the agreement row. Used by the termination
   * notice when we no longer have direct access to the proposal's
   * `proposed_term_months` field. `null` `effectiveUntil` = indefinite.
   *
   * Returns `null` when both are unset or when the window is sub-monthly
   * (rare; the termination notice degrades to 'Indefinite' display in
   * that case which is honest enough for terminal-state copy).
   */
  private estimateTermMonths(
    effectiveFrom: Date | null,
    effectiveUntil: Date | null
  ): number | null {
    if (!effectiveFrom || !effectiveUntil) return null;
    const ms = effectiveUntil.getTime() - effectiveFrom.getTime();
    if (ms <= 0) return null;
    // ~30.44 days/month average — close enough for display copy.
    const months = Math.round(ms / (1000 * 60 * 60 * 24 * 30.44));
    return months > 0 ? months : null;
  }

  /**
   * Locate the email + display name for a given user. Returns `null`
   * when the user has been hard-deleted (e.g. GDPR erasure happened
   * between transaction commit and mailer fire — rare but possible).
   * The lifecycle dispatcher silently skips the email in that case.
   */
  private async lookupUserContact(userId: string): Promise<{
    email: string;
    name: string;
  } | null> {
    const [row] = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    return { email: row.email, name: row.name };
  }

  /**
   * Locate the human-readable org name for a given org id. Soft-deleted
   * orgs are deliberately included — an agreement notification for a
   * recently-archived org is still useful audit information.
   */
  private async lookupOrgName(organizationId: string): Promise<string | null> {
    return (await this.lookupOrg(organizationId))?.name ?? null;
  }

  /**
   * The org's name, for the email body, and its slug, for the owner's
   * link to their organisation Studio. Soft-deleted orgs are included, as
   * in `lookupOrgName`.
   */
  private async lookupOrg(
    organizationId: string
  ): Promise<{ name: string; slug: string } | null> {
    const [row] = await this.db
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Dispatch one lifecycle notification fire-and-forget. Wraps the
   * `mailer` thunk in a try/catch so a thrown error never bubbles out
   * — the agreement transaction has already committed, and the
   * notification is observation, not source-of-truth.
   *
   * Latency hardening (Codex-0omga polish): when a `waitUntil` hook was
   * threaded through the constructor, the ENTIRE dispatch (DB lookups +
   * mailer fire) is pushed off the request critical path. Inside
   * `procedure()` handlers this means the API response no longer pays
   * the ~one-DB-roundtrip lookup tax for every agreement mutation. When
   * `waitUntil` is absent (narrow tests, legacy harnesses) the dispatch
   * still runs awaited inline — slower, but correct.
   *
   * The returned promise resolves only AFTER `waitUntil` has been
   * scheduled (or, when no `waitUntil` is wired, after the inline
   * dispatch settles). Either way the call site never observes a
   * rejection — the rejection branch logs + swallows.
   *
   * `note` is intentionally NOT redacted — these notes are between two
   * commercial parties, both of whom can see them via the negotiation
   * UI anyway. They DO get HTML-escaped by the renderer.
   */
  private async dispatchLifecycleEmail(
    params: LifecycleEmailParams
  ): Promise<void> {
    const work = this.dispatchLifecycleEmailImpl(params).catch((err) => {
      // We deliberately log + swallow. Mailer transport failures should
      // not prevent the agreement from existing — the agreement row is
      // the source of truth.
      this.obs.warn('agreement notification dispatch failed', {
        templateName: params.templateName,
        recipientUserId: params.recipientUserId,
        threadId: params.threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    if (this.waitUntil) {
      // Production hot path: schedule on the worker's ExecutionContext
      // so the API response unblocks immediately. The lookup phase
      // (three DB selects) no longer blocks the response.
      this.waitUntil(work);
      return;
    }
    // Fallback: await inline so test harnesses without a waitUntil hook
    // can still observe the dispatch sequence via mailer.mock.calls.
    await work;
  }

  private async dispatchLifecycleEmailImpl(
    params: LifecycleEmailParams
  ): Promise<void> {
    if (!this.mailer) {
      // Narrow unit tests / legacy harnesses without a mailer wired —
      // silently no-op. The agreement mutation has already succeeded;
      // notification is best-effort.
      return;
    }

    const [recipient, counterparty, org] = await Promise.all([
      this.lookupUserContact(params.recipientUserId),
      params.counterpartyUserId
        ? this.lookupUserContact(params.counterpartyUserId)
        : null,
      this.lookupOrg(params.organizationId),
    ]);

    if (!recipient) {
      // User row vanished between commit and mailer fire. Nothing to
      // do — log and exit.
      this.obs.warn(
        'agreement notification skipped: recipient user not found',
        {
          recipientUserId: params.recipientUserId,
          templateName: params.templateName,
        }
      );
      return;
    }

    let link: AgreementEmailRecipient;
    if (params.recipientSide === 'owner') {
      if (!org) {
        // The owner's link is their organisation's Studio, so without the
        // org row there is no page to send them to. At error with an
        // errorId: an owner misses an email, and an agreement whose org row
        // is gone (orgs are soft-deleted, and `lookupOrg` reads those too)
        // is a data-integrity fault to chase.
        this.obs.error(
          'agreement notification skipped: organisation not found',
          {
            errorId: crypto.randomUUID(),
            organizationId: params.organizationId,
            templateName: params.templateName,
            recipientUserId: params.recipientUserId,
          }
        );
        return;
      }
      link = { side: 'owner', orgSlug: org.slug };
    } else {
      link = { side: 'creator', proposalId: params.threadId };
    }

    const data: Record<string, string | number | boolean> = {
      recipientName: recipient.name,
      orgName: org?.name ?? 'Your organization',
      otherPartyName: counterparty?.name ?? 'The other party',
      revenueTypeLabel: formatRevenueTypeLabel(params.revenueType),
      sharePercentDisplay: this.formatSharePercent(params.sharePercent),
      termMonthsDisplay: this.formatTermMonths(params.termMonths),
      deepLinkUrl: buildAgreementEmailLink(this.envName, link),
      // Empty string keeps the renderer's missing-token list clean —
      // the template still includes the `<em>Note:</em>` block but it
      // renders as empty when no note was supplied.
      note: params.note ?? '',
      ...params.extraContext,
    };

    this.mailer({
      to: recipient.email,
      toName: recipient.name,
      templateName: params.templateName,
      category: 'transactional',
      userId: params.recipientUserId,
      organizationId: params.organizationId,
      data,
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Resolve "is this user an active owner of this org?".
   *
   * Per WP-1 discovery, `organizations.owner_id` does NOT exist —
   * ownership is encoded by `organization_memberships.role='owner' AND
   * status='active'`. There may be 0 or many such rows.
   *
   * Implementation: two targeted queries. The first asks "is THIS user
   * an active owner?" and short-circuits the happy path. If no, we
   * issue a second query to distinguish "you are not an owner" (some
   * owner exists, just not you) from "no owner exists at all" (orphan
   * org) — useful telemetry and a precise error message for the UI.
   *
   * Throws `ForbiddenError` when the user is not an active owner, or
   * when the org has no active owner at all (orphaned organisations).
   */
  private async assertActiveOwner(
    tx: Tx,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // Quick existence check on the org first — gives a more precise
    // error than "no active owner" when the org id is bogus.
    const org = await tx.query.organizations.findFirst({
      where: and(
        eq(organizations.id, organizationId),
        whereNotDeleted(organizations)
      ),
      columns: { id: true },
    });
    if (!org) {
      throw new NotFoundError('Organization not found', {
        resource: 'organization',
        organizationId,
      });
    }

    // Targeted lookup: is THIS user an active owner? Single-row hit.
    const myOwnership = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      ),
      columns: { id: true },
    });
    if (myOwnership) return;

    // Not this user — distinguish "no owner exists" from "you aren't
    // the owner". Both are 403; the message + context differ so the UI
    // can render the right next step.
    const anyOwner = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      ),
      columns: { id: true },
    });
    if (!anyOwner) {
      throw new ForbiddenError('Organization has no active owner', {
        organizationId,
      });
    }
    throw new ForbiddenError(
      'Only an active organization owner may perform this action',
      { organizationId, userId }
    );
  }

  /**
   * Membership existence check — the creator must be on the team. Any
   * active role qualifies; we don't gate on `role='creator'` so an
   * owner can propose to themselves (single-creator-orgs do this to
   * pre-empt the org-keeps-100% fallback path).
   *
   * Takes a SHARE lock on the membership row, so a removal running at the
   * same moment waits for this transaction (and then ends what it created),
   * or wins and this check fails (owner decision AGR-09).
   */
  private async assertActiveMember(
    tx: Tx,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const [membership] = await tx
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active')
        )
      )
      .for('share');
    if (!membership) {
      throw new ForbiddenError(
        'Target user is not an active member of this organization',
        { organizationId, userId }
      );
    }
  }

  /**
   * Refuse to open a new round-1 proposal when a thread is already open for
   * the same (org, creator, revenue_type) triple: one of its proposals is
   * `open`. A `countered` row is not: a counter marks it in the same
   * transaction that adds the thread's next `open` row, so a live thread
   * always shows that row. Counting `countered` too stranded a thread for
   * good once its last counter was declined or withdrawn (by hand or on
   * departure): nothing moves a `countered` row on but an accept.
   *
   * If the caller wants to re-open after a decline/withdraw, they
   * call `proposeAgreement` again, which lands in this guard and
   * passes because no proposal in the thread is open.
   */
  private async assertNoOpenThread(
    tx: Tx,
    organizationId: string,
    creatorId: string,
    revenueType: RevenueType
  ): Promise<void> {
    const inflight = await tx.query.agreementProposals.findFirst({
      where: and(
        eq(agreementProposals.organizationId, organizationId),
        eq(agreementProposals.creatorId, creatorId),
        eq(agreementProposals.revenueType, revenueType),
        eq(agreementProposals.status, 'open')
      ),
      columns: { id: true, status: true },
    });
    if (inflight) {
      throw new InvalidProposalStateError(
        'A proposal is already open for this creator + revenue type — counter or decline it first',
        {
          proposalId: inflight.id,
          currentStatus: inflight.status,
          attemptedAction: 'propose',
        }
      );
    }
  }

  /**
   * Serialise every change that can open a thread or raise a pool's shares:
   * one transaction-scoped advisory lock per (organisation, revenue type),
   * released at commit or rollback (Codex-2hxff.19 AGR-04, AGR-13). Taken by
   * propose, counter and accept after any row lock they hold (lock order:
   * packages/organization/CLAUDE.md) and before the open-thread check and
   * the sum of shares, which are then read with every competitor committed.
   * Hashed as the purchase and payout-split locks are.
   */
  private async lockAgreementShares(
    tx: Tx,
    organizationId: string,
    revenueType: RevenueType
  ): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`agreement-shares:${organizationId}:${revenueType}`}))`
    );
  }

  /**
   * An agreement's share in basis points: its accepted proposal's
   * (Codex-2hxff.19 AGR-08), never the legacy `organization_fee_percentage`.
   * `null` when the proposal link is gone (logged): the resolver pays such an
   * agreement nothing.
   */
  private async currentShare(
    tx: Tx,
    agreement: CreatorOrganizationAgreement
  ): Promise<number | null> {
    const [row] = agreement.currentProposalId
      ? await tx
          .select({ share: agreementProposals.proposedCreatorSharePercent })
          .from(agreementProposals)
          .where(eq(agreementProposals.id, agreement.currentProposalId))
      : [];
    if (!row) {
      reportMissingProposal(this.obs, {
        agreementId: agreement.id,
        organizationId: agreement.organizationId,
      });
      return null;
    }
    return row.share;
  }

  /**
   * Existing active creator shares for this (org, revenue_type) bucket,
   * read from each agreement's accepted proposal through
   * `current_proposal_id` — the resolver's join — not from the legacy
   * `organization_fee_percentage` (Codex-2hxff.19 AGR-08). An agreement with
   * no proposal pays nothing (the resolver skips it), so it counts 0, and is
   * logged.
   *
   * Callers hold `lockAgreementShares`, so no accept for another creator can
   * commit between this read and their own write.
   *
   * Returns an array (not the sum) so the caller can include the
   * breakdown in `ShareExceedsAvailableError.context.existingActiveShares`.
   */
  private async fetchExistingActiveShares(
    tx: Tx,
    organizationId: string,
    revenueType: RevenueType,
    options: { excludeCreatorId?: string } = {}
  ): Promise<number[]> {
    const conditions = [
      eq(creatorOrganizationAgreements.organizationId, organizationId),
      eq(creatorOrganizationAgreements.revenueType, revenueType),
      eq(creatorOrganizationAgreements.status, 'active'),
      isNull(creatorOrganizationAgreements.terminatedAt),
    ];
    if (options.excludeCreatorId) {
      conditions.push(
        ne(creatorOrganizationAgreements.creatorId, options.excludeCreatorId)
      );
    }
    const rows = await tx
      .select({
        agreementId: creatorOrganizationAgreements.id,
        share: agreementProposals.proposedCreatorSharePercent,
      })
      .from(creatorOrganizationAgreements)
      .leftJoin(
        agreementProposals,
        eq(
          agreementProposals.id,
          creatorOrganizationAgreements.currentProposalId
        )
      )
      .where(and(...conditions));

    return rows.map((row) => {
      if (row.share !== null) return row.share;
      reportMissingProposal(this.obs, {
        agreementId: row.agreementId,
        organizationId,
        revenueType,
      });
      return 0;
    });
  }

  /**
   * Walks `proposed_term_months` into a concrete `effective_until`
   * timestamp. `null` term = indefinite agreement, so we leave
   * `effective_until` null. Months are added by walking the date
   * components — DST-safe within the resolution this column needs
   * (monthly).
   */
  private computeEffectiveUntil(
    effectiveFrom: Date,
    termMonths: number | null
  ): Date | null {
    if (termMonths == null) return null;
    const d = new Date(effectiveFrom.getTime());
    d.setUTCMonth(d.getUTCMonth() + termMonths);
    return d;
  }

  /**
   * Locked proposal lookup — `SELECT ... FOR UPDATE` on the proposal
   * row inside the calling transaction. Closes the READ COMMITTED race
   * window where two concurrent callers could both observe
   * `status='open'`, both proceed, and corrupt the audit trail.
   *
   * Used by all five proposal-mutating methods (counter / accept /
   * decline / withdraw + the agreement counterpart `terminate`). The
   * unlocked read path (`findProposalOrThrow`) is reserved for the
   * non-mutating endpoints we don't yet have but might add (e.g. a
   * /preview surface).
   */
  private async findProposalForUpdateOrThrow(
    tx: Tx,
    proposalId: string
  ): Promise<AgreementProposal> {
    const rows = await tx
      .select()
      .from(agreementProposals)
      .where(eq(agreementProposals.id, proposalId))
      .for('update');
    const row = rows[0];
    if (!row) {
      throw new AgreementNotFoundError('Proposal not found', { proposalId });
    }
    return row;
  }

  /**
   * Locked agreement lookup — counterpart of
   * {@link findProposalForUpdateOrThrow} for the
   * `creator_organization_agreements` table. Called by
   * `terminateAgreement` so the active → terminated transition is
   * serialised against any concurrent caller.
   */
  private async findAgreementForUpdateOrThrow(
    tx: Tx,
    agreementId: string
  ): Promise<CreatorOrganizationAgreement> {
    const rows = await tx
      .select()
      .from(creatorOrganizationAgreements)
      .where(eq(creatorOrganizationAgreements.id, agreementId))
      .for('update');
    const row = rows[0];
    if (!row) {
      throw new AgreementNotFoundError('Agreement not found', { agreementId });
    }
    return row;
  }
}

/**
 * Owner decision 2026-10-21, "Refuse a future start" (Codex-2hxff.63):
 * accepting ends the creator's current agreement at once, so a new one that
 * began later would leave them unpaid in between. A past start is allowed.
 */
function assertNotFutureStart(effectiveFrom: Date | undefined, now: Date) {
  if (effectiveFrom && effectiveFrom.getTime() > now.getTime()) {
    throw new FutureStartNotAllowedError({
      effectiveFrom: effectiveFrom.toISOString(),
    });
  }
}
