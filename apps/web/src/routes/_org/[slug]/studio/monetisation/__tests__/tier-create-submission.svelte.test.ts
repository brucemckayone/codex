/**
 * Studio → Monetisation: the Create Tier dialog sends one `submissionId` per
 * create attempt (Codex-2hxff.66).
 *
 * The server keys the Stripe product and prices on it, so a retry with the
 * same id gets back the tier the first attempt made. The dialog therefore:
 * - mints an id when it opens;
 * - keeps it when the same values are sent again (the retry);
 * - mints a new one when the values changed since the last send, because
 *   Stripe refuses a reused key with different parameters.
 * It mints without `crypto.randomUUID`, which is undefined on http://*.lvh.me.
 *
 * A create that failed has an unknown outcome: the server may have made the
 * tier anyway. So the tier list is re-read, and a reopen resumes that attempt
 * (same values, same id) until a create succeeds, the list shows the tier, or
 * an hour passes (Stripe forgets a key after 24h).
 *
 * The worker's typed refusals (sweep-plans' contract) arrive as a returned
 * failure carrying `details.code`:
 * - STRIPE_UNAVAILABLE and SUBMISSION_ID_REUSED re-mint;
 * - SUBMISSION_IN_PROGRESS keeps the id and says "try again in a moment";
 * - anything else keeps the id.
 * A 408, any other 5xx and a thrown create are an UNKNOWN outcome (owner
 * decision 2026-10-26): the copy says the tier may have saved, never "Could
 * not save". A definite 4xx refusal is logged at warn, the rest at error.
 *
 * The answer to a create can land after the owner closed the dialog and
 * opened Edit on another tier: it must not close that dialog or put its error
 * there (Codex-2hxff.66 review, LOW-3).
 *
 * Mounts the real `+page.svelte` and dialog; `$app/*` and the remote modules
 * are mocked.
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

import {
  ACTIVE_ACCOUNT,
  createTier,
  land,
  myConnectSlot,
  reset,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What `createTier` answers: a tier, or a refusal it RETURNS. */
const MADE = { success: true, tier: { id: 'tier-1' } };
const refused = (
  status: number,
  detailsCode?: string,
  code = status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT'
) => ({
  success: false,
  status,
  code,
  detailsCode,
  message: 'refused',
});

