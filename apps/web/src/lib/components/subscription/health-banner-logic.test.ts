/**
 * HealthBanner logic tests
 *
 * Pure derivation rules extracted from HealthBanner.svelte. The component
 * itself composes these with `useLiveQuery` + sessionStorage dismissal;
 * here we only assert the state-math.
 */
import { describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '$lib/collections';
import {
  ATTENTION_STATUSES,
  deriveBannerVariant,
  filterAttentionSubs,
  isAttentionStatus,
} from './health-banner-logic';

/** Helper: build a SubscriptionItem with sensible defaults. */
function sub(
  overrides: Partial<SubscriptionItem> & { status: SubscriptionItem['status'] }
): SubscriptionItem {
  return {
    organizationId: 'org-1',
    organizationSlug: 'org-1',
    tier: { id: 'tier-1', name: 'Pro', sortOrder: 1 },
    currentPeriodEnd: '2026-12-31T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('health-banner-logic', () => {
  describe('ATTENTION_STATUSES', () => {
    it('covers exactly past_due and paused (no more, no less)', () => {
      // A regression guard: widening this silently surfaces banners for
      // states the user cannot self-service (cancelled, incomplete);
      // narrowing it drops the banner for a real attention case.
      expect([...ATTENTION_STATUSES]).toEqual(['past_due', 'paused']);
    });
  });

  describe('isAttentionStatus', () => {
    it.each([
      ['past_due', true],
      ['paused', true],
      ['active', false],
      ['cancelling', false],
      ['cancelled', false],
      ['incomplete', false],
    ] as const)('returns %s for status="%s"', (status, expected) => {
      expect(isAttentionStatus(status)).toBe(expected);
    });
  });

  describe('filterAttentionSubs', () => {
    it('returns only past_due and paused entries, preserving order', () => {
      const input: SubscriptionItem[] = [
        sub({ organizationId: 'a', status: 'active' }),
        sub({ organizationId: 'b', status: 'past_due' }),
        sub({ organizationId: 'c', status: 'cancelling' }),
        sub({ organizationId: 'd', status: 'paused' }),
      ];
      const result = filterAttentionSubs(input);
      expect(result.map((s) => s.organizationId)).toEqual(['b', 'd']);
    });

    it('returns empty array when no subscriptions need attention', () => {
      const input: SubscriptionItem[] = [
        sub({ organizationId: 'a', status: 'active' }),
        sub({ organizationId: 'b', status: 'cancelling' }),
      ];
      expect(filterAttentionSubs(input)).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(filterAttentionSubs([])).toEqual([]);
    });
  });

  describe('deriveBannerVariant', () => {
    it('paints error when any subscription is past_due (dunning is urgent)', () => {
      expect(deriveBannerVariant([sub({ status: 'past_due' })])).toBe('error');
    });

    it('paints warning when only paused subscriptions are present', () => {
      expect(deriveBannerVariant([sub({ status: 'paused' })])).toBe('warning');
    });

    it('paints error when mixed — past_due floors to more severe case', () => {
      expect(
        deriveBannerVariant([
          sub({ organizationId: 'a', status: 'paused' }),
          sub({ organizationId: 'b', status: 'past_due' }),
        ])
      ).toBe('error');
    });

    it('returns warning for an empty list (component gates visibility separately)', () => {
      // Component checks attentionSubs.length > 0 before rendering, so this
      // branch is never user-visible — but we still assert the default so
      // future refactors don't silently change the fallback.
      expect(deriveBannerVariant([])).toBe('warning');
    });
  });
});
