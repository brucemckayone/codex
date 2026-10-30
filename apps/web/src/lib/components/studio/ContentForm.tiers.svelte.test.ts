/**
 * ContentForm × the tier picker (Codex-2hxff.91).
 *
 * What a save carries, read off the submitted form:
 * - the tier set goes ONLY when the creator touched the picker or the access
 *   kind this session (owner decision U4), and then as the full set; an
 *   untouched save leaves the stored ticks alone, so a typo fix can't undo a
 *   checklist change made in another tab;
 * - a tier list that failed to load disables the picker and never sends a
 *   set (U4), and the Subscribers card stays on a subscriber film;
 * - a gated film the display helper can't place (switch on, no price: a
 *   CLOSED film) opens as Subscribers, never Free, with the closed warning.
 *
 * Same harness as ContentForm.svelte.test.ts: a fake remote form that reads
 * the <form>'s FormData on submit, as kit does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { FakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

const tiersSlot = vi.hoisted(() => ({
  current: undefined as unknown,
  error: undefined as unknown,
  loading: false,
  refresh: async () => {},
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  invalidateAll: vi.fn(),
  invalidate: vi.fn(),
  afterNavigate: vi.fn(),
  preloadData: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return {
    createContentForm: createFakeRemoteForm(),
    updateContentForm: createFakeRemoteForm(),
    uploadThumbnailForm: createFakeRemoteForm(),
    deleteContent: vi.fn(),
    deleteThumbnailCommand: vi.fn(),
    publishContent: vi.fn(),
    unpublishContent: vi.fn(),
    checkContentSlug: vi.fn(async () => ({ available: true })),
  };
});

vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: () => ({ current: undefined, loading: false }),
  listTiers: () => tiersSlot,
}));

vi.mock('$lib/remote/library.remote', () => ({
  getStreamingUrl: () => ({ current: undefined, loading: false }),
}));

vi.mock('$lib/remote/categories.remote', () => ({
  getCategories: () => ({ current: [], loading: false }),
  createCategoryInline: vi.fn(),
}));

const { createContentForm, updateContentForm } = await import(
  '$lib/remote/content.remote'
);
const fakeUpdate = updateContentForm as unknown as FakeRemoteForm;
const fakeCreate = createContentForm as unknown as FakeRemoteForm;
const ContentForm = (await import('./ContentForm.svelte')).default;

const ORG = '22222222-2222-4222-8222-222222222222';
const BASIC = '00000000-0000-4000-8000-0000000000b1';
const PRO = '00000000-0000-4000-8000-0000000000b2';
const PREMIUM = '00000000-0000-4000-8000-0000000000b3';
const TIERS = [
  { id: PREMIUM, name: 'Premium', priceMonthly: 2000, sortOrder: 3 },
  { id: BASIC, name: 'Basic', priceMonthly: 500, sortOrder: 1 },
  { id: PRO, name: 'Pro', priceMonthly: 1200, sortOrder: 2 },
];

const FILM = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Winter Light',
  slug: 'winter-light',
  description: '',
  contentType: 'video',
  status: 'published',
  visibility: 'purchased_only',
  isFree: false,
  isPurchasable: false,
  priceCents: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
  isTierGated: true,
  includedInTierIds: [BASIC],
  mediaItemId: null,
  contentBody: '',
  contentBodyJson: null,
  category: '',
  categoryIds: [],
  tags: [],
  thumbnailUrl: null,
  shaderPreset: null,
  featured: false,
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fakeUpdate.__reset();
  fakeCreate.__reset();
  document.body.innerHTML = '';
  tiersSlot.current = TIERS;
  tiersSlot.error = undefined;
  tiersSlot.loading = false;
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
});

/** `null` renders create mode (a new item). */
function render(content: Record<string, unknown> | null = FILM) {
  component = mount(ContentForm, {
    target: document.body,
    props: {
      // biome-ignore lint/suspicious/noExplicitAny: trimmed ContentWithRelations
      content: (content ?? undefined) as any,
      organizationId: ORG,
      orgSlug: 'hollow-oak',
    },
  });
  flushSync();
  return document.body.querySelector('form') as HTMLFormElement;
}

async function submit(form: HTMLFormElement, fake = fakeUpdate) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  return fake.submissions.at(-1) as Record<string, string>;
}

const tierRow = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button.tier')].find(
    (b) => b.querySelector('.tier__name')?.textContent === name
  ) as HTMLButtonElement;

const accessRadio = (value: string) =>
  document.querySelector(
    `input[name="_accessTypeRadio"][value="${value}"]`
  ) as HTMLInputElement | null;