/** A promise the test settles by hand: a create still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  flushSync();
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

function buttonNamed(name: string) {
  return [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;
}

function openDialog() {
  // The header button; once open, the dialog title repeats the same words.
  buttonNamed(m.monetisation_tiers_create())?.click();
  flushSync();
}

function closeDialog() {
  buttonNamed(m.monetisation_cancel())?.click();
  flushSync();
}

const nameInput = () =>
  document.querySelector('#tier-name') as HTMLInputElement | null;

function typeName(value: string) {
  const input = nameInput() as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function save() {
  buttonNamed(m.monetisation_save())?.click();
  await settle();
}

/** The `submissionId` of each createTier call, in order. */
const sentIds = () =>
  createTier.mock.calls.map(
    (call) => (call[0] as { submissionId: string }).submissionId
  );

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('the Create Tier dialog', () => {
  test('sends a fresh uuid with the tier', async () => {
    createTier.mockResolvedValue(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(createTier).toHaveBeenCalledTimes(1);
    expect(createTier.mock.calls[0][0]).toMatchObject({
      orgId: ORG.id,
      name: 'Inner Circle',
      priceMonthly: 499,
      priceAnnual: 4990,
    });
    expect(sentIds()[0]).toMatch(UUID);
  });

  test('a retry with the same values keeps the id, so the server returns the first tier', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    await save();

    expect(sentIds()).toHaveLength(2);
    // A real id, or two missing ids would "match" too.
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  test('values edited after a failed send get a new id', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    typeName('Inner Circle Plus');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('opening the dialog again starts a new attempt', async () => {
    createTier.mockResolvedValue(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('mints without crypto.randomUUID (http://*.lvh.me is not a secure context)', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: real.getRandomValues.bind(real),
    });
    createTier.mockResolvedValue(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(sentIds()[0]).toMatch(UUID);
  });
});

describe('a create whose outcome is unknown', () => {
  test('a failed create re-reads the tier list, so a tier it did make shows', async () => {
    createTier.mockRejectedValueOnce(new Error('response lost'));
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(tiersSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('reopened unchanged, it resumes the attempt: same values, same id', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    closeDialog();

    openDialog();
    expect(nameInput()?.value).toBe('Inner Circle');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  test('reopened and changed, it is a new attempt with a new id', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    closeDialog();

    openDialog();
    typeName('Inner Circle Plus');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('once a create succeeds, the next open starts empty with a new id', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValue(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    await save(); // the retry lands

    openDialog();
    expect(nameInput()?.value).toBe('');
    typeName('Inner Circle');
    await save();

    expect(sentIds()).toHaveLength(3);
    expect(sentIds()[2]).toMatch(UUID);
    expect(sentIds()[2]).not.toBe(sentIds()[0]);
  });

  test('once the refreshed list shows the tier, the next open starts fresh', async () => {
    createTier.mockRejectedValueOnce(new Error('response lost'));
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    closeDialog();

    // The refresh found the tier the first attempt made.
    land(tiersSlot(), [
      {
        id: 'tier-1',
        name: 'Inner Circle',
        description: null,
        priceMonthly: 499,
        priceAnnual: 4990,
        isRecommended: false,
      } as unknown as SubscriptionTier,
    ]);
    flushSync();

    openDialog();
    expect(nameInput()?.value).toBe('');
  });

  test('an hour on, a reopen starts fresh: Stripe forgets a key after 24h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    closeDialog();

    vi.setSystemTime(new Date('2026-10-25T11:01:00Z'));
    openDialog();
    expect(nameInput()?.value).toBe('');
    typeName('Inner Circle');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });
});

describe("the worker's typed refusals", () => {
  async function refuseThenRetry(failure: ReturnType<typeof refused>) {
    createTier.mockResolvedValueOnce(failure).mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
  }

  test('STRIPE_UNAVAILABLE (503): nothing was saved, so the unchanged retry gets a new id', async () => {
    await refuseThenRetry(refused(503, 'STRIPE_UNAVAILABLE'));
    expect(text()).toContain(m.monetisation_tier_save_error());
    expect(tiersSlot().refresh).toHaveBeenCalledTimes(1);
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('SUBMISSION_ID_REUSED (409): the id is spent, so the retry gets a new one', async () => {
    await refuseThenRetry(refused(409, 'SUBMISSION_ID_REUSED'));
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('SUBMISSION_IN_PROGRESS (409): "try again in a moment", and the retry keeps the id', async () => {
    await refuseThenRetry(refused(409, 'SUBMISSION_IN_PROGRESS'));
    expect(text()).toContain(m.monetisation_tier_save_in_progress());
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  test('any other refusal (500) keeps the id: the repeat reuses the first attempt', async () => {
    await refuseThenRetry(refused(500));
    // A 500 is an unknown outcome, not a definite refusal (see below).
    expect(text()).toContain(m.monetisation_tier_save_unknown());
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });
});

describe('an unknown outcome says the tier may have saved', () => {
  test.each([
    ['a 408 timeout', refused(408, undefined, 'REQUEST_TIMEOUT')],
    ['a 500', refused(500)],
    [
      'a 502 that is not Stripe failing',
      refused(502, undefined, 'BAD_GATEWAY'),
    ],
    // What createTier returns when the fetch to the worker threw.
    ['a failure with no API answer', { ...refused(500), code: undefined }],
  ])('%s', async (_label, failure) => {
    createTier.mockResolvedValueOnce(failure);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(text()).toContain(m.monetisation_tier_save_unknown());
    expect(text()).not.toContain(m.monetisation_tier_save_error());
    expect(tiersSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('a create that threw', async () => {
    createTier.mockRejectedValueOnce(new Error('response lost'));
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(text()).toContain(m.monetisation_tier_save_unknown());
    expect(text()).not.toContain(m.monetisation_tier_save_error());
  });

  test.each([
    ['STRIPE_UNAVAILABLE (503)', refused(503, 'STRIPE_UNAVAILABLE')],
    ['a 422 gate', refused(422, undefined, 'UNPROCESSABLE_ENTITY')],
  ])('a definite refusal, %s, keeps "Could not save the tier"', async (_label, failure) => {
    createTier.mockResolvedValueOnce(failure);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(text()).toContain(m.monetisation_tier_save_error());
    expect(text()).not.toContain(m.monetisation_tier_save_unknown());
  });

  test('a failed list refresh behind it is logged', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    tiersSlot().refresh.mockRejectedValueOnce(new Error('list read failed'));
    createTier.mockRejectedValueOnce(new Error('response lost'));
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(error).toHaveBeenCalledWith(
      'studio/monetisation: tier list refresh after a failed create failed',
      expect.objectContaining({
        organizationId: ORG.id,
        reason: 'list read failed',
      })
    );
  });
});

describe('log level', () => {
  const CREATE_FAILED = 'studio/monetisation: tier create failed';

  test('a 409 SUBMISSION_IN_PROGRESS is a warning, not an error', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    createTier.mockResolvedValueOnce(refused(409, 'SUBMISSION_IN_PROGRESS'));
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(warn).toHaveBeenCalledWith(
      CREATE_FAILED,
      expect.objectContaining({ reason: '409 SUBMISSION_IN_PROGRESS' })
    );
    expect(error).not.toHaveBeenCalledWith(CREATE_FAILED, expect.anything());
  });

  test.each([
    ['an unknown outcome', refused(500)],
    ['Stripe failing', refused(503, 'STRIPE_UNAVAILABLE')],
  ])('%s stays an error', async (_label, failure) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    createTier.mockResolvedValueOnce(failure);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();

    expect(error).toHaveBeenCalledWith(CREATE_FAILED, expect.anything());
    expect(warn).not.toHaveBeenCalledWith(CREATE_FAILED, expect.anything());
  });
});

describe('a refusal, then close and reopen', () => {
  test('STRIPE_UNAVAILABLE: the typed values come back under a fresh id, without the old error', async () => {
    createTier
      .mockResolvedValueOnce(refused(503, 'STRIPE_UNAVAILABLE'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    expect(text()).toContain(m.monetisation_tier_save_error());
    closeDialog();

    openDialog();
    expect(nameInput()?.value).toBe('Inner Circle');
    expect(text()).not.toContain(m.monetisation_tier_save_error());
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toMatch(UUID);
    expect(sentIds()[1]).not.toBe(sentIds()[0]);
  });

  test('SUBMISSION_IN_PROGRESS: the reopen resumes the same id, so the repeat returns the first tier', async () => {
    createTier
      .mockResolvedValueOnce(refused(409, 'SUBMISSION_IN_PROGRESS'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog();
    typeName('Inner Circle');
    await save();
    closeDialog();

    openDialog();
    expect(nameInput()?.value).toBe('Inner Circle');
    expect(text()).not.toContain(m.monetisation_tier_save_in_progress());
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });
});

describe('the resume hour runs from the first send', () => {
  test('an hour spent on the copy before the first Save still resumes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(MADE);
    mountPage();
    openDialog(); // the id is minted at 10:00
    typeName('Inner Circle');

    vi.setSystemTime(new Date('2026-10-25T11:30:00Z'));
    await save(); // ...and first sent at 11:30
    closeDialog();

    vi.setSystemTime(new Date('2026-10-25T11:45:00Z'));
    openDialog();
    expect(nameInput()?.value).toBe('Inner Circle');
    await save();

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toMatch(UUID);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });
});

describe('a create that answers after the owner opened Edit on another tier', () => {
  const FOUNDING = {
    id: 'tier-0',
    name: 'Founding',
    description: null,
    priceMonthly: 999,
    priceAnnual: 9990,
    isRecommended: false,
  } as unknown as SubscriptionTier;

  /** Send a create that stays in flight, close, and open Edit on Founding. */
  function createThenEdit() {
    const pending = deferred<unknown>();
    createTier.mockReturnValueOnce(pending.promise);
    mountPage();
    land(tiersSlot(), [FOUNDING]);
    flushSync();
    openDialog();
    typeName('Inner Circle');
    buttonNamed(m.monetisation_save())?.click();
    flushSync();
    closeDialog();

    (
      document.querySelector(
        `[aria-label="${m.monetisation_tiers_edit_aria({ name: 'Founding' })}"]`
      ) as HTMLButtonElement
    ).click();
    flushSync();
    expect(nameInput()?.value).toBe('Founding');
    return pending;
  }

  test("the Edit dialog's Save is not held up by the create", () => {
    createThenEdit();
    expect(buttonNamed(m.monetisation_save())?.disabled).toBe(false);
  });

  test('a late success does not close the Edit dialog', async () => {
    const pending = createThenEdit();
    pending.resolve(MADE);
    await settle();

    expect(nameInput()?.value).toBe('Founding');
  });

  test("a late refusal does not put the create's error in the Edit dialog", async () => {
    const pending = createThenEdit();
    pending.resolve(refused(409, 'SUBMISSION_IN_PROGRESS'));
    await settle();

    expect(nameInput()?.value).toBe('Founding');
    expect(text()).not.toContain(m.monetisation_tier_save_in_progress());
    expect(text()).not.toContain(m.monetisation_tier_save_error());
    // The attempt is still settled behind it: the list is re-read.
    expect(tiersSlot().refresh).toHaveBeenCalledTimes(1);
  });
});
