/**
 * Reactive test double for `$lib/remote/subscription.remote`, as the studio
 * monetisation and subscribers pages read it (Codex-2hxff.45).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. Each
 * query returns a slot built on `$state`, so a test can land an answer or a
 * rejection and watch the page re-render, as in production. A slot nobody
 * has answered is still loading.
 *
 * A rejection mirrors kit's `Query` (2.55, `query.svelte.js` `#run`): it sets
 * `error` and clears `loading`, and NEVER touches the value. So:
 * - `fail()` is a failed FIRST read: nothing landed, `current` is undefined.
 * - `failRefresh()` is a failed RE-read: `current` KEEPS the old answer. A
 *   page that reads "has a value" as "fresh" cannot tell this from success,
 *   which is the case a test of a re-read must model.
 *
 * `refresh` is a spy that resolves at once and changes nothing by itself. A
 * test drives the retry the way kit does: `loading` goes true while `error`
 * stays set, then the answer lands. `deferRefresh()` makes the next refresh a
 * kit-shaped one whose promise settles only when the test lands or fails it.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import { type Mock, vi } from 'vitest';
import type {
  ConnectAccountStatusResponse,
  OrganizationPayoutStatusResponse,
  SubscriptionStats,
  SubscriptionTier,
} from '$lib/types';

export interface QuerySlot<T> {
  current: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: Mock<() => Promise<void>>;
}

function makeSlot<T>(current?: T): QuerySlot<T> {
  const slot = $state<QuerySlot<T>>({
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

/** Land a rejection on a slot, as kit does when its FIRST read fails. */
export function fail<T>(slot: QuerySlot<T>, error: unknown = httpError()) {
  slot.current = undefined;
  slot.error = error;
  slot.loading = false;
}

/**
 * Land a rejection on a slot that already had an answer, as kit does when a
 * RE-read fails: `current` keeps the old value, only `error` changes.
 */
export function failRefresh<T>(
  slot: QuerySlot<T>,
  error: unknown = httpError()
) {
  slot.error = error;
  slot.loading = false;
}

/** Land an answer on a slot, as kit does when the read succeeds. */
export function land<T>(slot: QuerySlot<T>, value: T) {
  slot.current = value;
  slot.error = undefined;
  slot.loading = false;
}

/**
 * Make the slot's NEXT `refresh()` behave as kit's: `loading` goes true (the
 * old `current` and `error` stay), and the returned promise settles only when
 * the test calls `land` (resolves, after the value is set) or `fail` (a
 * failed re-read: rejects, `current` kept). `supersede` is kit settling an
 * OLDER pending refresh once a later one has settled (2.55,
 * `query.svelte.js` #run): it resolves, whatever the later read did, and
 * changes nothing on the slot.
 */
export function deferRefresh<T>(slot: QuerySlot<T>) {
  let settle: { resolve: () => void; reject: (e: unknown) => void } | null =
    null;
  slot.refresh.mockImplementationOnce(() => {
    slot.loading = true;
    return new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
  });
  const pending = () => {
    if (!settle) throw new Error('deferRefresh: refresh() was never called');
    return settle;
  };
  return {
    land(value: T) {
      const { resolve } = pending();
      land(slot, value);
      resolve();
    },
    fail(error: unknown = httpError()) {
      const { reject } = pending();
      failRefresh(slot, error);
      reject(error);
    },
    supersede() {
      pending().resolve();
    },
  };
}

export const ACTIVE_ACCOUNT: ConnectAccountStatusResponse = {
  isConnected: true,
  accountId: 'acct_test_active',
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active',
  requirements: null,
  requirementsFetchFailed: false,
};

export const NO_ACCOUNT: ConnectAccountStatusResponse = {
  isConnected: false,
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  status: null,
  requirements: null,
  requirementsFetchFailed: false,
};

/** Two paying subscribers: the case where a "no account" default also
    raises the "money has nowhere to land" warning. */
