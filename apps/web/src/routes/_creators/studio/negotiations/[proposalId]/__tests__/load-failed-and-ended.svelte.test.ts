/**
 * Creator studio → Negotiation detail, where every creator agreement email but
 * a decline now lands (Codex-2hxff.20 AGR-10):
 *
 * - a failed PORTFOLIO read used to draw the bar from partial data: the other
 *   creators vanished, the organisation got their share, the pill said
 *   "Accepted" and Terminate was gone, all silently. Now "We couldn't load
 *   this agreement." with Retry stands in for the header, split and Terminate.
 * - a failed THREAD read used to say "You don't have access … may have been
 *   removed". That is now kept for a 403 or 404; anything else is "We
 *   couldn't load this negotiation." with Retry.
 * - an ENDED agreement (the terminate email's landing) used to read
 *   "Accepted" over a live split. It now says "Ended", with the date, and
 *   draws no split.
 *
 * Mounts the real `+page.svelte` and pie; `$app/*` and the remote module are
 * mocked.
 */

import { error as kitError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);

import {
  acceptedProposal,
  fail,
  httpError,
  myThreadSlot,
  ORG_ID,
  portfolioActiveRow,
  portfolioSlot,
  reset,
  setMyThread,
  setPortfolio,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import DetailPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;
const proposal = acceptedProposal();

beforeEach(() => {
  reset();
  setPage(`/studio/negotiations/${proposal.id}`, { proposalId: proposal.id });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(DetailPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const pill = () =>
  q('.agreement-detail__status-pill')?.textContent?.trim() ?? null;
const NO_ACCESS = "You don't have access to this agreement";

/**
 * What `getMyAgreementThread` rejects with on a worker 403/404: the
 * `HttpError` that `forwardClientErrors` throws through kit's `error()`.
 * `lib/remote/agreements-thread-forwarding.test.ts` pins that the remote
 * produces exactly this from the worker's real answer (review N1: a
 * pre-shaped `{ status }` here once hid that it reached the browser as a
 * sanitised 500).
 */
function remoteRefusal(status: 403 | 404): unknown {
  try {
    kitError(status, {
      message: 'Proposal thread not found',
      code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
    });
  } catch (refusal) {
    return refusal;
  }
}

describe('a failed portfolio read', () => {
  function mountWithPortfolioFailed() {
    setMyThread([proposal]);
    mountPage();
    fail(portfolioSlot());
    flushSync();
  }

  test('says it could not load the agreement, with Retry', () => {
    mountWithPortfolioFailed();
    const alert = q('[data-testid="portfolio-load-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.agreement_detail_load_failed());
  });

  test('draws no bar from partial data, claims no status and offers no Terminate', () => {
    mountWithPortfolioFailed();
    // Without the portfolio the peers are unknown: drawn anyway, their share
    // went to the organisation.
    expect(q('.revenue-split-pie')).toBeNull();
    expect(pill()).toBeNull();
    expect(text()).not.toContain('Terminate agreement');
    expect(text()).not.toContain(NO_ACCESS);
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountWithPortfolioFailed();
    expect(error).toHaveBeenCalledWith(
      'creator-studio/negotiation: portfolio failed to load',
      expect.objectContaining({ proposalId: proposal.id })
    );
  });
});

describe('a failed thread read', () => {
  test('a 500 is a load error with Retry, never "no access"', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    setPortfolio([portfolioActiveRow()]);
    mountPage();
    fail(myThreadSlot(), httpError(500));
    flushSync();

    expect(q('[data-testid="thread-load-error"]')?.textContent).toContain(
      m.agreement_thread_load_failed()
    );
    expect(text()).not.toContain(NO_ACCESS);
    expect(error).toHaveBeenCalledWith(
      'creator-studio/negotiation: thread failed to load',
      expect.objectContaining({ proposalId: proposal.id })
    );
  });

  test('a 404 is "no access", with no load error', () => {
    setPortfolio([portfolioActiveRow()]);
    mountPage();
    fail(myThreadSlot(), remoteRefusal(404));
    flushSync();

    expect(text()).toContain(NO_ACCESS);
    expect(q('[data-testid="thread-load-error"]')).toBeNull();
  });

  test('a 403 is "no access" too', () => {
    setPortfolio([portfolioActiveRow()]);
    mountPage();
    fail(myThreadSlot(), remoteRefusal(403));
    flushSync();

    expect(text()).toContain(NO_ACCESS);
  });
});

describe('an agreement that has ended (the terminate email lands here)', () => {
  function mountEnded() {
    setMyThread([proposal]);
    const slot = portfolioSlot();
    slot.current = {
      active: [],
      pendingActionRequired: [],
      pendingWaitingOnOrg: [],
      past: [
        {
          proposalId: proposal.id,
          organizationId: ORG_ID,
          organizationName: 'Studio Alpha',
          revenueType: 'subscription',
          status: 'terminated',
          proposedSharePercent: 4000,
          proposedByRole: 'owner',
          roundNumber: 1,
          endedAt: '2026-10-20T09:00:00.000Z',
          declineReason: null,
        },
      ],
    };
    slot.error = undefined;
    slot.loading = false;
    mountPage();
  }

  test('the pill says "Ended" with the date, never "Accepted"', () => {
    mountEnded();
    // The history below still shows the proposal as accepted: that is true.
    expect(pill()).toBe(m.agreement_ended());
    expect(text()).toContain(m.agreement_ended_on({ date: '2026-10-20' }));
  });

  test('draws no live split', () => {
    mountEnded();
    expect(q('.revenue-split-pie')).toBeNull();
    expect(q('[data-testid="agreement-ended-note"]')?.textContent?.trim()).toBe(
      m.agreement_ended_note()
    );
  });
});

test('an active agreement still reads "Active" with its bar (negative control)', () => {
  setMyThread([proposal]);
  setPortfolio([portfolioActiveRow()]);
  mountPage();

  expect(pill()).toBe('Active');
  expect(q('.revenue-split-pie')).not.toBeNull();
  expect(text()).toContain('Terminate agreement');
});
