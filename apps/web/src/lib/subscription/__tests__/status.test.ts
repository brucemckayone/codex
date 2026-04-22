/**
 * Shared subscription-status helper tests.
 *
 * Mirrors the pricing-page route-level tests (see
 * routes/_org/[slug]/(space)/pricing/__tests__/status.test.ts), but targets
 * the shared $lib/subscription/status module that now owns the logic.
 *
 * Additional coverage beyond the pricing test:
 *   - empty-string status (defensive: API shouldn't emit this, but we accept it)
 *   - cancelAtPeriodEnd wins over paused (cancellation is terminal)
 */

import { describe, expect, it } from 'vitest';
import { getCurrentTierCta, getEffectiveStatus } from '../status';

describe('shared getEffectiveStatus', () => {
  it('returns null when the user has no current subscription', () => {
    expect(
      getEffectiveStatus({
        currentTierId: null,
        status: null,
        cancelAtPeriodEnd: false,
      })
    ).toBeNull();
  });

  it("returns 'active' when the user has a tier and status is active", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'active',
        cancelAtPeriodEnd: false,
      })
    ).toBe('active');
  });

  it("returns 'cancelling' when cancelAtPeriodEnd is true", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'active',
        cancelAtPeriodEnd: true,
      })
    ).toBe('cancelling');
  });

  it("returns 'cancelling' when status is literally 'cancelling'", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'cancelling',
        cancelAtPeriodEnd: false,
      })
    ).toBe('cancelling');
  });

  it("returns 'past_due' when status is 'past_due' and not cancelling", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'past_due',
        cancelAtPeriodEnd: false,
      })
    ).toBe('past_due');
  });

  it("prefers 'cancelling' over 'past_due' when both are set", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'past_due',
        cancelAtPeriodEnd: true,
      })
    ).toBe('cancelling');
  });

  it("returns 'paused' when status is 'paused'", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'paused',
        cancelAtPeriodEnd: false,
      })
    ).toBe('paused');
  });

  it("prefers 'cancelling' over 'paused' when both are set (cancellation is terminal)", () => {
    // A cancelled+paused row should surface Reactivate; the pause is moot
    // once the billing period ends. Behaviour symmetric with past_due.
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'paused',
        cancelAtPeriodEnd: true,
      })
    ).toBe('cancelling');
  });

  it('treats an unknown status as active (graceful fallback)', () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'trialing',
        cancelAtPeriodEnd: false,
      })
    ).toBe('active');
  });

  it('treats an empty-string status as active when a tier is set (defensive)', () => {
    // API shouldn't emit '' but if it does, the user clearly has a row —
    // don't null them out and lose the Manage plan surface.
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: '',
        cancelAtPeriodEnd: false,
      })
    ).toBe('active');
  });
});

describe('shared getCurrentTierCta', () => {
  it('active → disabled current + manage link', () => {
    const cta = getCurrentTierCta('active');
    expect(cta.primary.kind).toBe('current');
    expect(cta.primary.disabled).toBe(true);
    expect(cta.showManageLink).toBe(true);
  });

  it('cancelling → reactivate primary + manage link', () => {
    const cta = getCurrentTierCta('cancelling');
    expect(cta.primary.kind).toBe('reactivate');
    expect(cta.primary.disabled).toBe(false);
    expect(cta.showManageLink).toBe(true);
  });

  it('past_due → update-payment primary + manage link', () => {
    const cta = getCurrentTierCta('past_due');
    expect(cta.primary.kind).toBe('update-payment');
    expect(cta.primary.disabled).toBe(false);
    expect(cta.showManageLink).toBe(true);
  });

  it('paused → resume primary (interactive — Codex-7h4vo) + manage link', () => {
    const cta = getCurrentTierCta('paused');
    expect(cta.primary.kind).toBe('resume');
    // Codex-7h4vo: backend endpoint + remote fn shipped — button is now
    // interactive (no longer a disabled placeholder).
    expect(cta.primary.disabled).toBe(false);
    expect(cta.showManageLink).toBe(true);
  });
});
