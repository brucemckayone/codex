/**
 * Studio → Monetisation: a yearly price below the monthly one is refused
 * at the yearly price (owner decision 2026-11-03, "Refuse yearly below
 * monthly"; review C1 cycle 2, L3).
 *
 * Tier saves answer 400 with `details.code` YEARLY_PRICE_BELOW_MONTHLY.
 * `updateTier` and `createTier` RETURN that refusal, and the dialog says it
 * from en.json at the yearly price, never in the worker's words: the line
 * is the field's `aria-describedby`, and the field takes focus. Changing a
 * price clears it. Any other refusal keeps the dialog's generic line, and
 * the Recommended switch reads a refusal as a failure, not a success.
 *
 * Mounts the real `+page.svelte` and dialog; `$app/*` and the remote modules
 * are mocked, as in edit-tier-price-hint.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from '$lib/components/ui/Toast/toast-store';
import type { SubscriptionTier } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/subscription.remote',
  () =>
    import(
      '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgSettings: () => ({
    current: { features: { enableSubscriptions: true } },
    error: undefined,
    loading: false,
  }),
}));

import {
  ACTIVE_ACCOUNT,
  createTier,
  land,
  myConnectSlot,
  reset,
  tiersSlot,
  updateTier,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};
const PRO = {
  id: 'pro',
  name: 'Pro',
  description: 'Every film',
  priceMonthly: 1200,
  priceAnnual: 12000,
  isRecommended: false,
} as unknown as SubscriptionTier;

/** The worker's own sentence, which never reaches the page. */
const WORKER_TEXT = 'Worker: yearly below monthly.';
const refused = (detailsCode: string) => ({
  success: false,
  status: 400,
  code: 'VALIDATION_ERROR',
  detailsCode,
  errorId: undefined,
  message: WORKER_TEXT,
});
const YEARLY_BELOW = refused('YEARLY_PRICE_BELOW_MONTHLY');

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [PRO]);
  flushSync();
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

/**
 * An opened dialog's focus trap focuses it a moment later (focus-trap's
 * delayed initial focus, on a timer). A person saves long after; a test must
 * wait for it too, or that focus lands after the refusal's.
 */
const afterOpenFocus = async () => {
  await new Promise((r) => setTimeout(r, 20));
  flushSync();
};

function buttonNamed(name: string) {
  return [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;
}

/** Open Edit Tier, and let the dialog's own opening focus land first. */
async function openEdit() {
  document
    .querySelector<HTMLButtonElement>(
      `button[aria-label="${m.monetisation_tiers_edit_aria({ name: 'Pro' })}"]`
    )
    ?.click();
  await afterOpenFocus();
}

function type(id: string, value: string | number) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no ${id}`);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function save() {
  buttonNamed(m.monetisation_save())?.click();
  await settle();
}

const annual = () =>
  document.querySelector<HTMLInputElement>('#tier-price-annual');
const refusalLine = () =>
  document.querySelector<HTMLElement>('[data-testid="tier-yearly-refusal"]');

/** The refusal is said at the yearly price, and the field takes focus. */
function expectRefusedAtYearly() {
  const line = refusalLine();
  expect(line?.textContent?.trim()).toBe(
    m.price_refusal_yearly_below_monthly()
  );
  const field = annual();
  expect(field?.getAttribute('aria-describedby')?.split(' ')).toContain(
    line?.id
  );
  expect(field?.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(field);
  // Never the worker's words, and not the dialog's generic line.
  expect(document.body.textContent).not.toContain(WORKER_TEXT);
  expect(document.body.textContent).not.toContain(
    m.monetisation_tier_save_error()
  );
}

describe('a yearly price below the monthly one (YEARLY_PRICE_BELOW_MONTHLY)', () => {
  test('Edit Tier: refused at the yearly price, which takes focus; a new price clears it', async () => {
    updateTier.mockResolvedValueOnce(YEARLY_BELOW);
    mountPage();
    await openEdit();
    type('tier-price-annual', 1000);

    await save();

    expect(updateTier).toHaveBeenCalledWith(
      expect.objectContaining({
        tierId: 'pro',
        priceMonthly: 1200,
        priceAnnual: 1000,
      })
    );
    expectRefusedAtYearly();

    type('tier-price-annual', 12000);
    expect(refusalLine()).toBeNull();
    expect(annual()?.hasAttribute('aria-describedby')).toBe(false);
    expect(annual()?.hasAttribute('aria-invalid')).toBe(false);
  });

  test('Create Tier: refused the same way, with no generic line', async () => {
    createTier.mockResolvedValueOnce(YEARLY_BELOW);
    mountPage();
    buttonNamed(m.monetisation_tiers_create())?.click();
    await afterOpenFocus();
    type('tier-name', 'Basic');
    type('tier-price-monthly', 1200);
    type('tier-price-annual', 1000);

    await save();

    expect(createTier).toHaveBeenCalledOnce();
    expectRefusedAtYearly();
  });

  test('another refusal keeps the generic line, and nothing at the yearly price', async () => {
    updateTier.mockResolvedValueOnce(refused('TIER_NOT_FOUND'));
    mountPage();
    await openEdit();

    await save();

    expect(document.body.textContent).toContain(
      m.monetisation_tier_save_error()
    );
    expect(refusalLine()).toBeNull();
    expect(document.body.textContent).not.toContain(WORKER_TEXT);
  });

  test('a saved edit closes the dialog', async () => {
    updateTier.mockResolvedValueOnce({ success: true, tier: PRO });
    mountPage();
    await openEdit();

    await save();

    expect(annual()).toBeNull();
  });

  test('the Recommended switch reads a refusal as a failure', async () => {
    const success = vi.spyOn(toast, 'success');
    const error = vi.spyOn(toast, 'error');
    updateTier.mockResolvedValueOnce(YEARLY_BELOW);
    mountPage();

    document
      .querySelector<HTMLElement>(
        `[aria-label="${m.monetisation_tier_recommended_toggle({ name: 'Pro' })}"]`
      )
      ?.click();
    await settle();

    expect(updateTier).toHaveBeenCalledWith(
      expect.objectContaining({ tierId: 'pro', isRecommended: true })
    );
    expect(error).toHaveBeenCalledWith(m.monetisation_tier_update_error());
    expect(success).not.toHaveBeenCalled();
  });
});
