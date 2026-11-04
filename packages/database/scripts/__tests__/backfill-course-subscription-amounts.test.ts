/**
 * The course subscription amount backfill (Codex-2hxff.52): a dry run writes
 * nothing, an apply writes each live row's Stripe price once, a re-run is a
 * no-op, and a bounded run says where to carry on.
 *
 * The run against a fake Stripe and fake rows; then the database side on a
 * real DB (skipped without DB_METHOD), rows of its own, deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  type AmountBackfillDeps,
  databaseDeps,
  type MissingAmountRow,
  parseArgs,
  run,
} from '../backfill-course-subscription-amounts';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/** Stripe's subscriptions by id: their item price and env tag. */
function fakeStripe(
  subs: Record<string, { unitAmount: number | null; env?: string } | Error>
) {
  const retrieve = vi.fn(async (id: string) => {
    const sub = subs[id];
    if (!sub) {
      throw Object.assign(new Error('No such subscription'), {
        code: 'resource_missing',
      });
    }
    if (sub instanceof Error) throw sub;
    return {
      id,
      metadata: sub.env ? { codex_env: sub.env } : {},
      items: { data: [{ price: { unit_amount: sub.unitAmount } }] },
    };
  });
  return {
    retrieve,
    stripe: { subscriptions: { retrieve } } as unknown as Pick<
      Stripe,
      'subscriptions'
    >,
  };
}

