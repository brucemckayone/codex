/**
 * Move every existing Connect account to manual payouts with bank debit off
 * (Codex-2hxff.29, .30; data design §3.4).
 *
 * New accounts are created that way (connect-account-service.ts). This script
 * switches the accounts made before, so the daily bank payout job pays them
 * out 14 days after each sale and Stripe never debits a creator's bank for a
 * negative balance. Stripe's default for these accounts is the opposite on
 * both counts (daily, 7 days; `debit_negative_balances: true`; map §7 check 3).
 *
 * In production this is a write to live Stripe: it runs only with the
 * owner's OK, after the deploy and after the Dashboard settings below.
 *
 * DRY RUN (the default; writes nothing, to Stripe or the database):
 *
 *   pnpm --filter @codex/database exec tsx scripts/backfill-payout-schedule.ts --env production
 *
 *   One line per account in OUR database (stripe_connect_accounts plus
 *   stripe_connect_account_history): the account, our row id (never an email),
 *   its codex_env tag, its schedule, debit_negative_balances, its GBP balance
 *   and the action. Then the counts and a checksum of the accounts to switch.
 *
 * APPLY:
 *
 *   … --env production --apply --confirm <checksum> --live
 *
 *   While production runs on Stripe TEST keys (owner, 2026-10-29), pass
 *   `--test-keys` instead of `--live`, on the dry run and on the apply.
 *
 *   Re-reads every account and refuses if the set to switch has changed since
 *   the dry run. Each is updated under the key `codex_manual_payouts_<acct>`;
 *   the settings Stripe returns are checked, and only then is the account
 *   flagged in `connect_balances` (the job's account set). An account already
 *   on both settings is not written to Stripe again, so a re-run is a no-op.
 *
 * Safety:
 *   - The key must match --env: `sk_live_`/`rk_live_` for production, a test
 *     key otherwise. `--apply` with a live key also needs `--live`.
 *     Production takes a test key only with `--test-keys`, said out loud, so
 *     a dev key run against the production database by mistake still refuses
 *     (Codex-2hxff.92).
 *   - Only accounts in this environment's database are read, and one tagged
 *     for another environment is skipped (production and dev share a sandbox).
 *   - Per-account failures are printed and skipped.
 *
 * Rollout (docs/payments/operations.md → Payout schedule):
 *   1. Deploy. New accounts are manual; the job only pays flagged accounts.
 *   2. Owner: Stripe Dashboard → Connect → Express dashboard settings, turn
 *      off payout-schedule editing, self-serve manual payouts and Instant
 *      Payouts. No API can check these.
 *   3. Dry run and apply in TEST mode, on one production-shaped account.
 *   4. The owner reads the production dry run and gives the OK. 5. Apply.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isForeignStripeEnvironment } from '@codex/constants';
import Stripe from 'stripe';

const STRIPE_API_VERSION = '2025-10-29.clover' as const;

/** Each Stripe call gives up after 20 s; a retry replays its key. */
const STRIPE_REQUEST = {
  timeout: 20_000,
  maxNetworkRetries: 2,
} as const satisfies Stripe.RequestOptions;

const MANUAL_PAYOUT_SETTINGS = {
  payouts: {
    schedule: { interval: 'manual' },
    debit_negative_balances: false,
  },
} as const satisfies Stripe.AccountUpdateParams.Settings;

// ─── Arguments and the key ─────────────────────────────────────────────────

export interface BackfillArgs {
  env: string;
  apply: boolean;
  confirm: string | null;
  live: boolean;
  /** Production is on Stripe test keys for now (Codex-2hxff.92). */
  testKeys: boolean;
}

export function parseArgs(argv: readonly string[]): BackfillArgs {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    const next = at === -1 ? undefined : argv[at + 1];
    return next && !next.startsWith('--') ? next : null;
  };
  const env = value('--env');
  if (!env) {
    throw new Error('--env is required (production, or the test environment)');
  }
  const args: BackfillArgs = {
    env,
    apply: argv.includes('--apply'),
    confirm: value('--confirm'),
    live: argv.includes('--live'),
    testKeys: argv.includes('--test-keys'),
  };
  if (args.apply && !args.confirm) {
    throw new Error(
      '--apply needs --confirm <checksum>, printed by the dry run'
    );
  }
  return args;
}

