/**
 * Reactive test double for `$lib/remote/support.remote` (Codex-2hxff.28).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. Each
 * query returns a slot built on `$state`, one per argument, as kit caches one
 * `Query` per argument: a test lands an answer (or a rejection) on a slot and
 * the page re-renders, exactly as in production. A rejected slot mirrors
 * kit's: `current` stays undefined, `error` is set, `loading` is false.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import type {
  ChargeDetail,
  ChargeSummary,
  CheckedOwedToCreator,
  CreatorDebtPerson,
  FailedRefundItem,
  FeeChangeCard,
  FeeNoticeItem,
  HeldPriceMove,
  OwedToCreatorItem,
  PriceChangeRestarted,
  PriceMoveRetried,
  RefundPreview,
  ResolvedCreatorDebt,
  ResolvedFailedRefund,
  ResolvedOwedToCreator,
  StoppedPriceChange,
  SupportQueueCounts,
  ToldAnotherWayResult,
} from '@codex/admin';
import { type Mock, vi } from 'vitest';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import type { IssueRefundAnswer } from '../refund-outcome';

type Paginated<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export interface QuerySlot<T> {
  current: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: Mock<() => Promise<void>>;
}

function makeSlot<T>(): QuerySlot<T> {
  const slot = $state<QuerySlot<T>>({
    current: undefined,
    error: undefined,
    loading: false,
    refresh: vi.fn(async () => {}),
  });
  return slot;
}

function slotFor<T>(map: Map<string, QuerySlot<T>>, key: string): QuerySlot<T> {
  let slot = map.get(key);
  if (!slot) {
    slot = makeSlot<T>();
    map.set(key, slot);
  }
  return slot;
}

const charges = new Map<string, QuerySlot<ChargeDetail>>();
const searches = new Map<string, QuerySlot<Paginated<ChargeSummary>>>();
const previews = new Map<string, QuerySlot<RefundPreview>>();
const failedLists = new Map<string, QuerySlot<Paginated<FailedRefundItem>>>();
const debtLists = new Map<string, QuerySlot<Paginated<CreatorDebtPerson>>>();
const owedLists = new Map<string, QuerySlot<Paginated<OwedToCreatorItem>>>();
const feeChangeLists = new Map<string, QuerySlot<Paginated<FeeChangeCard>>>();
const feeNoticeLists = new Map<string, QuerySlot<Paginated<FeeNoticeItem>>>();
const heldMoveLists = new Map<string, QuerySlot<Paginated<HeldPriceMove>>>();
const stoppedChangeLists = new Map<
  string,
  QuerySlot<Paginated<StoppedPriceChange>>
>();
let counts = makeSlot<SupportQueueCounts>();

export interface PreviewArgs {
  chargeId: string;
  amountCents: number;
  refundCount: number;
}

export const previewKey = (args: PreviewArgs) =>
  `${args.chargeId}:${args.amountCents}:${args.refundCount}`;

// ── query() ─────────────────────────────────────────────────────────────
export const getSupportCharge = vi.fn((chargeId: string) =>
  slotFor(charges, chargeId)
);
export const searchSupportCharges = vi.fn(
  (args: { lookup: string; page?: number; limit?: number }) =>
    slotFor(searches, `${args.lookup}:${args.page ?? 1}`)
);
export const getRefundPreview = vi.fn((args: PreviewArgs) =>
  slotFor(previews, previewKey(args))
);
export const getSupportQueueCounts = vi.fn(() => counts);
export const listFailedRefunds = vi.fn(
  (args: { page?: number; limit?: number }) =>
    slotFor(failedLists, String(args.page ?? 1))
);
export const listCreatorDebts = vi.fn(
  (args: { page?: number; limit?: number }) =>
    slotFor(debtLists, String(args.page ?? 1))
);
export const listOwedToCreators = vi.fn(
  (args: { page?: number; limit?: number }) =>
    slotFor(owedLists, String(args.page ?? 1))
);
export const listFeeChanges = vi.fn((args: { page?: number; limit?: number }) =>
  slotFor(feeChangeLists, String(args.page ?? 1))
);
export const listFeeNotices = vi.fn((args: { page?: number; limit?: number }) =>
  slotFor(feeNoticeLists, String(args.page ?? 1))
);
export const listHeldPriceMoves = vi.fn(
  (args: { page?: number; limit?: number }) =>
    slotFor(heldMoveLists, String(args.page ?? 1))
);
export const listStoppedPriceChanges = vi.fn(
  (args: { page?: number; limit?: number }) =>
    slotFor(stoppedChangeLists, String(args.page ?? 1))
);

// ── command() ───────────────────────────────────────────────────────────
type IssueInput = {
  chargeId: string;
  amountCents: number;
  reason: string;
  expectedRefundCount: number;
};
type Answer<T> = { outcome: 'done'; result: T } | SupportCommandFailure;

export const issueSupportRefund: Mock<
  (input: IssueInput) => Promise<IssueRefundAnswer>
> = vi.fn();
export const resolveFailedRefund: Mock<
  (input: {
    refundId: string;
    body: { resolution: string; note: string };
  }) => Promise<Answer<ResolvedFailedRefund>>
> = vi.fn();
export const resolveCreatorDebt: Mock<
  (input: {
    reviewId: string;
    body: { resolution: string; note: string };
  }) => Promise<Answer<ResolvedCreatorDebt>>
> = vi.fn();
export const resolveOwedToCreator: Mock<
  (input: {
    creditId: string;
    body: { action: string; note: string };
  }) => Promise<Answer<ResolvedOwedToCreator>>
> = vi.fn();
export const checkOwedToCreator: Mock<
  (input: { creditId: string }) => Promise<Answer<CheckedOwedToCreator>>
> = vi.fn();
export const markToldAnotherWay: Mock<
  (input: {
    noticeId: string;
    body: { note: string };
  }) => Promise<Answer<ToldAnotherWayResult>>
> = vi.fn();
export const retryPriceMove: Mock<
  (input: { moveId: string }) => Promise<Answer<PriceMoveRetried>>
> = vi.fn();
export const closePriceMove: Mock<
  (input: {
    moveId: string;
    body: { resolution: string; note: string };
  }) => Promise<Answer<HeldPriceMove>>
> = vi.fn();
export const restartPriceChange: Mock<
  (input: { changeId: string }) => Promise<Answer<PriceChangeRestarted>>
> = vi.fn();

// ── test controls ───────────────────────────────────────────────────────
export const chargeSlot = (chargeId: string) => slotFor(charges, chargeId);
export const searchSlot = (q: string, page = 1) =>
  slotFor(searches, `${q}:${page}`);
export const previewSlot = (args: PreviewArgs) =>
  slotFor(previews, previewKey(args));
export const failedSlot = (page = 1) => slotFor(failedLists, String(page));
export const debtsSlot = (page = 1) => slotFor(debtLists, String(page));
export const owedSlot = (page = 1) => slotFor(owedLists, String(page));
export const feeChangesSlot = (page = 1) =>
  slotFor(feeChangeLists, String(page));
export const feeNoticesSlot = (page = 1) =>
  slotFor(feeNoticeLists, String(page));
export const heldMovesSlot = (page = 1) => slotFor(heldMoveLists, String(page));
export const stoppedChangesSlot = (page = 1) =>
  slotFor(stoppedChangeLists, String(page));
export const countsSlot = () => counts;
export const previewKeysAsked = () => [...previews.keys()];

/** A command refusal, as `toSupportFailure` builds it. */
export function failure(
  overrides: Partial<SupportCommandFailure> = {}
): SupportCommandFailure {
  return {
    outcome: 'failed',
    status: 422,
    code: 'BUSINESS_LOGIC_ERROR',
    detailsCode: null,
    message: null,
    stripeCode: null,
    closesAt: null,
    refundCount: null,
    maxCents: null,
    disputeStatus: null,
    reason: null,
    voidReason: null,
    voidedAt: null,
    state: null,
    toldAt: null,
    acceptedAt: null,
    toldByName: null,
    ...overrides,
  };
}

