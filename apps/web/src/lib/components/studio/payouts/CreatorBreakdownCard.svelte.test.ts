/**
 * CreatorBreakdownCard component tests.
 *
 * PR #204 review (cycle 4). Multi-creator org rail surface.
 *
 * Today's covered scenarios:
 *   1. Healthy creator with name+email renders identifiable card (smoke)
 *   2. F-19 REGRESSION (it.fails) — soft-deleted user (name=null, email=null)
 *      must surface SOMETHING identifying so an operator can audit the row.
 *      Currently shows the generic literal "Unknown creator" with no userId,
 *      so two deleted users with outstanding payouts look identical.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$lib/utils/format', () => ({
  formatDate: vi.fn((d: string | Date) =>
    typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  ),
  formatPrice: vi.fn((v: number) => `£${(v / 100).toFixed(2)}`),
  getInitials: vi.fn((name?: string | null, email?: string | null) => {
    if (name) return name.slice(0, 2).toUpperCase();
    if (email) return email.slice(0, 2).toUpperCase();
    return '?';
  }),
}));

import CreatorBreakdownCard from './CreatorBreakdownCard.svelte';

function baseBreakdown(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'usr_test_1',
    name: 'Alice Creator',
    email: 'alice@example.com',
    avatarUrl: null,
    isOrgOwner: false,
    totalPaidCents: 1530,
    purchasePaidCents: 1530,
    subscriptionPaidCents: 0,
    transactionCount: 1,
    needsAttentionCount: 0,
    lastPaidAt: '2026-05-12T12:00:00.000Z',
    ...overrides,
  };
}

describe('CreatorBreakdownCard', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  test('renders identifiable card for a healthy creator (smoke)', () => {
    const result = mount(CreatorBreakdownCard, {
      target: document.body,
      props: { breakdown: baseBreakdown() },
    });
    cleanup = () => unmount(result);

    expect(screen.getByText('Alice Creator')).toBeTruthy();
    expect(screen.getByText('£15.30')).toBeTruthy();
    // Svelte 5 renders `{count} {label}` as separate text nodes; assert against
    // the parent's aggregated textContent rather than getByText (which only
    // sees per-node text). Same pattern as the F-19 sibling test below.
    expect(document.body.textContent ?? '').toMatch(/1\s+transaction/);
  });

  // REGRESSION (PR #204 deep-review F-19, DQ-11) — when a user is soft-deleted
  // from `users` but still has outstanding payouts, the LEFT JOIN in
  // `getPayoutsByCreatorBreakdown` returns `name=null` and `email=null` for
  // their row. The current card falls back to the literal string
  // "Unknown creator" with no further identification, so:
  //
  //   - Two deleted users with outstanding payouts look identical in the rail.
  //   - The operator cannot grep the DB row by what they see on screen.
  //   - Audit / compliance trail is broken: "who is this £270 going to?"
  //
  // Expected: render an identifying fragment (e.g. last 6 chars of userId, or
  //           a "Deleted user (usr_…xyz)" pattern) so the operator can pivot.
  //
  // Marked `it.fails` so CI tracks the bug; when fixed, vitest flips this red
  // and the fixer removes `.fails`.
  test.fails('F-19: shows identifying fragment for soft-deleted creator (currently shows only "Unknown creator")', () => {
    const result = mount(CreatorBreakdownCard, {
      target: document.body,
      props: {
        breakdown: baseBreakdown({
          userId: 'usr_deleted_abc123def456',
          name: null,
          email: null,
          totalPaidCents: 0,
          purchasePaidCents: 0,
          subscriptionPaidCents: 0,
          needsAttentionCount: 1,
          lastPaidAt: null,
        }),
      },
    });
    cleanup = () => unmount(result);

    // Production currently renders only "Unknown creator" + £0.00.
    // Expected: the userId (or a fragment of it) appears somewhere on the
    // card so the operator can match it to the DB row. Today this assertion
    // fails because the userId is never rendered.
    const textContent = document.body.textContent ?? '';
    const showsUserIdFragment =
      textContent.includes('abc123') ||
      textContent.includes('def456') ||
      textContent.includes('usr_deleted');
    expect(showsUserIdFragment).toBe(true);
  });
});
