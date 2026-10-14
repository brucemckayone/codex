/**
 * OwnershipOfferDialog — choose who (state 2), then confirm by typing the
 * organisation's name (state 3, variant A). Codex-2hxff.2.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { OwnershipEligibleRecipient } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import OwnershipOfferDialog from './OwnershipOfferDialog.svelte';

const ORG_NAME = 'Studio Alpha';

const JORDAN: OwnershipEligibleRecipient = {
  userId: 'jordan',
  name: 'Jordan Lee',
  role: 'admin',
  joinedAt: '2026-04-01T00:00:00.000Z',
  payoutsReady: true,
};
const SAM: OwnershipEligibleRecipient = {
  userId: 'sam',
  name: 'Sam Patel',
  role: 'creator',
  joinedAt: '2026-06-01T00:00:00.000Z',
  payoutsReady: false,
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function open(
  props: Partial<{
    recipients: OwnershipEligibleRecipient[];
    ownerHasSubscriptionAgreement: boolean;
    onSubmit: (id: string, name: string) => Promise<void>;
  }> = {}
) {
  const onSubmit = props.onSubmit ?? vi.fn(async () => {});
  component = mount(OwnershipOfferDialog, {
    target: document.body,
    props: {
      open: true,
      orgName: ORG_NAME,
      recipients: props.recipients ?? [JORDAN, SAM],
      ownerHasSubscriptionAgreement:
        props.ownerHasSubscriptionAgreement ?? false,
      onSubmit,
      errorMessage: () => 'Mapped error copy',
    },
  });
  flushSync();
  return { onSubmit };
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.dialog-content');
  if (!el) throw new Error('dialog not open');
  return el;
}

function text(): string {
  return dialog().textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
}

function choose(userId: string) {
  const radio = dialog().querySelector<HTMLInputElement>(
    `input[type="radio"][value="${userId}"]`
  );
  if (!radio) throw new Error(`no radio for ${userId}`);
  radio.click();
  flushSync();
}

function typeName(value: string) {
  const input = dialog().querySelector<HTMLInputElement>(
    '#ownership-confirm-name'
  );
  if (!input) throw new Error('name field not rendered');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function toConfirm(userId: string) {
  choose(userId);
  button(m.ownership_choose_continue())?.click();
  flushSync();
}

/** Submit the confirm step the way Enter or the Send button does. */
function send() {
  const form = dialog().querySelector('form');
  if (!form) throw new Error('confirm form not rendered');
  form.requestSubmit();
  flushSync();
}

describe('state 2: choose who', () => {
  test('lists every eligible admin and creator with their payouts status', () => {
    open();
    expect(text()).toContain(m.ownership_choose_title({ orgName: ORG_NAME }));
    expect(dialog().querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(text()).toContain('Jordan Lee');
    expect(text()).toContain('Sam Patel');
    expect(text()).toContain(m.ownership_payouts_ready());
    expect(text()).toContain(m.ownership_payouts_not_ready());
    expect(text()).toContain(m.ownership_choose_note());
  });

  test('Continue waits for a choice', () => {
    open();
    expect(button(m.ownership_choose_continue())?.disabled).toBe(true);
    choose('sam');
    expect(button(m.ownership_choose_continue())?.disabled).toBe(false);
  });

  test('empty: nobody eligible, so point at the Team page', () => {
    open({ recipients: [] });
    expect(text()).toContain(m.ownership_choose_empty_title());
    expect(dialog().querySelectorAll('input[type="radio"]')).toHaveLength(0);
    const team = [...dialog().querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === m.ownership_choose_go_to_team()
    );
    expect(team?.getAttribute('href')).toBe('/studio/team');
  });
});

describe('state 3: confirm — type the organisation name', () => {
  test('states every consequence for the chosen recipient', () => {
    open();
    toConfirm('sam');
    expect(text()).toContain(m.ownership_confirm_title({ name: 'Sam Patel' }));
    expect(text()).toContain(m.ownership_confirm_money({ name: 'Sam Patel' }));
    expect(text()).toContain(m.ownership_confirm_earned());
    expect(text()).toContain(m.ownership_confirm_admin());
    expect(text()).toContain(
      m.ownership_confirm_email_note({ name: 'Sam Patel' })
    );
  });

  test('warns about subscription income only when the owner has no agreement', () => {
    open({ ownerHasSubscriptionAgreement: false });
    toConfirm('jordan');
    expect(text()).toContain(m.ownership_confirm_subscription_title());
    unmount(component as ReturnType<typeof mount>);
    document.body.innerHTML = '';

    open({ ownerHasSubscriptionAgreement: true });
    toConfirm('jordan');
    expect(text()).not.toContain(m.ownership_confirm_subscription_title());
  });

  test('warns about held money only when the recipient has no payouts', () => {
    open();
    toConfirm('sam');
    expect(text()).toContain(
      m.ownership_confirm_payouts_title({ name: 'Sam Patel' })
    );
    button(m.ownership_confirm_back())?.click();
    flushSync();
    toConfirm('jordan');
    expect(text()).not.toContain(
      m.ownership_confirm_payouts_title({ name: 'Jordan Lee' })
    );
  });

  test('Send enables only on the name, trimmed and in any case', () => {
    open();
    toConfirm('sam');
    const sendButton = () => button(m.ownership_confirm_send());

    expect(sendButton()?.disabled).toBe(true);
    typeName('Studio');
    expect(sendButton()?.disabled).toBe(true);
    typeName('  studio ALPHA ');
    expect(sendButton()?.disabled).toBe(false);
  });

  test('sends the chosen recipient and the typed name, then closes', async () => {
    const { onSubmit } = open();
    toConfirm('sam');
    typeName('Studio Alpha');
    send();

    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('sam', 'Studio Alpha')
    );
    await vi.waitFor(() =>
      expect(document.querySelector('.dialog-content')).toBeNull()
    );
  });

  test('a refused offer stays open and shows why', async () => {
    const onSubmit = vi.fn(async () => {
      throw { status: 409, body: { code: 'CONFLICT', message: 'x' } };
    });
    open({ onSubmit });
    toConfirm('sam');
    typeName('Studio Alpha');
    send();

    await vi.waitFor(() =>
      expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
        'Mapped error copy'
      )
    );
    expect(button(m.ownership_confirm_send())?.disabled).toBe(false);
  });
});