export function keyMode(key: string | undefined): 'live' | 'test' | 'unknown' {
  if (!key) return 'unknown';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

/**
 * The key must be the environment's: live for production, test otherwise.
 * Production takes a test key only with `--test-keys`, while it runs on test
 * keys, and `--test-keys` beside a live key is refused as a contradiction.
 * Writing to live Stripe takes `--live` as well as `--apply`. Never prints
 * the key.
 */
export function assertKeyMatchesEnv(
  key: string | undefined,
  args: BackfillArgs
): void {
  const mode = keyMode(key);
  if (args.testKeys && mode === 'live') {
    throw new Error(
      '--test-keys was given, but STRIPE_SECRET_KEY is a live-mode key'
    );
  }
  const wanted = args.env === 'production' && !args.testKeys ? 'live' : 'test';
  if (mode !== wanted) {
    throw new Error(
      `--env ${args.env} needs a ${wanted}-mode Stripe key; STRIPE_SECRET_KEY is ${mode}` +
        (args.env === 'production' && mode === 'test'
          ? ' (pass --test-keys while production runs on test keys)'
          : '')
    );
  }
  if (args.apply && mode === 'live' && !args.live) {
    throw new Error(
      'REFUSING to write to LIVE Stripe without --live (and the owner’s OK)'
    );
  }
}

// ─── The survey ────────────────────────────────────────────────────────────

/** One account in OUR database. */
export interface OurAccount {
  stripeAccountId: string;
  /** Our row id (a uuid), printed in place of anything personal. */
  connectRowId: string;
  userId: string;
  source: 'current' | 'replaced';
}

export type BackfillAction =
  | 'switch'
  | 'already manual + debit off'
  | 'skip: env tag differs'
  | 'skip: deauthorized'
  | `skip: Stripe error ${string}`;

export interface SurveyLine {
  account: OurAccount;
  action: BackfillAction;
  envTag: string | null;
  schedule: string;
  debitNegativeBalances: boolean | null;
  availableCents: number | null;
  pendingCents: number | null;
}

export interface BackfillDeps {
  stripe: Stripe;
  /** Every account in this environment's database, current and replaced. */
  accounts(): Promise<OurAccount[]>;
  /** Flag the account for the daily job, keeping an earlier switch date. */
  markManual(account: OurAccount, at: Date): Promise<void>;
  print(line: string): void;
}

function errorCode(error: unknown): string {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

function isDeauthorized(error: unknown): boolean {
  const type =
    error && typeof error === 'object'
      ? (error as { type?: unknown }).type
      : undefined;
  return (
    type === 'StripePermissionError' || errorCode(error) === 'account_invalid'
  );
}

function isSwitched(account: Stripe.Account): boolean {
  const payouts = account.settings?.payouts;
  return (
    payouts?.schedule?.interval === 'manual' &&
    payouts.debit_negative_balances === false
  );
}

async function surveyOne(
  deps: BackfillDeps,
  env: string,
  account: OurAccount
): Promise<SurveyLine> {
  const line: SurveyLine = {
    account,
    action: 'switch',
    envTag: null,
    schedule: '?',
    debitNegativeBalances: null,
    availableCents: null,
    pendingCents: null,
  };
  let stripeAccount: Stripe.Account;
  try {
    stripeAccount = await deps.stripe.accounts.retrieve(
      account.stripeAccountId,
      {},
      STRIPE_REQUEST
    );
  } catch (error) {
    line.action = isDeauthorized(error)
      ? 'skip: deauthorized'
      : `skip: Stripe error ${errorCode(error)}`;
    return line;
  }
  const payouts = stripeAccount.settings?.payouts;
  line.envTag = stripeAccount.metadata?.codex_env ?? null;
  line.schedule = `${payouts?.schedule?.interval ?? '?'} / ${payouts?.schedule?.delay_days ?? '?'}`;
  line.debitNegativeBalances = payouts?.debit_negative_balances ?? null;
  try {
    const balance = await deps.stripe.balance.retrieve(
      {},
      { ...STRIPE_REQUEST, stripeAccount: account.stripeAccountId }
    );
    const gbp = (funds: Stripe.Balance.Available[]) =>
      funds
        .filter((fund) => fund.currency === 'gbp')
        .reduce((sum, fund) => sum + fund.amount, 0);
    line.availableCents = gbp(balance.available);
    line.pendingCents = gbp(balance.pending);
  } catch {
    // The balance is for the owner's reading only; the action stands.
  }
  if (isForeignStripeEnvironment(stripeAccount.metadata, env)) {
    line.action = 'skip: env tag differs';
  } else if (isSwitched(stripeAccount)) {
    line.action = 'already manual + debit off';
  }
  return line;
}

/** A hash of the sorted accounts to switch: what `--confirm` must repeat. */
export function switchChecksum(lines: readonly SurveyLine[]): string {
  const ids = lines
    .filter((line) => line.action === 'switch')
    .map((line) => line.account.stripeAccountId)
    .sort();
  return createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16);
}

const pence = (cents: number | null) =>
  cents === null ? '?' : (cents / 100).toFixed(2);

export async function survey(
  deps: BackfillDeps,
  env: string
): Promise<{ lines: SurveyLine[]; checksum: string }> {
  const seen = new Set<string>();
  const accounts = (await deps.accounts()).filter((account) => {
    if (seen.has(account.stripeAccountId)) return false;
    seen.add(account.stripeAccountId);
    return true;
  });
  const lines: SurveyLine[] = [];
  deps.print(
    'acct | connect row id | codex_env | interval / delay | debit_negative_balances | available | pending | action'
  );
  for (const account of accounts) {
    const line = await surveyOne(deps, env, account);
    lines.push(line);
    deps.print(
      [
        account.stripeAccountId,
        `${account.connectRowId} (${account.source})`,
        line.envTag ?? '-',
        line.schedule,
        line.debitNegativeBalances ?? '?',
        pence(line.availableCents),
        pence(line.pendingCents),
        line.action,
      ].join(' | ')
    );
  }
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.action, (counts.get(line.action) ?? 0) + 1);
  }
  for (const [action, count] of counts) deps.print(`${action}: ${count}`);
  const checksum = switchChecksum(lines);
  deps.print(`checksum: ${checksum}`);
  return { lines, checksum };
}

