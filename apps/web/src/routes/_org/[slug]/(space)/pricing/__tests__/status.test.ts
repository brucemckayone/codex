/**
 * Pricing page status-helper tests.
 *
 * Covers the UX matrix from Codex-7b6tp:
 *   cancelAtPeriodEnd=true OR status='cancelling' → 'cancelling'
 *   status='past_due'                             → 'past_due'
 *   status='paused'                               → 'paused'
 *   otherwise + has tier                          → 'active'
 *   no tier                                       → null
 *
 * And the per-status CTA mapping (badge + primary action + manage link).
 */

import { describe, expect, it } from 'vitest';
import { getCurrentTierCta, getEffectiveStatus } from '../status';

describe('getEffectiveStatus', () => {
  it('returns null when the user has no current subscription', () => {
    expect(
      getEffectiveStatus({
        currentTierId: null,
        status: null,
        cancelAtPeriodEnd: false,
      })
    ).toBeNull();
  });

  it("returns 'active' when the user is subscribed and status is active", () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        status: 'active',
        cancelAtPeriodEnd: false,
      })
    ).toBe('active');
  });

  it("returns 'cancelling' when cancelAtPeriodEnd is true (regardless of status)", () => {
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

  it("prefers 'cancelling' over 'past_due' when both are set (cancelAtPeriodEnd wins)", () => {
    // A subscription in past_due state that has also been cancelled should
    // surface the cancelling badge — the user needs to reactivate more than
    // they need to update payment, because a cancelled card won't be retried.
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

  it('treats an unknown status as active (graceful fallback)', () => {
    expect(
      getEffectiveStatus({
        currentTierId: 'tier-1',
        // e.g. a future backend-only value — don't crash, just keep the user in
        // the active-plan UI so they can always find Manage Plan.
        status: 'trialing',
        cancelAtPeriodEnd: false,
      })
    ).toBe('active');
  });
});

describe('getCurrentTierCta', () => {
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