/** A rejection as kit delivers it: an HttpError's shape. */
/**
 * A rejected query as kit gives it. The worker's own 404 carries
 * `code: 'NOT_FOUND'` (forwardClientErrors); the remote guard's has none.
 */
export function httpError(
  status: number,
  message = 'Request failed',
  code?: string
) {
  return { status, body: code === undefined ? { message } : { message, code } };
}

export function reset() {
  charges.clear();
  searches.clear();
  previews.clear();
  failedLists.clear();
  debtLists.clear();
  owedLists.clear();
  feeChangeLists.clear();
  feeNoticeLists.clear();
  heldMoveLists.clear();
  stoppedChangeLists.clear();
  counts = makeSlot<SupportQueueCounts>();
  for (const fn of [
    getSupportCharge,
    searchSupportCharges,
    getRefundPreview,
    getSupportQueueCounts,
    listFailedRefunds,
    listCreatorDebts,
    listOwedToCreators,
    listFeeChanges,
    listFeeNotices,
    listHeldPriceMoves,
    listStoppedPriceChanges,
  ]) {
    fn.mockClear();
  }
  issueSupportRefund.mockReset();
  resolveFailedRefund.mockReset();
  resolveCreatorDebt.mockReset();
  resolveOwedToCreator.mockReset();
  checkOwedToCreator.mockReset();
  markToldAnotherWay.mockReset();
  retryPriceMove.mockReset();
  closePriceMove.mockReset();
  restartPriceChange.mockReset();
}
