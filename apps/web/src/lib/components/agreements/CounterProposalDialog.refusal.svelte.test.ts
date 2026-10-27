/**
 * A refused counter says why, in plain words (review of Codex-2hxff.76/.77).
 *
 * The server refuses a counter on a thread whose creator can't hold an
 * agreement: the owner, a subscriber, or an account without a creator role.
 * The remote forwards that 422 with its `reason`, and the command rejects
 * with kit's `HttpError`. That is NOT an `Error`, so the dialog's
 * `err instanceof Error ? err.message : …` always said "Failed to send
 * counter". It now reads the reason, and otherwise the forwarded message.
 */

import { error as kitError } from '@sveltejs/kit';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import CounterProposalDialog from './CounterProposalDialog.svelte';

/** The rejection a remote command gives the browser for a forwarded 4xx. */
function refusal(body: { message: string; code?: string; reason?: string }) {
  try {
    kitError(422, body);
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

describe('CounterProposalDialog: a refused counter', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  async function submitRejectedWith(rejection: unknown) {
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: true,
        onOpenChange: vi.fn(),
        currentSharePercent: 4000,
        currentTermMonths: 12,
        ownerName: 'Acme Studio',
        revenueType: 'subscription',
        onSubmit: vi.fn(async () => {
          throw rejection;
        }),
      },
    });
    flushSync();
    // A counter must change the offer, or the dialog refuses it before
    // submitting: move the share off the owner's 40%.
    const slider = document.querySelector<HTMLInputElement>(
      'input[type="range"]'
    );
    expect(slider).not.toBeNull();
    if (slider) {
      slider.value = '45';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    flushSync();
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await settle();
    return document.body.textContent ?? '';
  }

  test.each([
    ['owner', () => m.agreement_refused_owner()],
    ['subscriber', () => m.agreement_refused_subscriber()],
    ['no_creator_account', () => m.agreement_refused_no_creator_account()],
  ])('reason %s is named in plain words', async (reason, copy) => {
    const text = await submitRejectedWith(
      refusal({
        message: 'Refused by the worker',
        code: 'BUSINESS_LOGIC_ERROR',
        reason,
      })
    );
    expect(text).toContain(copy());
    expect(text).not.toContain('Failed to send counter');
  });

  test("another refusal shows the worker's message", async () => {
    const text = await submitRejectedWith(
      refusal({ message: 'Only open proposals can be countered' })
    );
    expect(text).toContain('Only open proposals can be countered');
    expect(text).not.toContain('Failed to send counter');
  });
});
