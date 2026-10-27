/**
 * Creator Studio → a negotiation: a refused accept says why (review of
 * Codex-2hxff.76/.77).
 *
 * The server refuses an accept on a thread whose creator can't hold an
 * agreement: a thread opened before the rules, or a creator who has since
 * become the owner. The remote forwards that 422 with its `reason`, and the
 * command rejects with kit's `HttpError`. That is NOT an `Error`, so the toast
 * read `err instanceof Error ? err.message : 'Unknown error'` and always said
 * "Unknown error". It now reads the reason.
 *
 * Mounts the real `+page.svelte` and NegotiationThread; the remote modules
 * and `$app/*` are mocked, as in `load-failed-and-ended.svelte.test.ts`.
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
  acceptAgreement,
  acceptedProposal,
  reset,
  setMyThread,
  setPortfolio,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { toast } from '$lib/components/ui/Toast/toast-store';
import DetailPage from '../+page.svelte';

/** The owner's open offer, waiting on the creator. */
const offer = {
  ...acceptedProposal(),
  status: 'open',
  proposedByRole: 'owner',
} as ReturnType<typeof acceptedProposal>;

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage(`/studio/negotiations/${offer.id}`, { proposalId: offer.id });
  setMyThread([offer]);
  setPortfolio([]);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** The rejection a remote command gives the browser for a forwarded 4xx. */
function refusal(reason: string) {
  try {
    kitError(422, {
      message: 'Refused by the worker',
      code: 'BUSINESS_LOGIC_ERROR',
      reason,
    });
  } catch (rejection) {
    return rejection;
  }
}

const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

describe('a refused accept', () => {
  test.each([
    ['owner', () => m.agreement_refused_owner()],
    ['subscriber', () => m.agreement_refused_subscriber()],
    ['no_creator_account', () => m.agreement_refused_no_creator_account()],
  ])('reason %s is named in the toast', async (reason, copy) => {
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(acceptAgreement).mockRejectedValueOnce(refusal(reason));
    component = mount(DetailPage, {
      target: document.body,
      props: { data: {} } as never,
    });
    flushSync();

    const accept = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Accept'
    );
    expect(accept).toBeDefined();
    accept?.click();
    await settle();

    expect(acceptAgreement).toHaveBeenCalledWith({ proposalId: offer.id });
    expect(toastError).toHaveBeenCalledWith(
      'Could not accept proposal',
      copy()
    );
  });
});
