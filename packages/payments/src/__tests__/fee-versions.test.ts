/**
 * The dated fee resolver's pure parts (Codex-2hxff.33; batch C1 Part B data
 * design §1.3, §1.4, §1.5): layering, the version in force at `at`, the
 * write's classification table, when a rise starts, and the email's £10
 * example. The database half (`readFeeVersions`, `affectedPayees`,
 * `dateRiseIfAllTold`) is in fee-notices.integration.test.ts.
 */

import { FEES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import {
  classifyFeeWrite,
  codeDefaultFees,
  type DatedFeeVersion,
  exampleOneOffSplit,
  type FeeVersionList,
  type FeeVersionValues,
  feeRiseStartAfter,
  type LevelFees,
  layerFees,
  layerLevelFees,
  nextFeeNoticeRunAfter,
  resolveFeesAt,
  versionInForce,
} from '../fee-versions';

const NONE: FeeVersionValues = {
  platformFeePercent: null,
  oneOffOrgFeePercent: null,
  subscriptionOrgFeePercent: null,
  orgFeePercent: null,
  minPlatformFeeCents: null,
  minTransferCents: null,
};

const PLATFORM: FeeVersionValues = {
  platformFeePercent: 1200,
  oneOffOrgFeePercent: 1000,
  subscriptionOrgFeePercent: 1500,
  orgFeePercent: null,
  minPlatformFeeCents: 30,
  minTransferCents: 0,
};

function dated(
  changeId: string,
  effectiveFrom: string,
  values: Partial<FeeVersionValues>
): DatedFeeVersion {
  return { ...NONE, ...values, changeId, effectiveFrom };
}

describe('layerFees', () => {
  it('no level at all: the code constants, per kind of sale', () => {
    expect(layerFees('one_off', null)).toEqual({
      platformFeePercent: FEES.PLATFORM_PERCENT,
      orgFeePercent: FEES.ORG_PERCENT,
      minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
      minTransferCents: 0,
    });
    expect(layerFees('subscription', null).orgFeePercent).toBe(
      FEES.SUBSCRIPTION_ORG_PERCENT
    );
  });

  it('the platform picks its organisation fee by kind of sale', () => {
    expect(layerFees('one_off', PLATFORM).orgFeePercent).toBe(1000);
    expect(layerFees('subscription', PLATFORM).orgFeePercent).toBe(1500);
    expect(layerFees('one_off', PLATFORM).platformFeePercent).toBe(1200);
  });

  it('an organisation overrides only the values it sets', () => {
    const fees = layerFees('subscription', PLATFORM, {
      ...NONE,
      orgFeePercent: 500,
    });
    expect(fees).toEqual({
      platformFeePercent: 1200,
      orgFeePercent: 500,
      minPlatformFeeCents: 30,
      minTransferCents: 0,
    });
  });

  it('a creator override layers over the organisation, column by column', () => {
    const fees = layerFees(
      'one_off',
      PLATFORM,
      { ...NONE, orgFeePercent: 500, minTransferCents: 200 },
      { ...NONE, orgFeePercent: 0 }
    );
    expect(fees.orgFeePercent).toBe(0);
    expect(fees.minTransferCents).toBe(200);
    expect(fees.platformFeePercent).toBe(1200);
  });

  it('a removed level (every value NULL) inherits everything', () => {
    expect(layerFees('one_off', PLATFORM, NONE, NONE)).toEqual(
      layerFees('one_off', PLATFORM)
    );
  });
});

describe('versionInForce', () => {
  const list: FeeVersionList = {
    waiting: false,
    versions: [
      dated('c3', '2026-12-01T00:00:00.000Z', { orgFeePercent: 1500 }),
      dated('c2', '2026-06-01T00:00:00.000Z', { orgFeePercent: 1200 }),
      dated('c1', '1970-01-01T00:00:00.000Z', { orgFeePercent: 1000 }),
    ],
  };

  it('is the newest version dated no later than `at`', () => {
    expect(
      versionInForce(list, new Date('2026-07-01T00:00:00Z'))?.changeId
    ).toBe('c2');
    expect(
      versionInForce(list, new Date('2026-12-01T00:00:00Z'))?.changeId
    ).toBe('c3');
    expect(
      versionInForce(list, new Date('2026-11-30T23:59:59Z'))?.changeId
    ).toBe('c2');
  });

  it('is none before the first version, and for no list', () => {
    expect(
      versionInForce(
        { waiting: false, versions: [list.versions[0] as DatedFeeVersion] },
        new Date('2026-01-01T00:00:00Z')
      )
    ).toBeNull();
    expect(versionInForce(undefined, new Date())).toBeNull();
  });
});

describe('resolveFeesAt', () => {
  const lists: Record<string, FeeVersionList> = {
    platform: {
      waiting: false,
      versions: [dated('p1', '1970-01-01T00:00:00.000Z', PLATFORM)],
    },
    org: {
      waiting: true,
      versions: [
        dated('o2', '2026-12-05T00:00:00.000Z', { platformFeePercent: 1400 }),
        dated('o1', '1970-01-01T00:00:00.000Z', { orgFeePercent: 800 }),
      ],
    },
    creator: {
      waiting: false,
      versions: [dated('x1', '1970-01-01T00:00:00.000Z', { orgFeePercent: 0 })],
    },
  };
  const read = async (level: { scope: string }) =>
    lists[level.scope] ?? { waiting: false, versions: [] };

  it('each sale gets the fee in force at its own time', async () => {
    const before = await resolveFeesAt(read, {
      organizationId: 'org',
      creatorId: 'cr',
      ctx: 'one_off',
      at: new Date('2026-12-04T23:00:00Z'),
    });
    const after = await resolveFeesAt(read, {
      organizationId: 'org',
      creatorId: 'cr',
      ctx: 'one_off',
      at: new Date('2026-12-05T00:00:00Z'),
    });
    expect(before.platformFeePercent).toBe(1200);
    expect(after.platformFeePercent).toBe(1400);
    // The organisation's newer version doesn't restate orgFeePercent, and a
    // level's in-force version is the whole level: it inherits from the
    // platform now, and the creator's 0% still layers over it.
    expect(after.orgFeePercent).toBe(0);
  });

  it('with no organisation it reads the platform alone', async () => {
    const fees = await resolveFeesAt(read, {
      ctx: 'subscription',
      at: new Date('2027-01-01T00:00:00Z'),
    });
    expect(fees).toEqual(layerFees('subscription', PLATFORM));
  });
});

describe('classifyFeeWrite (data design §1.3)', () => {
  const at = (platform: number, org = 1000, minTransfer = 0): LevelFees =>
    layerLevelFees({
      ...PLATFORM,
      platformFeePercent: platform,
      oneOffOrgFeePercent: org,
      minTransferCents: minTransfer,
    });
  const T = at(1000);

  it('no waiting rise, nothing higher: a cut (equal counts as a cut)', () => {
    expect(classifyFeeWrite(T, null, at(800))).toBe('cut');
    expect(classifyFeeWrite(T, null, at(1000))).toBe('cut');
  });

  it('no waiting rise, anything higher: a rise', () => {
    expect(classifyFeeWrite(T, null, at(1200))).toBe('rise');
  });

  it('F1: higher in one place and lower in another waits as a whole', () => {
    expect(classifyFeeWrite(T, null, at(1200, 500))).toBe('rise');
  });

  it('F9: raising the minimum transfer is a rise', () => {
    expect(classifyFeeWrite(T, null, at(1000, 1000, 500))).toBe('rise');
  });

  it('a cleared value is compared as what it inherits (losing a waiver)', () => {
    const waiver = layerLevelFees(PLATFORM, { ...NONE, orgFeePercent: 0 });
    const cleared = layerLevelFees(PLATFORM, NONE);
    expect(classifyFeeWrite(waiver, null, cleared)).toBe('rise');
  });

  it('a waiting rise: back to today exactly is cancelled', () => {
    expect(classifyFeeWrite(T, at(1200), at(1000))).toBe('cancelled');
  });

  it('a waiting rise: below today is a cut below today', () => {
    expect(classifyFeeWrite(T, at(1200), at(900))).toBe('cut_below_today');
  });

  it('a waiting rise made smaller, still above today: smaller', () => {
    expect(classifyFeeWrite(T, at(1200), at(1100))).toBe('smaller');
  });

  it('a waiting rise restated with the same figures: same as waiting', () => {
    expect(classifyFeeWrite(T, at(1200), at(1200))).toBe('same_as_waiting');
  });

  it('above the waiting rise anywhere: bigger', () => {
    expect(classifyFeeWrite(T, at(1200), at(1300))).toBe('bigger');
    expect(classifyFeeWrite(T, at(1200), at(1100, 1000, 500))).toBe('bigger');
  });
});

describe('feeRiseStartAfter (Q1: the first UK midnight at least 30 days on)', () => {
  it('winter: 08:00 GMT on 3 Nov starts on 4 Dec, 00:00 GMT', () => {
    expect(
      feeRiseStartAfter(new Date('2026-11-03T08:00:00Z')).toISOString()
    ).toBe('2026-12-04T00:00:00.000Z');
  });

  it('summer: midnight BST is 23:00 UTC the day before', () => {
    // 08:00 UTC on 2 June + 30 days = 2 July 08:00 UTC; next UK midnight is
    // 3 July 00:00 BST = 2 July 23:00 UTC.
    expect(
      feeRiseStartAfter(new Date('2026-06-02T08:00:00Z')).toISOString()
    ).toBe('2026-07-02T23:00:00.000Z');
  });

  it('across the October clock change: the date is the GMT midnight', () => {
    // 1 Oct 08:00 UTC + 30 days = 31 Oct 08:00 UTC (clocks went back on 25
    // Oct), so 1 Nov 00:00 GMT.
    expect(
      feeRiseStartAfter(new Date('2026-10-01T08:00:00Z')).toISOString()
    ).toBe('2026-11-01T00:00:00.000Z');
  });

  it('exactly 30 days to a UK midnight is that midnight, never a day later', () => {
    expect(
      feeRiseStartAfter(new Date('2026-11-04T00:00:00Z')).toISOString()
    ).toBe('2026-12-04T00:00:00.000Z');
  });

  it('is never less than 30 × 24 h after the notice', () => {
    for (const iso of [
      '2026-03-01T23:30:00Z',
      '2026-03-28T08:00:00Z',
      '2026-10-24T23:59:59Z',
    ]) {
      const told = new Date(iso);
      const start = feeRiseStartAfter(told);
      expect(start.getTime() - told.getTime()).toBeGreaterThanOrEqual(
        30 * 24 * 60 * 60 * 1000
      );
      expect(start.getTime() - told.getTime()).toBeLessThan(
        31 * 24 * 60 * 60 * 1000
      );
    }
  });
});

describe('nextFeeNoticeRunAfter (the 0 8 * * * UTC run)', () => {
  it('is today at 08:00 UTC before it, tomorrow from it', () => {
    expect(
      nextFeeNoticeRunAfter(new Date('2026-11-02T07:59:00Z')).toISOString()
    ).toBe('2026-11-02T08:00:00.000Z');
    expect(
      nextFeeNoticeRunAfter(new Date('2026-11-02T08:00:00Z')).toISOString()
    ).toBe('2026-11-03T08:00:00.000Z');
  });
});

describe('exampleOneOffSplit (fees-and-splits.md, one-off table)', () => {
  const fees = (platform: number, org: number, min: number) => ({
    ...codeDefaultFees('one_off'),
    platformFeePercent: platform,
    orgFeePercent: org,
    minPlatformFeeCents: min,
  });

  it('£10.00, no agreement: 100 / 90 / 810', () => {
    expect(exampleOneOffSplit(fees(1000, 1000, 25), 1000, false)).toEqual({
      platformCents: 100,
      orgCents: 90,
      creatorCents: 810,
    });
  });

  it('the email example: a 12% fee leaves the creator £7.92 and the organisation 88p', () => {
    expect(exampleOneOffSplit(fees(1200, 1000, 25), 1000, false)).toEqual({
      platformCents: 120,
      orgCents: 88,
      creatorCents: 792,
    });
  });

  it('£1.00 with the 25p floor: 25 / 9 / 66 (the shortfall from the creator)', () => {
    expect(exampleOneOffSplit(fees(1000, 1000, 25), 100, false)).toEqual({
      platformCents: 25,
      orgCents: 9,
      creatorCents: 66,
    });
  });

  it('orgless: no organisation slice', () => {
    expect(exampleOneOffSplit(fees(1000, 1000, 25), 1000, true)).toEqual({
      platformCents: 100,
      orgCents: 0,
      creatorCents: 900,
    });
  });
});
