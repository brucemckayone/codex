/**
 * Reactive test double for `$lib/remote/agreements.remote`, plus agreement
 * rows, for mounting the pages that show a creator's share (Codex-fazy6).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. Each
 * query returns a `$state` slot that a test answers before or after mounting.
 *
 * Every row builder sets the legacy `organizationFeePercentage` to DISAGREE
 * with `creatorSharePercent` (3000 against 4000), so a page that rebuilt the
 * share as `10000 - organizationFeePercentage` would show "70%", not "40%".
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import type { AgreementProposal, AgreementWithShare } from '@codex/agreements';
import { type Mock, vi } from 'vitest';

export const ORG_ID = '33333333-3333-4333-8333-333333333333';
export const CREATOR_ID = 'creator-maya';

/** The real share (40%) and what the legacy column would rebuild (70%). */
export const REAL_SHARE = '40%';
export const LEGACY_SHARE = '70%';

/** An org-side active agreement row, as `GET /agreements` returns it. */
export function agreementRow(
  overrides: Partial<AgreementWithShare> = {}
): AgreementWithShare {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    creatorId: CREATOR_ID,
    organizationId: ORG_ID,
    creatorSharePercent: 4000,
    organizationFeePercentage: 3000,
    revenueType: 'subscription',
    status: 'active',
    currentProposalId: '44444444-4444-4444-8444-444444444444',
    effectiveFrom: new Date('2026-09-01T00:00:00Z'),
    effectiveUntil: null,
    terminatedAt: null,
    terminatedByUserId: null,
    terminationReason: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  } as AgreementWithShare;
}

/**
 * A creator-side `active` portfolio row. The worker still sends the legacy
 * column; the web type leaves it out, so it is added here untyped.
 */
export function portfolioActiveRow(
  overrides: { creatorSharePercent?: number | null } = {}
) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: ORG_ID,
    organizationName: 'Studio Alpha',
    creatorId: CREATOR_ID,
    revenueType: 'subscription',
    status: 'active',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveUntil: null,
    creatorSharePercent: 4000,
    organizationFeePercentage: 3000,
    currentProposalId: '44444444-4444-4444-8444-444444444444',
    terminatedAt: null,
    peers: { count: 0, aggregateSharePercent: 0 },
    ...overrides,
  };
}

/** The accepted proposal a thread opens with (its share is the real 40%). */
export function acceptedProposal(): AgreementProposal {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId: ORG_ID,
    creatorId: CREATOR_ID,
    revenueType: 'subscription',
    parentProposalId: null,
    roundNumber: 1,
    proposedByUserId: 'owner-alex',
    proposedByRole: 'owner',
    proposedCreatorSharePercent: 4000,
    proposedTermMonths: null,
    proposedEffectiveFrom: null,
    note: null,
    status: 'accepted',
    respondedAt: new Date('2026-09-01T00:00:00Z'),
    respondedByUserId: CREATOR_ID,
    declineReason: null,
    createdAt: new Date('2026-08-30T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  } as AgreementProposal;
}

/**
 * A query's slot. `refresh` is a spy that changes nothing by itself: a test
 * drives a Retry the way kit does, landing an answer or a rejection with
 * `fail` / the `set*` helpers.
 */
export interface Slot<T> {
  current: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: Mock<() => Promise<void>>;
}

function makeSlot<T>(current?: T): Slot<T> {
  const slot = $state<Slot<T>>({
    current,
    error: undefined,
    loading: current === undefined,
    refresh: vi.fn(async () => {}),
  });
  return slot;
}

/** The shape SvelteKit rejects a remote query with: `{ status, body }`. */
export const httpError = (status = 500) => ({
  status,
  body: { message: 'Internal Error' },
});

/** Land a rejection on a slot, as kit does when the read fails. */
export function fail<T>(slot: Slot<T>, error: unknown = httpError()) {
  slot.current = undefined;
  slot.error = error;
  slot.loading = false;
}

type Page<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const page = <T>(items: T[]): Page<T> => ({
  items,
  pagination: {
    page: 1,
    limit: items.length,
    total: items.length,
    totalPages: 1,
  },
});

type Portfolio = {
  active: ReturnType<typeof portfolioActiveRow>[];
  pendingActionRequired: unknown[];
  pendingWaitingOnOrg: unknown[];
  past: unknown[];
};

let active = makeSlot<Page<AgreementWithShare>>();
let pending = makeSlot(page<unknown>([]));
let orgThread = makeSlot<AgreementProposal[]>([]);
let portfolio = makeSlot<Portfolio>();
let myThread = makeSlot<AgreementProposal[]>();

export function reset() {
  active = makeSlot<Page<AgreementWithShare>>();
  pending = makeSlot(page<unknown>([]));
  orgThread = makeSlot<AgreementProposal[]>([]);
  portfolio = makeSlot<Portfolio>();
  myThread = makeSlot<AgreementProposal[]>();
}

/** Answer the org's active-agreements list. */
export function setActiveAgreements(rows: AgreementWithShare[]) {
  active.current = page(rows);
  active.error = undefined;
  active.loading = false;
}

/** Answer the org's pending-proposals list. */
export function setPendingProposals(rows: Partial<AgreementProposal>[]) {
  pending.current = page<unknown>(rows);
  pending.error = undefined;
  pending.loading = false;
}

export const activeSlot = () => active;
export const pendingSlot = () => pending;
export const portfolioSlot = () => portfolio;
export const orgThreadSlot = () => orgThread;
export const myThreadSlot = () => myThread;

/** Answer the creator's portfolio with these active rows. */
export function setPortfolio(rows: ReturnType<typeof portfolioActiveRow>[]) {
  portfolio.current = {
    active: rows,
    pendingActionRequired: [],
    pendingWaitingOnOrg: [],
    past: [],
  };
  portfolio.error = undefined;
  portfolio.loading = false;
}

/** Answer the creator's thread for the detail page. */
export function setMyThread(proposals: AgreementProposal[]) {
  myThread.current = proposals;
  myThread.loading = false;
}

// ── query() ─────────────────────────────────────────────────────────────
export const listActiveAgreements = vi.fn((_args: unknown) => active);
export const listPendingProposals = vi.fn((_args: unknown) => pending);
export const getAgreementThread = vi.fn((_args: unknown) => orgThread);
export const getMyAgreementPortfolio = vi.fn(() => portfolio);
export const getMyAgreementThread = vi.fn((_args: unknown) => myThread);

// ── command() ───────────────────────────────────────────────────────────
export const proposeAgreement = vi.fn();
export const counterAgreement = vi.fn();
export const acceptAgreement = vi.fn();
export const declineAgreement = vi.fn();
export const withdrawAgreement = vi.fn();
export const terminateAgreement = vi.fn();
