/**
 * The payout-schedule backfill (Codex-2hxff.29, .30; data design §3.4), with
 * a fake Stripe and an in-memory account list: no database, no network.
 */

import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  apply,
  assertKeyMatchesEnv,
  type BackfillDeps,
  type OurAccount,
  parseArgs,
  survey,
} from '../backfill-payout-schedule';

interface FakeStripeAccount {
  interval: string;
  debit: boolean;
  env?: string;
  retrieveError?: unknown;
}

function ours(
  id: string,
  source: OurAccount['source'] = 'current'
): OurAccount {
  return {
    stripeAccountId: id,
    connectRowId: `row-${id}`,
    userId: `user-${id}`,
    source,
  };
}

/** A fake Stripe over `accounts`; `update` switches an account for real. */
function fake(
  accounts: Map<string, FakeStripeAccount>,
  { updateAllowed = true }: { updateAllowed?: boolean } = {}
) {
  const asStripe = (id: string, account: FakeStripeAccount) => ({
    id,
    metadata: account.env ? { codex_env: account.env } : {},
    settings: {
      payouts: {
        schedule: { interval: account.interval, delay_days: 7 },
        debit_negative_balances: account.debit,
      },
    },
  });
  const retrieve = vi.fn(async (id: string) => {
    const account = accounts.get(id);
    if (!account)
      throw Object.assign(new Error('missing'), { code: 'resource_missing' });
    if (account.retrieveError) throw account.retrieveError;
    return asStripe(id, account);
  });
  const update = vi.fn(async (id: string) => {
    if (!updateAllowed) throw new Error('accounts.update called in a dry run');
    const account = accounts.get(id);
    if (!account) throw new Error('missing');
    account.interval = 'manual';
    account.debit = false;
    return asStripe(id, account);
  });
  const balance = vi.fn(async () => ({
    available: [{ amount: 1234, currency: 'gbp' }],
    pending: [{ amount: 100, currency: 'gbp' }],
  }));
  return {
    retrieve,
    update,
    stripe: {
      accounts: { retrieve, update },
      balance: { retrieve: balance },
    } as unknown as Stripe,
  };
}

function depsFor(
  stripe: Stripe,
  list: OurAccount[]
): BackfillDeps & { lines: string[]; marked: string[] } {
  const lines: string[] = [];
  const marked: string[] = [];
  return {
    stripe,
    lines,
    marked,
    accounts: async () => list,
    markManual: async (account) => {
      marked.push(account.stripeAccountId);
    },
    print: (line) => lines.push(line),
  };
}

const stripeDefault = (env = 'production'): FakeStripeAccount => ({
  interval: 'daily',
  debit: true,
  env,
});