// ─── Apply ─────────────────────────────────────────────────────────────────

export interface ApplyResult {
  switched: string[];
  /** Already on both settings: flagged in our database, not written to Stripe. */
  alreadyDone: string[];
  failed: string[];
}

export async function apply(
  deps: BackfillDeps,
  env: string,
  confirm: string
): Promise<ApplyResult> {
  const { lines, checksum } = await survey(deps, env);
  if (checksum !== confirm) {
    throw new Error(
      `The accounts to switch changed since the dry run (checksum ${checksum}, not ${confirm}). Read the new dry run first.`
    );
  }
  const result: ApplyResult = { switched: [], alreadyDone: [], failed: [] };
  for (const line of lines) {
    const { account } = line;
    if (line.action === 'already manual + debit off') {
      await deps.markManual(account, new Date());
      result.alreadyDone.push(account.stripeAccountId);
      continue;
    }
    if (line.action !== 'switch') continue;
    try {
      const updated = await deps.stripe.accounts.update(
        account.stripeAccountId,
        { settings: MANUAL_PAYOUT_SETTINGS },
        {
          ...STRIPE_REQUEST,
          idempotencyKey: `codex_manual_payouts_${account.stripeAccountId}`,
        }
      );
      if (!isSwitched(updated)) {
        result.failed.push(account.stripeAccountId);
        deps.print(
          `${account.stripeAccountId} | FAILED: Stripe did not report both settings back`
        );
        continue;
      }
      await deps.markManual(account, new Date());
      result.switched.push(account.stripeAccountId);
      deps.print(`${account.stripeAccountId} | switched`);
    } catch (error) {
      result.failed.push(account.stripeAccountId);
      deps.print(
        `${account.stripeAccountId} | FAILED: Stripe error ${errorCode(error)}`
      );
    }
  }
  deps.print(
    `switched: ${result.switched.length}, already done: ${result.alreadyDone.length}, failed: ${result.failed.length}`
  );
  return result;
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.env !== 'production') {
    // Local test-mode runs read the dev database and key, as the seeds do.
    // A production run takes them from the shell, never from a file.
    const { config } = await import('dotenv');
    const here = path.dirname(fileURLToPath(import.meta.url));
    config({ path: path.resolve(here, '../../../.env.dev') });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  assertKeyMatchesEnv(key, args);
  const stripe = new Stripe(key as string, { apiVersion: STRIPE_API_VERSION });

  const { dbWs, schema } = await import('../src');
  const { sql } = await import('drizzle-orm');
  const deps: BackfillDeps = {
    stripe,
    print: (line) => console.log(line),
    async accounts() {
      const [current, replaced] = await Promise.all([
        dbWs
          .select({
            stripeAccountId: schema.stripeConnectAccounts.stripeAccountId,
            connectRowId: schema.stripeConnectAccounts.id,
            userId: schema.stripeConnectAccounts.userId,
          })
          .from(schema.stripeConnectAccounts),
        dbWs
          .select({
            stripeAccountId: schema.stripeConnectAccountHistory.stripeAccountId,
            connectRowId: schema.stripeConnectAccountHistory.id,
            userId: schema.stripeConnectAccountHistory.userId,
          })
          .from(schema.stripeConnectAccountHistory),
      ]);
      return [
        ...current.map((row) => ({ ...row, source: 'current' as const })),
        ...replaced.map((row) => ({ ...row, source: 'replaced' as const })),
      ];
    },
    async markManual(account, at) {
      await dbWs
        .insert(schema.connectBalances)
        .values({
          stripeAccountId: account.stripeAccountId,
          userId: account.userId,
          manualPayoutsSince: at,
        })
        .onConflictDoUpdate({
          target: schema.connectBalances.stripeAccountId,
          set: {
            manualPayoutsSince: sql`COALESCE(${schema.connectBalances.manualPayoutsSince}, excluded.manual_payouts_since)`,
          },
        });
    },
  };

  console.log(
    `\n  Payout schedule backfill: ${args.apply ? 'APPLY' : 'DRY RUN (no writes)'}, env ${args.env}, ${keyMode(key)} key\n`
  );
  if (args.apply && args.confirm) {
    await apply(deps, args.env, args.confirm);
  } else {
    await survey(deps, args.env);
    console.log(
      '\n  Nothing was changed. To apply: --apply --confirm <checksum> (and, for production, --live, or --test-keys while it runs on test keys).'
    );
  }
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(
        `Backfill aborted: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
