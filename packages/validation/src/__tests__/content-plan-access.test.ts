/**
 * Plan access by ticks (Codex-2hxff.91): the content write contract.
 *
 * `isTierGated` is the subscribers-only SWITCH; `includedInTierIds` is the
 * exact SET of tiers. Gated with no tier ticked is CLOSED, never free, so the
 * refinements below keep the switch away from `isFree: true` and from the
 * gates the access decision applies before the tier arm (design §2.4 #7).
 * `includedInTierId` is the old studio's legacy single tier (phase 1 only).
 */
import { describe, expect, it } from 'vitest';
import {
  createContentSchema,
  updateContentSchema,
} from '../content/content-schemas';

const org = '223e4567-e89b-12d3-a456-426614174000';
const media = '323e4567-e89b-12d3-a456-426614174000';
const basic = '423e4567-e89b-12d3-a456-426614174000';
const pro = '523e4567-e89b-12d3-a456-426614174000';

const video = {
  title: 'Winter Light',
  slug: 'winter-light',
  contentType: 'video' as const,
  mediaItemId: media,
  organizationId: org,
};

const messages = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message).join(' | ') ?? '';

describe('create: the switch and the set', () => {
  it('accepts a subscribers-only film in a bundle of tiers', () => {
    const parsed = createContentSchema.parse({
      ...video,
      isFree: false,
      isTierGated: true,
      includedInTierIds: [basic, pro],
    });
    expect(parsed.isTierGated).toBe(true);
    expect(parsed.includedInTierIds).toEqual([basic, pro]);
  });

  it('accepts a CLOSED film: gated with no tier ticked', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isTierGated: true,
        includedInTierIds: [],
      }).success
    ).toBe(true);
  });

  it('counts the switch alone as a gate on a non-free row', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isTierGated: true,
      }).success
    ).toBe(true);
  });

  it('accepts a paid film that is also in tiers', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        isTierGated: true,
        includedInTierIds: [pro],
      }).success
    ).toBe(true);
  });

  it('gives neither field a default', () => {
    const parsed = createContentSchema.parse({ ...video, isFree: true });
    expect('isTierGated' in parsed).toBe(false);
    expect('includedInTierIds' in parsed).toBe(false);
  });

  it('refuses a gated film marked free (I2)', () => {
    const result = createContentSchema.safeParse({
      ...video,
      isFree: true,
      isTierGated: true,
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/closed, not free/);
  });

  it('refuses a gated film with no organisation', () => {
    const { organizationId: _org, ...orgless } = video;
    for (const organizationId of [undefined, null]) {
      const result = createContentSchema.safeParse({
        ...orgless,
        organizationId,
        isFree: false,
        isTierGated: true,
      });
      expect(result.success).toBe(false);
      expect(messages(result)).toMatch(/orgless content cannot be tier-gated/);
    }
  });

  it.each([
    ['isFollowerGated'],
    ['isTeamOnly'],
    ['courseOnly'],
  ])('refuses gated + %s (I4)', (flag) => {
    const result = createContentSchema.safeParse({
      ...video,
      isFree: false,
      isTierGated: true,
      [flag]: true,
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/cannot also be followers-only/);
  });

  it('refuses ticks without the switch on create (absent means off)', () => {
    for (const isTierGated of [undefined, false]) {
      const result = createContentSchema.safeParse({
        ...video,
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        isTierGated,
        includedInTierIds: [pro],
      });
      expect(result.success, String(isTierGated)).toBe(false);
    }
  });

  it('refuses a repeated tier and more than 50', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isTierGated: true,
        includedInTierIds: [pro, pro],
      }).success
    ).toBe(false);
    const many = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isTierGated: true,
        includedInTierIds: many,
      }).success
    ).toBe(false);
  });
});

describe('create: the legacy single tier (phase 1)', () => {
  it('still accepts the old studio payload', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        isPurchasable: false,
        priceCents: null,
        includedInTierId: basic,
        isFollowerGated: false,
        isTeamOnly: false,
      }).success
    ).toBe(true);
  });

  it('refuses the legacy tier together with the switch or the set', () => {
    for (const extra of [
      { isTierGated: true },
      { includedInTierIds: [basic] },
      { isTierGated: false },
    ]) {
      const result = createContentSchema.safeParse({
        ...video,
        isFree: false,
        includedInTierId: basic,
        ...extra,
      });
      expect(result.success, JSON.stringify(extra)).toBe(false);
      expect(messages(result)).toMatch(/not both/);
    }
  });

  it('holds the legacy tier to I2 and I4 too', () => {
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: true,
        includedInTierId: basic,
      }).success
    ).toBe(false);
    expect(
      createContentSchema.safeParse({
        ...video,
        isFree: false,
        includedInTierId: basic,
        isFollowerGated: true,
      }).success
    ).toBe(false);
  });
});

describe('update: partial payloads', () => {
  it('leaves the ticks alone when the set is absent', () => {
    const parsed = updateContentSchema.parse({ title: 'Renamed' });
    expect('includedInTierIds' in parsed).toBe(false);
    expect('isTierGated' in parsed).toBe(false);
  });

  it('accepts an empty set: the film stays gated and closed', () => {
    expect(updateContentSchema.parse({ includedInTierIds: [] })).toEqual({
      includedInTierIds: [],
    });
  });

  it('accepts a set without the switch (the existing switch stands)', () => {
    expect(
      updateContentSchema.safeParse({ includedInTierIds: [basic] }).success
    ).toBe(true);
  });

  it('refuses ticks beside an explicit switch-off', () => {
    expect(
      updateContentSchema.safeParse({
        isTierGated: false,
        includedInTierIds: [basic],
      }).success
    ).toBe(false);
  });

  it('accepts switching the gate off with no set (the service clears the ticks)', () => {
    expect(
      updateContentSchema.safeParse({ isTierGated: false, isFree: true })
        .success
    ).toBe(true);
  });

  it('refuses gated + free, gated + team, and gated while clearing the org', () => {
    for (const payload of [
      { isTierGated: true, isFree: true },
      { isTierGated: true, isTeamOnly: true },
      { isTierGated: true, organizationId: null },
    ]) {
      expect(
        updateContentSchema.safeParse(payload).success,
        JSON.stringify(payload)
      ).toBe(false);
    }
  });

  it('counts the switch as the gate of a non-free update', () => {
    expect(
      updateContentSchema.safeParse({ isFree: false, isTierGated: true })
        .success
    ).toBe(true);
    expect(
      updateContentSchema.safeParse({ isFree: false, isTierGated: false })
        .success
    ).toBe(false);
  });

  it('refuses the legacy tier beside the new fields', () => {
    expect(
      updateContentSchema.safeParse({
        includedInTierId: null,
        includedInTierIds: [],
      }).success
    ).toBe(false);
  });
});
