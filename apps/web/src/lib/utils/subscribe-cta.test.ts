import { describe, expect, it } from 'vitest';
import {
  type SubscribeCtaVisibilityInput,
  shouldShowSubscribeCta,
} from './subscribe-cta';

/** A visitor for whom the CTA SHOULD show; each test flips one field. */
function shows(
  overrides: Partial<SubscribeCtaVisibilityInput> = {}
): SubscribeCtaVisibilityInput {
  return {
    hasOrgId: true,
    subscriptionsEnabled: true,
    hasActiveTiers: true,
    accessChecked: true,
    hasOrgAccess: false,
    ...overrides,
  };
}

describe('shouldShowSubscribeCta', () => {
  it('shows for an anonymous visitor when the org has active tiers + subscriptions enabled', () => {
    expect(shouldShowSubscribeCta(shows())).toBe(true);
  });

  // The reported bug: org with nothing to subscribe to still showed the CTA.
  it('hides when the org has no active tiers (the reported bug)', () => {
    expect(shouldShowSubscribeCta(shows({ hasActiveTiers: false }))).toBe(
      false
    );
  });

  it('hides when subscriptions are disabled for the org', () => {
    expect(shouldShowSubscribeCta(shows({ subscriptionsEnabled: false }))).toBe(
      false
    );
  });

  it('hides until access probes have settled (no flash for subscribers)', () => {
    expect(shouldShowSubscribeCta(shows({ accessChecked: false }))).toBe(false);
  });

  it('hides for a visitor who already has access (owner/member/subscriber)', () => {
    expect(shouldShowSubscribeCta(shows({ hasOrgAccess: true }))).toBe(false);
  });

  it('hides when the org is not resolved', () => {
    expect(shouldShowSubscribeCta(shows({ hasOrgId: false }))).toBe(false);
  });
});
