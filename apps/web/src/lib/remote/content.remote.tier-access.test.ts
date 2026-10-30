// @vitest-environment node

/**
 * The content editor's save, as the content API receives it (Codex-2hxff.91).
 *
 * `accessSelectionToFlags` turns the editor's access kind and the hidden
 * `includedTierIds` input into the subscribers-only switch `isTierGated` and
 * the exact set `includedInTierIds`:
 * - an ABSENT input (untouched this session, or the tier list failed to load)
 *   sends no set, so the server leaves the ticks alone (owner decision U4);
 *   it must never read as `[]`, which would take the item out of every tier;
 * - Subscribers with `[]` is a legal CLOSED save (U2), never free;
 * - a paid item's switch follows the set, and is left out with the set;
 * - Free / Followers / Team turn the switch off (the server clears the ticks);
 * - the legacy single `includedInTierId` is never sent (the schema refuses it
 *   beside the new fields).
 *
 * `$app/server` is stubbed so a form is its schema's parse plus its handler,
 * which is what kit runs on a submission.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentApi = vi.hoisted(() => ({
  create: vi.fn(async (_input: unknown) => ({ id: 'created-id' })),
  update: vi.fn(async (_id: string, _input: unknown) => ({
    id: 'updated-id',
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ content: contentApi })),
}));

vi.mock('$app/server', () => {
  const tag = <T extends object>(fn: T, type: string) =>
    Object.assign(fn, { __: { type, id: '', name: '' } });
  const query = (_schema: unknown, _fn: unknown) =>
    tag(() => ({ refresh: async () => {} }), 'query');
  query.batch = (_schema: unknown, _fn: unknown) =>
    tag(() => ({ refresh: async () => {} }), 'query_batch');
  return {
    query,
    command: (_schema: unknown, fn: (arg: unknown) => unknown) =>
      tag(fn, 'command'),
    form: (
      schema: { parse: (raw: unknown) => unknown },
      fn: (input: unknown) => unknown
    ) => tag((raw: unknown) => fn(schema.parse(raw)), 'form'),
    getRequestEvent: () => ({ platform: { env: {} }, cookies: {} }),
  };
});

import { createContentForm, updateContentForm } from './content.remote';

const ORG = '00000000-0000-4000-8000-000000000001';
const CONTENT = '00000000-0000-4000-8000-0000000000c1';
const BASIC = '00000000-0000-4000-8000-0000000000b1';
const PRO = '00000000-0000-4000-8000-0000000000b2';

type Raw = Record<string, string>;
const base = (overrides: Raw): Raw => ({
  organizationId: ORG,
  title: 'Winter Light',
  slug: 'winter-light',
  contentType: 'video',
  price: '0',
  ...overrides,
});

async function create(overrides: Raw) {
  const result = await (
    createContentForm as unknown as (raw: Raw) => Promise<unknown>
  )(base(overrides));
  expect(result).toMatchObject({ success: true });
  return contentApi.create.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

async function update(overrides: Raw) {
  const result = await (
    updateContentForm as unknown as (raw: Raw) => Promise<unknown>
  )(base({ contentId: CONTENT, ...overrides }));
  expect(result).toMatchObject({ success: true });
  return contentApi.update.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  contentApi.create.mockClear();
  contentApi.update.mockClear();
});

describe('Subscribers', () => {
  it('sends the switch and the full set', async () => {
    const sent = await update({
      accessType: 'subscribers',
      includedTierIds: JSON.stringify([BASIC, PRO]),
    });
    expect(sent).toMatchObject({
      isFree: false,
      isTierGated: true,
      includedInTierIds: [BASIC, PRO],
    });
  });

  it('with no tier ticked is a CLOSED save, never free', async () => {
    const sent = await update({
      accessType: 'subscribers',
      includedTierIds: '[]',
    });
    expect(sent).toMatchObject({
      isFree: false,
      isTierGated: true,
      includedInTierIds: [],
    });
  });

  it('with the input absent keeps the switch and leaves the ticks alone', async () => {
    const sent = await update({ accessType: 'subscribers' });
    expect(sent.isTierGated).toBe(true);
    expect(sent).not.toHaveProperty('includedInTierIds');
  });

  it('treats a malformed input as absent, never as "in no tier"', async () => {
    const sent = await update({
      accessType: 'subscribers',
      includedTierIds: '{oops',
    });
    expect(sent).not.toHaveProperty('includedInTierIds');
  });

  it('with a price is also for sale', async () => {
    const sent = await create({
      accessType: 'subscribers',
      price: '4.99',
      includedTierIds: JSON.stringify([PRO]),
    });
    expect(sent).toMatchObject({
      isPurchasable: true,
      priceCents: 499,
      isTierGated: true,
      includedInTierIds: [PRO],
    });
  });
});

describe('One-time purchase', () => {
  it('in tiers turns the switch on with the set', async () => {
    const sent = await update({
      accessType: 'paid',
      price: '4.99',
      includedTierIds: JSON.stringify([PRO]),
    });
    expect(sent).toMatchObject({
      isPurchasable: true,
      isTierGated: true,
      includedInTierIds: [PRO],
    });
  });

  it('in no tier turns the switch off: simply for sale', async () => {
    const sent = await update({
      accessType: 'paid',
      price: '4.99',
      includedTierIds: '[]',
    });
    expect(sent.isTierGated).toBe(false);
    expect(sent).not.toHaveProperty('includedInTierIds');
  });

  it('with the input absent sends neither the switch nor the set', async () => {
    const sent = await update({ accessType: 'paid', price: '4.99' });
    expect(sent).not.toHaveProperty('isTierGated');
    expect(sent).not.toHaveProperty('includedInTierIds');
  });
});

describe('the other kinds', () => {
  it.each([
    'free',
    'followers',
    'team',
  ])('%s turns the switch off and sends no set', async (accessType) => {
    const sent = await update({
      accessType,
      includedTierIds: JSON.stringify([PRO]),
    });
    expect(sent.isTierGated).toBe(false);
    expect(sent).not.toHaveProperty('includedInTierIds');
  });
});

describe('every save', () => {
  it('never sends the legacy single tier', async () => {
    for (const accessType of [
      'free',
      'paid',
      'subscribers',
      'followers',
      'team',
    ]) {
      const sent = await update({
        accessType,
        includedTierIds: JSON.stringify([PRO]),
      });
      expect(sent).not.toHaveProperty('includedInTierId');
    }
  });

  it('sends no tiers for orgless (personal) content', async () => {
    const sent = await update({
      organizationId: '',
      accessType: 'paid',
      price: '4.99',
      includedTierIds: JSON.stringify([PRO]),
    });
    expect(sent).not.toHaveProperty('isTierGated');
    expect(sent).not.toHaveProperty('includedInTierIds');
  });
});