describe('backfill-payout-schedule', () => {
  it('a dry run reads every account and makes no accounts.update call', async () => {
    const accounts = new Map([
      ['acct_a', stripeDefault()],
      ['acct_b', { interval: 'manual', debit: false, env: 'production' }],
      ['acct_old', stripeDefault()],
    ]);
    const { stripe, update } = fake(accounts, { updateAllowed: false });
    const deps = depsFor(stripe, [
      ours('acct_a'),
      ours('acct_b'),
      ours('acct_old', 'replaced'),
    ]);

    const { lines, checksum } = await survey(deps, 'production');

    expect(update).not.toHaveBeenCalled();
    expect(deps.marked).toEqual([]);
    expect(
      lines.map((line) => [line.account.stripeAccountId, line.action])
    ).toEqual([
      ['acct_a', 'switch'],
      ['acct_b', 'already manual + debit off'],
      ['acct_old', 'switch'],
    ]);
    expect(deps.lines).toContain(`checksum: ${checksum}`);
    // One line per account, with our row id and never an email.
    expect(deps.lines.find((line) => line.startsWith('acct_a |'))).toBe(
      'acct_a | row-acct_a (current) | production | daily / 7 | true | 12.34 | 1.00 | switch'
    );
  });

  it('skips an account tagged for another environment, and leaves it out of the checksum', async () => {
    const accounts = new Map([
      ['acct_prod', stripeDefault('production')],
      ['acct_dev', stripeDefault('development')],
      ['acct_untagged', { interval: 'daily', debit: true }],
    ]);
    const { stripe } = fake(accounts, { updateAllowed: false });
    const withDev = await survey(
      depsFor(stripe, [
        ours('acct_prod'),
        ours('acct_dev'),
        ours('acct_untagged'),
      ]),
      'production'
    );
    const withoutDev = await survey(
      depsFor(stripe, [ours('acct_prod'), ours('acct_untagged')]),
      'production'
    );

    expect(
      withDev.lines.find((line) => line.account.stripeAccountId === 'acct_dev')
        ?.action
    ).toBe('skip: env tag differs');
    // Untagged accounts predate the tag: they are ours.
    expect(
      withDev.lines.find(
        (line) => line.account.stripeAccountId === 'acct_untagged'
      )?.action
    ).toBe('switch');
    expect(withDev.checksum).toBe(withoutDev.checksum);
  });

  it('a deauthorized account, or another Stripe error, is skipped by name', async () => {
    const accounts = new Map<string, FakeStripeAccount>([
      [
        'acct_gone',
        {
          ...stripeDefault(),
          retrieveError: Object.assign(new Error('no access'), {
            type: 'StripePermissionError',
            code: 'account_invalid',
          }),
        },
      ],
      [
        'acct_err',
        {
          ...stripeDefault(),
          retrieveError: Object.assign(new Error('rate'), {
            type: 'StripeRateLimitError',
            code: 'rate_limit',
          }),
        },
      ],
    ]);
    const { stripe } = fake(accounts, { updateAllowed: false });

    const { lines } = await survey(
      depsFor(stripe, [ours('acct_gone'), ours('acct_err')]),
      'production'
    );

    expect(lines.map((line) => line.action)).toEqual([
      'skip: deauthorized',
      'skip: Stripe error rate_limit',
    ]);
  });

  it('--apply refuses a stale checksum and writes nothing', async () => {
    const accounts = new Map([['acct_a', stripeDefault()]]);
    const { stripe, update } = fake(accounts);
    const deps = depsFor(stripe, [ours('acct_a')]);

    await expect(apply(deps, 'production', 'not-the-checksum')).rejects.toThrow(
      /changed since the dry run/
    );
    expect(update).not.toHaveBeenCalled();
    expect(deps.marked).toEqual([]);
  });

  it('--apply switches each account under its key, flags it, and a re-run is a no-op', async () => {
    const accounts = new Map([
      ['acct_a', stripeDefault()],
      ['acct_b', { interval: 'manual', debit: false, env: 'production' }],
    ]);
    const { stripe, update } = fake(accounts);
    const list = [ours('acct_a'), ours('acct_b')];
    const { checksum } = await survey(depsFor(stripe, list), 'production');
    const deps = depsFor(stripe, list);

    const result = await apply(deps, 'production', checksum);

    expect(update).toHaveBeenCalledExactlyOnceWith(
      'acct_a',
      {
        settings: {
          payouts: {
            schedule: { interval: 'manual' },
            debit_negative_balances: false,
          },
        },
      },
      expect.objectContaining({
        idempotencyKey: 'codex_manual_payouts_acct_a',
        timeout: 20_000,
      })
    );
    expect(result).toEqual({
      switched: ['acct_a'],
      alreadyDone: ['acct_b'],
      failed: [],
    });
    expect(deps.marked).toEqual(['acct_a', 'acct_b']);

    // Re-run: nothing left to switch, so no Stripe write at all.
    update.mockClear();
    const again = await survey(depsFor(stripe, list), 'production');
    const rerun = await apply(
      depsFor(stripe, list),
      'production',
      again.checksum
    );
    expect(update).not.toHaveBeenCalled();
    expect(rerun.switched).toEqual([]);
  });

  describe('the key and the flags', () => {
    it('production needs a live key; any other environment a test key', () => {
      const prod = parseArgs(['--env', 'production']);
      expect(() => assertKeyMatchesEnv('sk_live_x', prod)).not.toThrow();
      expect(() => assertKeyMatchesEnv('sk_test_x', prod)).toThrow(/live-mode/);
      const test = parseArgs(['--env', 'test']);
      expect(() => assertKeyMatchesEnv('sk_test_x', test)).not.toThrow();
      expect(() => assertKeyMatchesEnv('rk_live_x', test)).toThrow(/test-mode/);
      expect(() => assertKeyMatchesEnv(undefined, test)).toThrow();
    });

    it('--apply on a live key also needs --live', () => {
      expect(() =>
        assertKeyMatchesEnv(
          'sk_live_x',
          parseArgs(['--env', 'production', '--apply', '--confirm', 'abc'])
        )
      ).toThrow(/without --live/);
      expect(() =>
        assertKeyMatchesEnv(
          'sk_live_x',
          parseArgs([
            '--env',
            'production',
            '--apply',
            '--confirm',
            'abc',
            '--live',
          ])
        )
      ).not.toThrow();
    });

    it('a dry run is the default; --apply needs --confirm', () => {
      expect(parseArgs(['--env', 'test'])).toEqual({
        env: 'test',
        apply: false,
        confirm: null,
        live: false,
      });
      expect(() => parseArgs(['--env', 'test', '--apply'])).toThrow(
        /--confirm/
      );
      expect(() => parseArgs([])).toThrow(/--env/);
    });
  });
});
