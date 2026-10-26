/**
 * Reactive test double for `$lib/remote/subscription.remote`, as the studio
 * monetisation and subscribers pages read it (Codex-2hxff.45).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. Each
 * query returns a slot built on `$state`, so a test can land an answer or a
 * rejection and watch the page re-render, as in production. A rejected slot
 * mirrors kit's `Query`: `current` stays undefined, `error` is set, `loading`
 * is false. A slot nobody has answered is still loading.
 *
 * `refresh` is a spy that changes nothing by itself. A test drives the retry
 * the way kit does: `loading` goes true while `error` stays set, then the
 * answer lands.
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

/** Land a rejection on a slot, as kit does when the read fails. */
export function fail<T>(slot: QuerySlot<T>, error: unknown = httpError()) {
  slot.current = undefined;
  slot.error = error;
  slot.loading = false;
}

/** Land an answer on a slot, as kit does when the read succeeds. */
export function land<T>(slot: QuerySlot<T>, value: T) {
  slot.current = value;
  slot.error = undefined;
  slot.loading = false;
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

const commands = [
  createTier,
  updateTier,
  deleteTier,
  connectMeOnboard,
  getMyConnectDashboard,
  updateSubscriptionFeature,
  syncMyConnect,
];

/** Fresh slots: the Connect reads still loading, the rest answered. */
export function reset() {
  myConnect = makeSlot<ConnectAccountStatusResponse>();
  orgPayout = makeSlot<OrganizationPayoutStatusResponse>();
  tiers = makeSlot<SubscriptionTier[]>([]);
  stats = makeSlot<SubscriptionStats>(TWO_SUBSCRIBERS);
  subscribers = makeSlot({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  for (const fn of commands) fn.mockReset();
}

export const myConnectSlot = () => myConnect;
export const orgPayoutSlot = () => orgPayout;
export const tiersSlot = () => tiers;

// ── query() ─────────────────────────────────────────────────────────────
export const getMyConnectStatus = vi.fn(() => myConnect);
export const getOrganizationPayoutStatus = vi.fn(
  (_organizationId: string) => orgPayout
);
export const listTiers = vi.fn((_orgId: string) => tiers);
export const getSubscriptionStats = vi.fn((_orgId: string) => stats);
export const listSubscribers = vi.fn((_args: unknown) => subscribers);