export const TWO_SUBSCRIBERS: SubscriptionStats = {
  totalSubscribers: 2,
  activeSubscribers: 2,
  mrrCents: 998,
  tierBreakdown: [],
};

let myConnect = makeSlot<ConnectAccountStatusResponse>();
let orgPayout = makeSlot<OrganizationPayoutStatusResponse>();
let tiers = makeSlot<SubscriptionTier[]>([]);
let stats = makeSlot<SubscriptionStats>(TWO_SUBSCRIBERS);
/**
 * What each tier includes (Codex-2hxff.91). Still loading until a test lands
 * an answer, as a streamed read is in production. The delete-impact and
 * checklist reads key by their argument, so a test can answer each tier (or
 * each page) on its own slot.
 */
let accessSummary = makeSlot<unknown>();
let deleteImpacts = new Map<string, QuerySlot<unknown>>();
let tierItems = new Map<string, QuerySlot<unknown>>();
let subscribers = makeSlot<{
  items: unknown[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}>({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

// ── command() ───────────────────────────────────────────────────────────
export const createTier = vi.fn();
export const updateTier = vi.fn();
export const deleteTier = vi.fn();
export const connectMeOnboard = vi.fn();
export const getMyConnectDashboard = vi.fn();
export const updateSubscriptionFeature = vi.fn();
export const syncMyConnect = vi.fn();
export const setTierItems = vi.fn();

const commands = [
  createTier,
  updateTier,
  deleteTier,
  connectMeOnboard,
  getMyConnectDashboard,
  updateSubscriptionFeature,
  syncMyConnect,
  setTierItems,
];

/** Fresh slots: the Connect reads still loading, the rest answered. */
export function reset() {
  myConnect = makeSlot<ConnectAccountStatusResponse>();
  orgPayout = makeSlot<OrganizationPayoutStatusResponse>();
  tiers = makeSlot<SubscriptionTier[]>([]);
  stats = makeSlot<SubscriptionStats>(TWO_SUBSCRIBERS);
  accessSummary = makeSlot<unknown>();
  deleteImpacts = new Map();
  tierItems = new Map();
  subscribers = makeSlot({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  for (const fn of commands) fn.mockReset();
}

export const myConnectSlot = () => myConnect;
export const orgPayoutSlot = () => orgPayout;
export const tiersSlot = () => tiers;
export const statsSlot = () => stats;
export const accessSummarySlot = () => accessSummary;

/** The delete-impact slot for one tier (made on first read, still loading). */
export function deleteImpactSlot(tierId: string): QuerySlot<unknown> {
  let slot = deleteImpacts.get(tierId);
  if (!slot) {
    slot = makeSlot<unknown>();
    deleteImpacts.set(tierId, slot);
  }
  return slot;
}

/** A checklist page's key: the tier and the query, as the page sends them. */
export const tierItemsKey = (args: { tierId: string; query: unknown }) =>
  `${args.tierId}:${JSON.stringify(args.query)}`;

/** The checklist slot for one tier + query (made on first read, still loading). */
export function tierItemsSlot(key: string): QuerySlot<unknown> {
  let slot = tierItems.get(key);
  if (!slot) {
    slot = makeSlot<unknown>();
    tierItems.set(key, slot);
  }
  return slot;
}

// ── query() ─────────────────────────────────────────────────────────────
export const getMyConnectStatus = vi.fn(() => myConnect);
export const getOrganizationPayoutStatus = vi.fn(
  (_organizationId: string) => orgPayout
);
export const listTiers = vi.fn((_orgId: string) => tiers);
export const getSubscriptionStats = vi.fn((_orgId: string) => stats);
export const getTierAccessSummary = vi.fn((_orgId: string) => accessSummary);
export const getTierDeleteImpact = vi.fn(
  (args: { orgId: string; tierId: string }) => deleteImpactSlot(args.tierId)
);
export const listTierItems = vi.fn(
  (args: { orgId: string; tierId: string; query: unknown }) =>
    tierItemsSlot(tierItemsKey(args))
);
export const listSubscribers = vi.fn((_args: unknown) => subscribers);