describe('the save carries the tier set only when touched (U4)', () => {
  it('an untouched save sends no set, so the stored ticks stay', async () => {
    const form = render();
    const sent = await submit(form);
    expect(sent.accessType).toBe('subscribers');
    expect(sent).not.toHaveProperty('includedTierIds');
  });

  it('ticking a tier sends the full set', async () => {
    const form = render();
    tierRow('Pro').click();
    flushSync();
    const sent = await submit(form);
    expect(JSON.parse(sent.includedTierIds)).toEqual([BASIC, PRO]);
  });

  it('"and above" sends that tier and every dearer one', async () => {
    const form = render();
    const above = document.querySelector<HTMLButtonElement>(
      `button.tier__above[aria-label="${m.plan_picker_and_above_aria({ tierName: 'Pro' })}"]`
    );
    above?.click();
    flushSync();
    const sent = await submit(form);
    expect(JSON.parse(sent.includedTierIds)).toEqual([PRO, PREMIUM]);
  });

  it('changing the access kind is a touch: the set goes with it', async () => {
    const form = render();
    accessRadio('paid')?.click();
    flushSync();
    const sent = await submit(form);
    expect(sent.accessType).toBe('paid');
    expect(JSON.parse(sent.includedTierIds)).toEqual([BASIC]);
  });

  it('a new item always states its set', async () => {
    const form = render(null);
    accessRadio('subscribers')?.click();
    flushSync();
    const sent = await submit(form, fakeCreate);
    expect(sent.accessType).toBe('subscribers');
    expect(JSON.parse(sent.includedTierIds)).toEqual([]);
  });
});

describe('not loaded is not "no tier"', () => {
  it('a failed tier list keeps the Subscribers card, disables the picker and sends no set', async () => {
    tiersSlot.current = undefined;
    tiersSlot.error = { status: 500, body: { message: 'Internal Error' } };
    const form = render();
    expect(accessRadio('subscribers')?.checked).toBe(true);
    expect(
      document.querySelector('[data-testid="tiers-failed"]')?.textContent
    ).toContain(m.plan_picker_load_failed());
    expect(document.querySelectorAll('button.tier')).toHaveLength(0);

    // Even a touch can't send a set it never loaded.
    accessRadio('paid')?.click();
    flushSync();
    const sent = await submit(form);
    expect(sent).not.toHaveProperty('includedTierIds');
  });

  it('an item whose own ticks never arrived sends no set either', async () => {
    const { includedInTierIds: _omitted, ...withoutTicks } = FILM;
    const form = render(withoutTicks);
    // No picker to touch; changing the kind is a touch, and still no set.
    expect(tierRow('Pro')).toBeUndefined();
    accessRadio('paid')?.click();
    flushSync();
    const sent = await submit(form);
    expect(sent).not.toHaveProperty('includedTierIds');
  });

  it('a new item cannot pick Subscribers while the list is failed', () => {
    tiersSlot.current = undefined;
    tiersSlot.error = { status: 500, body: { message: 'Internal Error' } };
    render(null);
    expect(accessRadio('subscribers')?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      m.plan_picker_load_failed_new()
    );
  });
});

describe('a closed film', () => {
  it('opens as Subscribers, never Free, with the closed warning', async () => {
    const form = render({ ...FILM, includedInTierIds: [] });
    expect(
      document.querySelector('[data-testid="tier-closed"]')?.textContent
    ).toContain(m.plan_picker_closed_title());
    const sent = await submit(form);
    expect(sent.accessType).toBe('subscribers');
  });
});

describe('the guidance note', () => {
  it('says when a dearer tier lacks the film, and "Tick Pro" ticks it', async () => {
    const form = render({ ...FILM, includedInTierIds: [BASIC, PREMIUM] });
    const note = document.querySelector('.plan-gap-note');
    expect(note?.textContent).toContain(
      m.plan_gap_film({ dearer: 'Pro', cheaper: 'Basic' })
    );
    const tick = [
      ...document.querySelectorAll<HTMLButtonElement>('.plan-gap-note__action'),
    ].find(
      (b) => b.textContent?.trim() === m.plan_gap_tick({ tierName: 'Pro' })
    );
    tick?.click();
    flushSync();
    expect(document.querySelector('.plan-gap-note')).toBeNull();
    const sent = await submit(form);
    expect(JSON.parse(sent.includedTierIds).sort()).toEqual(
      [BASIC, PRO, PREMIUM].sort()
    );
  });
});
