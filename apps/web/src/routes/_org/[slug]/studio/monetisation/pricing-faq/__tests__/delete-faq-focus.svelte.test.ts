/**
 * Studio → Monetisation → Pricing FAQ: where focus goes after a question is
 * deleted (Codex-p10nx).
 *
 * The question's Delete opened the confirm, and the delete takes it away
 * with its row before the confirm closes, so focus had nowhere to go back
 * to: it fell to the page. It goes to the next question's Delete, else the
 * previous one's, else Add. A cancel takes nothing away: focus goes back
 * home.
 *
 * Mounts the real page; only the branding remote module (it imports
 * `$app/server`) is mocked.
 */

import type { PricingFaqItem } from '@codex/validation';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const loaded = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('$lib/remote/branding.remote', () => ({
  getPricingFaq: vi.fn(async () => loaded.items),
  updatePricingFaq: vi.fn(async () => ({ success: true })),
}));

import PricingFaqPage from '../+page.svelte';

const ORG = { id: '00000000-0000-4000-8000-000000000001' };
const faq = (n: number, question: string): PricingFaqItem => ({
  id: `00000000-0000-4000-8000-00000000020${n}`,
  question,
  answer: `Answer to ${question}`,
  order: n - 1,
});
const CANCEL = faq(1, 'Can I cancel?');
const REFUND = faq(2, 'Do you refund?');
const TRIAL = faq(3, 'Is there a trial?');

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

async function mountPage(items: PricingFaqItem[]) {
  loaded.items = items;
  component = mount(PricingFaqPage, {
    target: document.body,
    props: { data: { org: ORG } } as never,
  });
  flushSync();
  await vi.waitFor(() => expect(deleteButton(items[0])).not.toBeNull());
}

const deleteButton = (item: PricingFaqItem) =>
  [...document.querySelectorAll('button')].find(
    (b) =>
      b.getAttribute('aria-label') ===
      m.monetisation_faq_delete_aria({ question: item.question })
  ) ?? null;
const dialog = () => document.querySelector<HTMLElement>('.dialog-content');
const buttonIn = (scope: HTMLElement | null, name: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;

/** Opens the question's Delete from the keyboard's place: focus on it. */
async function openDelete(item: PricingFaqItem) {
  deleteButton(item)?.focus();
  deleteButton(item)?.click();
  flushSync();
  const panel = dialog();
  if (!panel) throw new Error('the delete confirm did not open');
  await vi.waitFor(() =>
    expect(panel.contains(document.activeElement)).toBe(true)
  );
  return panel;
}

async function deleteAndClose(item: PricingFaqItem) {
  const panel = await openDelete(item);
  buttonIn(panel, m.monetisation_faq_delete_confirm())?.click();
  flushSync();
  await vi.waitFor(() => expect(dialog()).toBeNull());
}

describe('focus after a question is deleted', () => {
  test("the next question's Delete", async () => {
    await mountPage([CANCEL, REFUND, TRIAL]);
    await deleteAndClose(REFUND);

    expect(deleteButton(REFUND)).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton(TRIAL))
    );
  });

  test("the previous one's, when the last question went", async () => {
    await mountPage([CANCEL, REFUND, TRIAL]);
    await deleteAndClose(TRIAL);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton(REFUND))
    );
  });

  test('Add your first question, when none is left', async () => {
    await mountPage([CANCEL]);
    await deleteAndClose(CANCEL);

    const add = buttonIn(document.body, m.monetisation_faq_add_first());
    expect(add).toBeDefined();
    await vi.waitFor(() => expect(document.activeElement).toBe(add));
  });

  test('a cancel, even after a delete, gives focus back to the Delete that opened the confirm', async () => {
    await mountPage([CANCEL, REFUND, TRIAL]);
    await deleteAndClose(REFUND);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton(TRIAL))
    );

    const panel = await openDelete(CANCEL);
    buttonIn(panel, m.monetisation_faq_cancel())?.click();
    flushSync();

    await vi.waitFor(() => expect(dialog()).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton(CANCEL))
    );
  });
});
