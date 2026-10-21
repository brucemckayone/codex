/**
 * Reactive test double for `$lib/remote/admin.remote` (Codex-2hxff.21).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom. The
 * grants query double reads `$state`, so a test can land a new list (the
 * result of a refresh, say) and watch the drawer re-render as it does in
 * production. `error` mirrors a REJECTED kit query: `current` stays
 * undefined and the rejection sits on `error`, with `loading` false.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import type { CustomerDetails } from '@codex/admin';
import type { PaginatedListResponse } from '@codex/shared-types';
import { vi } from 'vitest';
import type { CustomerGrant } from '$lib/types';

type GrantsPage = PaginatedListResponse<CustomerGrant>;

const state = $state<{ grants: GrantsPage | undefined; error: unknown }>({
  grants: undefined,
  error: undefined,
});

export function grantsPage(items: CustomerGrant[]): GrantsPage {
  return {
    items,
    pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 },
  };
}

// ── query() ─────────────────────────────────────────────────────────────
type DetailInput = { customerId: string; organizationId: string };
type GrantsInput = DetailInput & { page?: number; limit?: number };

export const getCustomerDetail = vi.fn(
  async (_input: DetailInput): Promise<CustomerDetails> => {
    throw new Error('getCustomerDetail: no customer set');
  }
);

export const refreshGrants = vi.fn(async () => {});

export const getCustomerGrants = vi.fn((_input: GrantsInput) => ({
  get current() {
    return state.grants;
  },
  get error() {
    return state.error;
  },
  get loading() {
    return state.grants === undefined && state.error === undefined;
  },
  refresh: refreshGrants,
}));

// ── command() ───────────────────────────────────────────────────────────
export const revokeCustomerGrant = vi.fn(
  async (_input: {
    customerId: string;
    entitlementId: string;
    organizationId: string;
  }) => null
);

export const grantContentAccess = vi.fn(
  async (_input: {
    customerId: string;
    contentId: string;
    organizationId: string;
  }): Promise<unknown> => ({ success: true })
);

// ── test controls ───────────────────────────────────────────────────────
export function setGrants(page: GrantsPage) {
  state.grants = page;
  state.error = undefined;
}

export function setGrantsError(error: unknown) {
  state.grants = undefined;
  state.error = error;
}

export function reset() {
  state.grants = undefined;
  state.error = undefined;
  getCustomerDetail.mockReset();
  getCustomerGrants.mockClear();
  refreshGrants.mockReset();
  refreshGrants.mockResolvedValue(undefined);
  revokeCustomerGrant.mockReset();
  revokeCustomerGrant.mockResolvedValue(null);
  grantContentAccess.mockReset();
  grantContentAccess.mockResolvedValue({ success: true });
}
