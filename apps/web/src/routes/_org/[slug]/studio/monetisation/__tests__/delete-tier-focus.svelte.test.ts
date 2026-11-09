/**
 * Studio → Monetisation → Delete Tier: where focus goes after a delete
 * (Codex-p10nx).
 *
 * The tier's Delete opened the dialog, and the delete takes it away with the
 * tier, so focus has nowhere to go back to: it fell to the page. It goes to
 * the next tier's Delete, else the previous one's, else Create tier, else
 * the Tiers heading. A cancel takes nothing away: focus goes back home.
 *
 * Mounted as in `delete-tier-movers.svelte.test.ts`; the page's refresh
 * after the delete (`invalidateAll`) lands the list without the tier.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

import { invalidateAll } from '$app/navigation';
import {
  ACTIVE_ACCOUNT,
  deleteImpactSlot,
  deleteTier,
  land,
  myConnectSlot,
  NO_ACCOUNT,
  reset,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};
const tier = (id: string, name: string, priceMonthly: number) =>
  ({
    id,
    name,
    description: null,
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    sortOrder: 0,
    isRecommended: false,
    isActive: true,
  }) as unknown as SubscriptionTier;
const LITE = tier('lite', 'Lite', 300);
const BASIC = tier('basic', 'Basic', 500);
const PRO = tier('pro', 'Pro', 1200);

const EMPTY_IMPACT = {
  liveSubscriberCount: 0,
  movingInCount: 0,
  lastMoveAt: null,
  onlyHere: {
    films: { total: 0, closing: 0, staysForSale: 0, items: [] },
    courses: { total: 0, items: [] },
  },
  alsoInOtherPlans: { films: 6, courses: 0 },
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation');
  deleteTier.mockResolvedValue({ success: true });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage(list: SubscriptionTier[], account = ACTIVE_ACCOUNT) {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), account);
  land(tiersSlot(), list);
  flushSync();
}

const deleteButton = (name: string) =>
  document.querySelector<HTMLButtonElement>(
    `button[aria-label="${m.monetisation_tiers_delete_aria({ name })}"]`
  );
const dialog = () => document.querySelector<HTMLElement>('.dialog-content');
const buttonIn = (scope: HTMLElement | null, name: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;

/** Opens the tier's Delete from the keyboard's place: focus on its button. */
async function openDelete(target: SubscriptionTier) {
  land(deleteImpactSlot(target.id), EMPTY_IMPACT);
  deleteButton(target.name)?.focus();
  deleteButton(target.name)?.click();
  flushSync();
  const panel = dialog();
  if (!panel) throw new Error('the delete dialog did not open');
  await vi.waitFor(() =>
    expect(panel.contains(document.activeElement)).toBe(true)
  );
  return panel;
}

/**
 * Deletes the tier. The refresh after it is still on its way as the dialog
 * closes, as over a network, so the deleted tier's row is still on the page
 * then; `refreshed()` lands the list without it.
 */
async function deleteAndClose(
  target: SubscriptionTier,
  after: SubscriptionTier[]
) {
  let landed!: () => void;
  const refresh = new Promise<void>((resolve) => {
    landed = resolve;
  });
  vi.mocked(invalidateAll).mockImplementation(() => refresh);
  const panel = await openDelete(target);
  buttonIn(panel, m.monetisation_tiers_delete())?.click();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  return async () => {
    land(tiersSlot(), after);
    landed();
    flushSync();
    await refresh;
  };
}

describe('focus after a tier is deleted', () => {
  test("the next tier's Delete", async () => {
    mountPage([LITE, BASIC, PRO]);
    const refreshed = await deleteAndClose(BASIC, [LITE, PRO]);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Pro'))
    );
    await refreshed();
    expect(deleteButton('Basic')).toBeNull();
    expect(document.activeElement).toBe(deleteButton('Pro'));
  });

  test("the previous one's, when the last tier went", async () => {
    mountPage([LITE, BASIC, PRO]);
    const refreshed = await deleteAndClose(PRO, [LITE, BASIC]);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Basic'))
    );
    await refreshed();
    expect(document.activeElement).toBe(deleteButton('Basic'));
  });

  test('Create tier, when no tier is left', async () => {
    mountPage([BASIC]);
    const refreshed = await deleteAndClose(BASIC, []);

    const create = buttonIn(document.body, m.monetisation_tiers_create());
    expect(create).toBeDefined();
    await vi.waitFor(() => expect(document.activeElement).toBe(create));
    await refreshed();
    expect(document.activeElement).toBe(create);
  });

  // Create waits for a ready payout account, so it can't take focus then.
  test('the Tiers heading, when no tier is left and Create is off', async () => {
    mountPage([BASIC], NO_ACCOUNT);
    expect(
      buttonIn(document.body, m.monetisation_tiers_create())?.disabled
    ).toBe(true);
    const refreshed = await deleteAndClose(BASIC, []);

    const heading = [...document.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === m.monetisation_tiers_title()
    );
    expect(heading?.tabIndex).toBe(-1);
    await vi.waitFor(() => expect(document.activeElement).toBe(heading));
    await refreshed();
    expect(document.activeElement).toBe(heading);
  });

  test('a cancel, even after a delete, gives focus back to the Delete that opened the dialog', async () => {
    mountPage([LITE, BASIC, PRO]);
    const refreshed = await deleteAndClose(BASIC, [LITE, PRO]);
    await refreshed();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Pro'))
    );

    const panel = await openDelete(LITE);
    buttonIn(panel, m.monetisation_cancel())?.click();
    flushSync();

    await vi.waitFor(() => expect(dialog()).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Lite'))
    );
  });
});

// The dialog stays while its request runs, as its Cancel does. Closed by an
// Escape then, focus went back to the tier's Delete, which the refresh then
// removed: the body. And the answer read the dialog's tier after the await,
// so a second tier's dialog took the first one's answer (review fu-focus-2).
describe('while the delete runs', () => {
  const pressEscape = () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flushSync();
  };

  /** Presses Delete in the tier's dialog; its request answers on `answer()`. */
  async function startDelete(
    target: SubscriptionTier,
    after: SubscriptionTier[]
  ) {
    let answer!: (result: { success: true }) => void;
    deleteTier.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    vi.mocked(invalidateAll).mockImplementation(async () => {
      land(tiersSlot(), after);
      flushSync();
    });
    const panel = await openDelete(target);
    buttonIn(panel, m.monetisation_tiers_delete())?.click();
    flushSync();
    expect(deleteTier).toHaveBeenCalledTimes(1);
    return { panel, answer: () => answer({ success: true }) };
  }

  test('an Escape leaves the dialog open, and focus still goes to what survives', async () => {
    mountPage([LITE, BASIC, PRO]);
    const { panel, answer } = await startDelete(BASIC, [LITE, PRO]);

    pressEscape();
    expect(dialog()).toBe(panel);

    answer();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Pro'))
    );
    expect(deleteButton('Basic')).toBeNull();
  });

  // jsdom lets a press reach the page behind the open dialog, which in the
  // browser its overlay takes. It stands in for anything that changes the
  // dialog's tier while the request runs.
  test("an Escape, then another tier's Delete: the answer is the first tier's", async () => {
    mountPage([LITE, BASIC, PRO]);
    const { answer } = await startDelete(BASIC, [LITE, PRO]);

    pressEscape();
    deleteButton('Pro')?.click();
    flushSync();

    answer();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(deleteTier).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteTier).mock.calls[0]?.[0]).toMatchObject({
      tierId: BASIC.id,
    });
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(deleteButton('Pro'))
    );
  });
});
