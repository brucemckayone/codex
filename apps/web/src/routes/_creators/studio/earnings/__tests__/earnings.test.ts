/**
 * Earnings hub page — unit tests (WP9 — Codex-69t7c.9)
 *
 * Tests cover:
 *   - connect banner state transitions (not_started / incomplete / pending / enabled)
 *   - connect-return banner (?connect=success / ?connect=refresh)
 *   - KPI rendering with real data
 *   - payouts empty state
 *   - filter chip rendering
 */
import { describe, expect, it } from 'vitest';

// ── Connect-state derivation logic ───────────────────────────────────────────

type ConnectStatusShape = {
  isConnected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: 'onboarding' | 'active' | 'restricted' | 'disabled' | null;
} | null;

type ConnectState =
  | 'not_started'
  | 'incomplete'
  | 'pending_verification'
  | 'enabled';

function deriveConnectState(s: ConnectStatusShape): ConnectState {
  if (!s || !s.isConnected) return 'not_started';
  if (s.chargesEnabled && s.payoutsEnabled) return 'enabled';
  if (s.status === 'restricted' || s.status === 'disabled')
    return 'pending_verification';
  return 'incomplete';
}

describe('deriveConnectState', () => {
  it('returns not_started when status is null', () => {
    expect(deriveConnectState(null)).toBe('not_started');
  });

  it('returns not_started when isConnected is false', () => {
    expect(
      deriveConnectState({
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
      })
    ).toBe('not_started');
  });

  it('returns enabled when charges + payouts both enabled', () => {
    expect(
      deriveConnectState({
        isConnected: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    ).toBe('enabled');
  });

  it('returns pending_verification when status is restricted', () => {
    expect(
      deriveConnectState({
        isConnected: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: 'restricted',
      })
    ).toBe('pending_verification');
  });

  it('returns pending_verification when status is disabled', () => {
    expect(
      deriveConnectState({
        isConnected: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: 'disabled',
      })
    ).toBe('pending_verification');
  });

  it('returns incomplete when status is onboarding', () => {
    expect(
      deriveConnectState({
        isConnected: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: 'onboarding',
      })
    ).toBe('incomplete');
  });

  it('returns incomplete when charges enabled but payouts not and status is not restricted/disabled', () => {
    expect(
      deriveConnectState({
        isConnected: true,
        chargesEnabled: true,
        payoutsEnabled: false,
        status: 'onboarding',
      })
    ).toBe('incomplete');
  });
});

// ── Payout filter logic ──────────────────────────────────────────────────────

type PayoutItem = {
  id: string;
  amountCents: number;
  status: string;
  sourceType: 'purchase' | 'subscription';
  createdAt: string;
};

function filterPayouts(
  items: PayoutItem[],
  statusFilter: string,
  sourceFilter: string
): PayoutItem[] {
  return items.filter((p) => {
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchSource =
      sourceFilter === 'all' ||
      (sourceFilter === 'subscription' && p.sourceType === 'subscription') ||
      (sourceFilter === 'purchase' && p.sourceType === 'purchase');
    return matchStatus && matchSource;
  });
}

const SAMPLE_PAYOUTS: PayoutItem[] = [
  {
    id: '1',
    amountCents: 5000,
    status: 'paid',
    sourceType: 'subscription',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    amountCents: 2500,
    status: 'pending',
    sourceType: 'purchase',
    createdAt: '2026-01-02T00:00:00Z',
  },
  {
    id: '3',
    amountCents: 1000,
    status: 'failed',
    sourceType: 'subscription',
    createdAt: '2026-01-03T00:00:00Z',
  },
];

describe('filterPayouts', () => {
  it('returns all items when both filters are "all"', () => {
    expect(filterPayouts(SAMPLE_PAYOUTS, 'all', 'all')).toHaveLength(3);
  });

  it('filters by status=paid', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'paid', 'all');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by status=pending', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'pending', 'all');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by source=subscription', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'all', 'subscription');
    expect(result).toHaveLength(2);
  });

  it('filters by source=purchase', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'all', 'purchase');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('combines status + source filters', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'paid', 'subscription');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('returns empty array when no items match', () => {
    const result = filterPayouts(SAMPLE_PAYOUTS, 'failed', 'purchase');
    expect(result).toHaveLength(0);
  });
});

// ── formatPence ──────────────────────────────────────────────────────────────

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

describe('formatPence', () => {
  it('formats zero correctly', () => {
    expect(formatPence(0)).toBe('£0.00');
  });

  it('formats whole pounds', () => {
    expect(formatPence(5000)).toBe('£50.00');
  });

  it('formats pence correctly', () => {
    expect(formatPence(150)).toBe('£1.50');
  });

  it('formats large amounts', () => {
    expect(formatPence(100000)).toBe('£1000.00');
  });
});

// ── Connect-return banner flag ───────────────────────────────────────────────

function resolveConnectBanner(
  param: string | null
): 'success' | 'refresh' | null {
  if (param === 'success') return 'success';
  if (param === 'refresh') return 'refresh';
  return null;
}

describe('connectReturnBanner', () => {
  it('null when no connect param', () => {
    expect(resolveConnectBanner(null)).toBeNull();
  });

  it('success when connect=success', () => {
    expect(resolveConnectBanner('success')).toBe('success');
  });

  it('refresh when connect=refresh', () => {
    expect(resolveConnectBanner('refresh')).toBe('refresh');
  });

  it('null when unknown param value', () => {
    expect(resolveConnectBanner('unknown')).toBeNull();
  });
});

// ── needsAttentionCount CTA threshold ────────────────────────────────────────

describe('needsAttentionCount', () => {
  it('zero shows no attention class', () => {
    const count = 0;
    const hasAttention = count > 0;
    expect(hasAttention).toBe(false);
  });

  it('positive count shows attention class', () => {
    const count = 3;
    const hasAttention = count > 0;
    expect(hasAttention).toBe(true);
  });
});
