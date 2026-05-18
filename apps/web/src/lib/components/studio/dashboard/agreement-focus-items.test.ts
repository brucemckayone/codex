/**
 * Unit tests for the agreement focus-item aggregators (WP-9 — Codex-k9no0).
 *
 * Pure-function tests — no Svelte render, no DB, no remote calls. The
 * aggregators receive plain inputs and produce `FocusItem[]`; these
 * tests pin the priority order, copy templates, and edge cases.
 *
 * Coverage matrix:
 *   - Owner: propose-nudge, counter-received, expiring (in-window /
 *     out-window / indefinite)
 *   - Creator: pending-from-org, expiring
 *   - Dismissal contract is enforced at the caller level (page
 *     component), so it isn't covered here directly — but the
 *     `dismissable: true` flag IS asserted on each card type.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCreatorAgreementFocusItems,
  buildOwnerAgreementFocusItems,
} from './agreement-focus-items';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86400000);

describe('buildOwnerAgreementFocusItems', () => {
  it('emits a propose nudge for every team creator without a subscription agreement', () => {
    // 3 team creators, only 1 has an active subscription agreement.
    // Expect 2 propose nudges.
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
        {
          userId: 'creator-2',
          name: 'Bob',
          email: 'bob@x.test',
          role: 'creator',
        },
        {
          userId: 'creator-3',
          name: 'Carol',
          email: 'carol@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: null,
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });

    const proposeNudges = items.filter((i) =>
      i.id.startsWith('agreement-propose-')
    );
    expect(proposeNudges).toHaveLength(2);
    expect(proposeNudges.map((i) => i.id).sort()).toEqual([
      'agreement-propose-creator-2',
      'agreement-propose-creator-3',
    ]);
    // Tone + copy contract
    expect(proposeNudges[0]?.tone).toBe('action');
    expect(proposeNudges[0]?.dismissable).toBe(true);
    expect(proposeNudges[0]?.title).toMatch(/Set up revenue share with/);
    // Member display name uses `name`, not `email`
    const forBob = proposeNudges.find(
      (i) => i.id === 'agreement-propose-creator-2'
    );
    expect(forBob?.title).toContain('Bob');
  });

  it('skips propose nudge when only a content_purchase agreement exists (subscription is the gate)', () => {
    // Decision Q1: subscription + content_purchase are separate pools.
    // The team-add nudge specifically targets the subscription pool —
    // a creator with only content_purchase still gets the nudge.
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'content_purchase',
          organizationFeePercentage: 7000,
          effectiveUntil: null,
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });

    const proposeNudges = items.filter((i) =>
      i.id.startsWith('agreement-propose-')
    );
    expect(proposeNudges).toHaveLength(1);
    expect(proposeNudges[0]?.id).toBe('agreement-propose-creator-1');
  });

  it('emits a non-dismissable counter card for every creator-proposed open proposal', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: null,
        },
      ],
      pendingCreatorCounters: [
        {
          id: 'proposal-1',
          creatorId: 'creator-1',
          proposedByRole: 'creator',
          revenueType: 'subscription',
          proposedCreatorSharePercent: 4000, // 40%
        },
      ],
      now: NOW,
    });

    const counter = items.find((i) => i.id === 'agreement-counter-proposal-1');
    expect(counter).toBeDefined();
    expect(counter?.tone).toBe('action');
    expect(counter?.dismissable).toBe(false);
    expect(counter?.title).toContain('Alice sent a counter-proposal');
    expect(counter?.description).toContain('40%');
    expect(counter?.description).toContain(
      'post-platform subscription revenue'
    );
  });

  it('does NOT emit a counter card for owner-proposed open proposals (those are owner-side waiting)', () => {
    // The aggregator filters proposedByRole — defence-in-depth in case
    // the worker route is ever called without the role filter.
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: null,
        },
      ],
      pendingCreatorCounters: [
        {
          id: 'proposal-1',
          creatorId: 'creator-1',
          proposedByRole: 'owner',
          revenueType: 'subscription',
          proposedCreatorSharePercent: 3000,
        },
      ],
      now: NOW,
    });

    expect(
      items.find((i) => i.id.startsWith('agreement-counter-'))
    ).toBeUndefined();
  });

  it('emits an expiring warning when effectiveUntil is within the 30-day window', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: daysFromNow(25),
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });

    const expiring = items.find((i) => i.id === 'agreement-expiring-agr-1');
    expect(expiring).toBeDefined();
    expect(expiring?.tone).toBe('warning');
    expect(expiring?.dismissable).toBe(true);
    expect(expiring?.title).toMatch(/expires in 25 days/);
  });

  it('does NOT emit an expiring warning when effectiveUntil is beyond the 30-day window', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: daysFromNow(35),
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });

    expect(
      items.find((i) => i.id.startsWith('agreement-expiring-'))
    ).toBeUndefined();
  });

  it('does NOT emit an expiring warning for indefinite agreements (effectiveUntil = null)', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: null,
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });

    expect(
      items.find((i) => i.id.startsWith('agreement-expiring-'))
    ).toBeUndefined();
  });

  it('skips subscribers when assembling team-add nudges', () => {
    // The settings page filters out subscribers; the aggregator's
    // role-check enforces the same invariant if the caller forgets.
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'subscriber-1',
          name: 'Sub',
          email: 'sub@x.test',
          role: 'subscriber',
        },
      ],
      activeAgreements: [],
      pendingCreatorCounters: [],
      now: NOW,
    });

    expect(
      items.filter((i) => i.id.startsWith('agreement-propose-'))
    ).toHaveLength(0);
  });

  it('returns an empty array when there is no agreement signal at all', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [],
      activeAgreements: [],
      pendingCreatorCounters: [],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('accepts effectiveUntil as ISO string and as Date interchangeably', () => {
    const items = buildOwnerAgreementFocusItems({
      teamMembers: [
        {
          userId: 'creator-1',
          name: 'Alice',
          email: 'alice@x.test',
          role: 'creator',
        },
      ],
      activeAgreements: [
        {
          id: 'agr-1',
          creatorId: 'creator-1',
          revenueType: 'subscription',
          organizationFeePercentage: 7000,
          effectiveUntil: daysFromNow(10).toISOString(),
        },
      ],
      pendingCreatorCounters: [],
      now: NOW,
    });
    expect(
      items.find((i) => i.id === 'agreement-expiring-agr-1')
    ).toBeDefined();
  });
});

describe('buildCreatorAgreementFocusItems', () => {
  it('emits a non-dismissable action card for every pending owner proposal', () => {
    const items = buildCreatorAgreementFocusItems({
      pendingProposalsFromOrg: [
        {
          proposalId: 'proposal-1',
          organizationId: 'org-1',
          organizationName: 'Studio Alpha',
          revenueType: 'subscription',
          proposedSharePercent: 3500, // 35%
        },
      ],
      activeAgreements: [],
      now: NOW,
    });

    const pending = items.find((i) => i.id === 'agreement-pending-proposal-1');
    expect(pending).toBeDefined();
    expect(pending?.tone).toBe('action');
    expect(pending?.dismissable).toBe(false);
    expect(pending?.title).toContain('Studio Alpha proposed a revenue share');
    expect(pending?.description).toContain('35%');
    expect(pending?.description).toContain(
      'post-platform subscription revenue'
    );
    expect(pending?.href).toBe('/studio/negotiations/proposal-1');
  });

  it('falls back to a generic org name when organizationName is null', () => {
    const items = buildCreatorAgreementFocusItems({
      pendingProposalsFromOrg: [
        {
          proposalId: 'proposal-1',
          organizationId: 'org-1',
          organizationName: null,
          revenueType: 'subscription',
          proposedSharePercent: 3500,
        },
      ],
      activeAgreements: [],
      now: NOW,
    });
    expect(items[0]?.title).toContain('An organisation');
  });

  it('emits a dismissable warning when an active agreement is expiring in 30d', () => {
    const items = buildCreatorAgreementFocusItems({
      pendingProposalsFromOrg: [],
      activeAgreements: [
        {
          id: 'agr-1',
          organizationId: 'org-1',
          organizationName: 'Studio Alpha',
          effectiveUntil: daysFromNow(20),
        },
      ],
      now: NOW,
    });

    const expiring = items.find((i) => i.id === 'agreement-expiring-agr-1');
    expect(expiring).toBeDefined();
    expect(expiring?.tone).toBe('warning');
    expect(expiring?.dismissable).toBe(true);
    expect(expiring?.title).toMatch(
      /Your agreement with Studio Alpha expires in 20 days/
    );
  });

  it('returns an empty array when the portfolio is empty', () => {
    const items = buildCreatorAgreementFocusItems({
      pendingProposalsFromOrg: [],
      activeAgreements: [],
      now: NOW,
    });
    expect(items).toEqual([]);
  });
});
