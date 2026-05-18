/**
 * NegotiationThread unit tests (WP-7 — Codex-s80r6, shared with WP-8)
 *
 * Verifies chronological rendering, status pill coverage, post-platform
 * copy alignment, and that only the latest open proposal renders action
 * buttons (and only those passed in as callbacks).
 */

import type { AgreementProposal } from '@codex/agreements';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import NegotiationThread from './NegotiationThread.svelte';

function makeProposal(
  overrides: Partial<AgreementProposal> = {}
): AgreementProposal {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: '33333333-3333-3333-3333-333333333333',
    creatorId: '22222222-2222-2222-2222-222222222222',
    parentProposalId: null,
    roundNumber: 1,
    revenueType: 'subscription',
    proposedByUserId: '44444444-4444-4444-4444-444444444444',
    proposedByRole: 'owner',
    proposedCreatorSharePercent: 3000,
    proposedTermMonths: 12,
    proposedEffectiveFrom: new Date('2026-01-01T00:00:00Z'),
    note: null,
    status: 'open',
    respondedAt: null,
    respondedByUserId: null,
    declineReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgreementProposal;
}

describe('NegotiationThread', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders empty state when no proposals', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex' },
      },
    });
    expect(document.body.textContent).toContain('No proposals yet');
  });

  test('renders share % with post-platform copy', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [makeProposal({ proposedCreatorSharePercent: 4000 })],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex' },
      },
    });
    expect(document.body.textContent).toContain('40%');
    expect(document.body.textContent).toContain(
      'post-platform subscription revenue'
    );
  });

  test('uses content-purchase label for content_purchase revenue type', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [makeProposal({ revenueType: 'content_purchase' })],
        revenueType: 'content_purchase',
        roleLabels: { owner: 'You', creator: 'Alex' },
      },
    });
    expect(document.body.textContent).toContain(
      'post-platform content-purchase revenue'
    );
  });

  test('renders proposer label from roleLabels', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [makeProposal({ proposedByRole: 'creator' })],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex Rivera' },
      },
    });
    expect(document.body.textContent).toContain('Alex Rivera');
  });

  test('renders only the latest open proposal as actionable', () => {
    const onAccept = vi.fn();
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [
          makeProposal({
            id: 'p1',
            roundNumber: 1,
            status: 'countered',
            proposedByRole: 'owner',
          }),
          makeProposal({
            id: 'p2',
            roundNumber: 2,
            status: 'open',
            parentProposalId: 'p1',
            proposedByRole: 'creator',
            proposedCreatorSharePercent: 4500,
          }),
        ],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex' },
        onAccept,
      },
    });
    const acceptButtons = Array.from(
      document.body.querySelectorAll('button')
    ).filter((b) => b.textContent?.trim() === 'Accept');
    expect(acceptButtons.length).toBe(1); // only the latest open one
    acceptButtons[0].click();
    flushSync();
    expect(onAccept).toHaveBeenCalledWith('p2');
  });

  test('does not render action buttons when no callbacks are provided', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [makeProposal()],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex' },
      },
    });
    const buttons = Array.from(document.body.querySelectorAll('button'));
    expect(buttons.length).toBe(0);
  });

  test('renders decline reason when status is declined', () => {
    component = mount(NegotiationThread, {
      target: document.body,
      props: {
        proposals: [
          makeProposal({
            status: 'declined',
            declineReason: 'Below our minimum margin',
          }),
        ],
        revenueType: 'subscription',
        roleLabels: { owner: 'You', creator: 'Alex' },
      },
    });
    expect(document.body.textContent).toContain('Decline reason');
    expect(document.body.textContent).toContain('Below our minimum margin');
  });
});