/** Rows without an amount, held in memory as the database would. */
function fakeRows(rows: MissingAmountRow[]) {
  const amounts = new Map<string, number>();
  const writeAmount = vi.fn(async (id: string, amountCents: number) => {
    if (amounts.has(id)) return false;
    amounts.set(id, amountCents);
    return true;
  });
  const deps: Pick<AmountBackfillDeps, 'rowsMissingAmount' | 'writeAmount'> = {
    async rowsMissingAmount(after, limit) {
      return rows
        .filter((row) => !amounts.has(row.id))
        .filter((row) => after === null || row.id > after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    writeAmount,
  };
  return { deps, amounts, writeAmount };
}

const ROWS: MissingAmountRow[] = [
  { id: '00000000-0000-4000-8000-000000000001', stripeSubscriptionId: 'sub_a' },
  { id: '00000000-0000-4000-8000-000000000002', stripeSubscriptionId: 'sub_b' },
  { id: '00000000-0000-4000-8000-000000000003', stripeSubscriptionId: 'sub_c' },
  { id: '00000000-0000-4000-8000-000000000004', stripeSubscriptionId: 'sub_d' },
];

describe('backfill-course-subscription-amounts', () => {
  const subs = {
    sub_a: { unitAmount: 5000 },
    sub_b: { unitAmount: 1200, env: 'dev' },
    sub_c: { unitAmount: null },
    sub_d: Object.assign(new Error('rate limited'), { code: 'rate_limit' }),
  };

  it('dry run by default: reads Stripe, writes nothing, prints ids and amounts only', async () => {
    const { stripe } = fakeStripe(subs);
    const { deps, writeAmount } = fakeRows(ROWS);
    const printed: string[] = [];

    const result = await run(
      { stripe, ...deps, print: (line) => printed.push(line) },
      { ...parseArgs(['--env', 'test']), limit: 10 }
    );

    expect(writeAmount).not.toHaveBeenCalled();
    expect(result.counts).toEqual({
      write: 1,
      'skip: env tag differs': 1,
      'skip: no unit amount': 1,
      'skip: Stripe error rate_limit': 1,
    });
    expect(printed).toContain(
      '00000000-0000-4000-8000-000000000001 | sub_a | £50.00 | write'
    );
    expect(printed.join('\n')).not.toMatch(/@/);
  });

  it('apply writes the live price once; a re-run is a no-op', async () => {
    const { stripe, retrieve } = fakeStripe(subs);
    const { deps, amounts } = fakeRows(ROWS);
    const args = { ...parseArgs(['--env', 'test', '--apply']), limit: 10 };

    const first = await run({ stripe, ...deps, print: () => {} }, args);
    expect(first.counts.written).toBe(1);
    expect([...amounts]).toEqual([
      ['00000000-0000-4000-8000-000000000001', 5000],
    ]);

    retrieve.mockClear();
    const again = await run({ stripe, ...deps, print: () => {} }, args);
    // The written row is not read again; the skipped ones still are.
    expect(retrieve).not.toHaveBeenCalledWith('sub_a', {}, expect.anything());
    expect(again.counts.written).toBeUndefined();
  });

  it('a webhook that wrote the amount meanwhile wins: already set', async () => {
    const { stripe } = fakeStripe({ sub_a: { unitAmount: 5000 } });
    const { deps, amounts } = fakeRows([ROWS[0] as MissingAmountRow]);
    const racing: AmountBackfillDeps = {
      stripe,
      rowsMissingAmount: deps.rowsMissingAmount,
      async writeAmount(id, amountCents) {
        amounts.set(id, 4900); // the webhook, between the read and the write
        return deps.writeAmount(id, amountCents);
      },
      print: () => {},
    };

    const result = await run(racing, {
      ...parseArgs(['--env', 'test', '--apply']),
      limit: 10,
    });

    expect(result.counts).toEqual({ 'already set': 1 });
    expect(amounts.get(ROWS[0]?.id ?? '')).toBe(4900);
  });

  it('bounded: stops at --limit and names the --after to carry on from', async () => {
    const all = Object.fromEntries(
      ROWS.map((row) => [row.stripeSubscriptionId, { unitAmount: 5000 }])
    );
    const { stripe } = fakeStripe(all);
    const { deps, amounts } = fakeRows(ROWS);
    const print = vi.fn();

    const first = await run(
      { stripe, ...deps, print },
      parseArgs(['--env', 'test', '--apply', '--limit', '3'])
    );
    expect(first).toMatchObject({
      read: 3,
      next: '00000000-0000-4000-8000-000000000003',
    });
    expect(print).toHaveBeenCalledWith(
      'limit reached; carry on with --after 00000000-0000-4000-8000-000000000003'
    );

    const rest = await run(
      { stripe, ...deps, print },
      parseArgs([
        '--env',
        'test',
        '--apply',
        '--limit',
        '3',
        '--after',
        first.next ?? '',
      ])
    );
    expect(rest).toMatchObject({ read: 1, next: null });
    expect(amounts.size).toBe(4);
  });

  it.each([
    [['--env', 'test', '--limit', '0'], /--limit/],
    [['--env', 'test', '--limit', '5000'], /--limit/],
    [['--env', 'test', '--after', 'sub_a'], /--after/],
    [['--apply'], /--env/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  // ─── The database side ────────────────────────────────────────────────

  describe.skipIf(!HAS_DB)('on the database', () => {
    const tag = `amtbf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `user-${tag}`;
    let orgId = '';

    afterAll(async () => {
      const { dbHttp } = await import('../../src');
      const schema = await import('../../src/schema');
      await dbHttp
        .delete(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.userId, userId));
      const courseIds = (
        await dbHttp
          .select({ id: schema.courses.id })
          .from(schema.courses)
          .where(eq(schema.courses.creatorId, userId))
      ).map((course) => course.id);
      if (courseIds.length > 0) {
        await dbHttp
          .delete(schema.courseSubscriptionPlans)
          .where(inArray(schema.courseSubscriptionPlans.courseId, courseIds));
        await dbHttp
          .delete(schema.courses)
          .where(inArray(schema.courses.id, courseIds));
      }
      if (orgId) {
        await dbHttp
          .delete(schema.organizations)
          .where(eq(schema.organizations.id, orgId));
      }
      await dbHttp.delete(schema.users).where(eq(schema.users.id, userId));
    });

    it('reads live rows without an amount only, and writes only where it is still missing', async () => {
      const { dbHttp } = await import('../../src');
      const schema = await import('../../src/schema');
      await dbHttp.insert(schema.users).values({
        id: userId,
        name: 'Amount Backfill',
        email: `${tag}@example.test`,
      });
      const [org] = await dbHttp
        .insert(schema.organizations)
        .values({ name: 'Amount Backfill', slug: tag })
        .returning({ id: schema.organizations.id });
      orgId = org?.id ?? '';
      // One live subscription per user and course: a course each.
      const courseAndPlan = async (name: string) => {
        const [course] = await dbHttp
          .insert(schema.courses)
          .values({
            organizationId: orgId,
            creatorId: userId,
            slug: `${tag}-${name}`,
            title: `Amount Backfill ${name}`,
          })
          .returning({ id: schema.courses.id });
        const [plan] = await dbHttp
          .insert(schema.courseSubscriptionPlans)
          .values({
            courseId: course?.id ?? '',
            priceMonthly: 5000,
            priceAnnual: 50000,
          })
          .returning({ id: schema.courseSubscriptionPlans.id });
        return { courseId: course?.id ?? '', planId: plan?.id ?? '' };
      };
      const row = async (
        name: string,
        extra: Partial<typeof schema.courseSubscriptions.$inferInsert> = {}
      ) => ({
        userId,
        ...(await courseAndPlan(name)),
        organizationId: orgId,
        stripeSubscriptionId: `sub_${name}_${randomUUID().slice(0, 8)}`,
        stripeCustomerId: `cus_${tag}`,
        status: 'active',
        billingInterval: 'month',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        ...extra,
      });
      const inserted = await dbHttp
        .insert(schema.courseSubscriptions)
        .values([
          await row('missing'),
          await row('ended', { status: 'cancelled', endedAt: new Date() }),
          await row('recorded', { amountCents: 4000 }),
        ])
        .returning({
          id: schema.courseSubscriptions.id,
          stripeSubscriptionId: schema.courseSubscriptions.stripeSubscriptionId,
        });
      const [missing, ended, recorded] = inserted;
      const deps = await databaseDeps(dbHttp);

      const found = (await deps.rowsMissingAmount(null, 1000)).map((r) => r.id);
      expect(found).toContain(missing?.id);
      expect(found).not.toContain(ended?.id);
      expect(found).not.toContain(recorded?.id);
      // Keyset: nothing at or before the id given.
      const afterIt = await deps.rowsMissingAmount(missing?.id ?? null, 1000);
      expect(afterIt.map((r) => r.id)).not.toContain(missing?.id);

      expect(await deps.writeAmount(missing?.id ?? '', 5000)).toBe(true);
      expect(await deps.writeAmount(missing?.id ?? '', 6000)).toBe(false);
      expect(await deps.writeAmount(recorded?.id ?? '', 6000)).toBe(false);
      const amounts = await dbHttp
        .select({
          id: schema.courseSubscriptions.id,
          amountCents: schema.courseSubscriptions.amountCents,
        })
        .from(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.userId, userId));
      const byId = new Map(amounts.map((a) => [a.id, a.amountCents]));
      expect(byId.get(missing?.id ?? '')).toBe(5000);
      expect(byId.get(recorded?.id ?? '')).toBe(4000);
      expect(byId.get(ended?.id ?? '')).toBeNull();
    });
  });
});
