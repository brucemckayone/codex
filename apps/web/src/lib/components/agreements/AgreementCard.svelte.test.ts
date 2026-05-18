/**
 * AgreementCard unit tests (WP-7 — Codex-s80r6)
 *
 * Verifies prop-driven rendering for each agreement state (none, active,
 * pending) and that action callbacks fire with the correct revenue-type
 * + share arguments. Covers the post-platform copy alignment + the
 * narrowing of the RowState union.
 */

import type { CreatorOrganizationAgreement } from '@codex/agreements';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import AgreementCard from './AgreementCard.svelte';

function makeActiveAgreement(
  overrides: Partial<CreatorOrganizationAgreement> = {}
): CreatorOrganizationAgreement {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    creatorId: '22222222-2222-2222-2222-222222222222',
    organizationId: '33333333-3333-3333-3333-333333333333',
    organizationFeePercentage: 6000, // → creator share 4000 bp = 40%
    revenueType: 'subscription',
    status: 'active',
    currentProposalId: null,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveUntil: null,
    terminatedAt: null,
    terminatedByUserId: null,
    terminationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as CreatorOrganizationAgreement;
}

describe('AgreementCard', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders creator name + no-agreement empty state for both rows', () => {
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex Rivera', avatarUrl: null },
        onPropose: vi.fn(),
        onAmend: vi.fn(),
        onViewThread: vi.fn(),
      },
    });
    expect(document.body.textContent).toContain('Alex Rivera');
    expect(document.body.textContent).toContain('No agreement');
    expect(document.body.textContent).toContain('Subscription');
    expect(document.body.textContent).toContain('Content purchase');
    // Two propose buttons — one per row
    const proposeButtons = Array.from(
      document.body.querySelectorAll('button')
    ).filter((b) => b.textContent?.includes('Propose agreement'));
    expect(proposeButtons.length).toBe(2);
  });

  test('fires onPropose with the row revenueType when Propose clicked', () => {
    const onPropose = vi.fn();
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex', avatarUrl: null },
        onPropose,
        onAmend: vi.fn(),
        onViewThread: vi.fn(),
      },
    });
    const buttons = Array.from(document.body.querySelectorAll('button')).filter(
      (b) => b.textContent?.includes('Propose agreement')
    );
    (buttons[0] as HTMLButtonElement).click();
    flushSync();
    expect(onPropose).toHaveBeenCalledWith('subscription');
    (buttons[1] as HTMLButtonElement).click();
    flushSync();
    expect(onPropose).toHaveBeenCalledWith('content_purchase');
  });

  test('renders share % with post-platform copy when active', () => {
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex', avatarUrl: null },
        subscriptionAgreement: makeActiveAgreement({
          organizationFeePercentage: 7000, // share = 30%
        }),
        onPropose: vi.fn(),
        onAmend: vi.fn(),
        onViewThread: vi.fn(),
      },
    });
    expect(document.body.textContent).toContain('30%');
    expect(document.body.textContent).toContain(
      'post-platform subscription revenue'
    );
    expect(document.body.textContent).toContain('Active');
  });

  test('Amend button passes the current share back as basis points', () => {
    const onAmend = vi.fn();
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex', avatarUrl: null },
        subscriptionAgreement: makeActiveAgreement({
          organizationFeePercentage: 6500, // share = 35%
        }),
        onPropose: vi.fn(),
        onAmend,
        onViewThread: vi.fn(),
      },
    });
    const amend = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Amend'
    ) as HTMLButtonElement;
    expect(amend).toBeDefined();
    amend.click();
    flushSync();
    expect(onAmend).toHaveBeenCalledWith('subscription', 3500); // 10000 - 6500
  });

  test('renders Counter-received state and review button when pending counter waits on owner', () => {
    const onViewThread = vi.fn();
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex', avatarUrl: null },
        pendingSubscriptionProposal: {
          proposalId: 'p1',
          sharePercent: 4000,
          termMonths: 12,
          proposedByRole: 'creator',
          waitingOnRole: 'owner',
          roundNumber: 2,
        },
        onPropose: vi.fn(),
        onAmend: vi.fn(),
        onViewThread,
      },
    });
    expect(document.body.textContent).toContain('Counter received');
    expect(document.body.textContent).toContain('Round 2');
    const review = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Review counter')
    ) as HTMLButtonElement;
    expect(review).toBeDefined();
    review.click();
    flushSync();
    expect(onViewThread).toHaveBeenCalledWith('subscription');
  });

  test('renders Waiting-on-creator state when owner has sent a fresh proposal', () => {
    component = mount(AgreementCard, {
      target: document.body,
      props: {
        creator: { id: 'c1', name: 'Alex', avatarUrl: null },
        pendingContentPurchaseProposal: {
          proposalId: 'p2',
          sharePercent: 3500,
          termMonths: 6,
          proposedByRole: 'owner',
          waitingOnRole: 'creator',
          roundNumber: 1,
        },
        onPropose: vi.fn(),
        onAmend: vi.fn(),
        onViewThread: vi.fn(),
      },
    });
    expect(document.body.textContent).toContain('Waiting on creator');
    expect(document.body.textContent).toContain('Round 1');
    expect(document.body.textContent).toContain('35%');
    expect(document.body.textContent).toContain(
      'post-platform content purchase revenue'
    );
  });
});
