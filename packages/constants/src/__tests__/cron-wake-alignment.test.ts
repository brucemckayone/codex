/**
 * Drift guard: every production cron shares ONE Neon wake window
 *
 * Neon bills TIME AWAKE, and each cron run opens a DB client, so the cadence
 * of the crons — not the hit rate of any cache — sets the floor on compute
 * cost. Two numbers from 2026-09-04, project `quiet-smoke-77773357`:
 *
 *   - the `production` branch was awake 35.5 h of 68.3 wall-clock hours
 *     (12.5 h/day), against a 5-minute autosuspend; and
 *   - ecom-api's then-15-minute payouts sweep accounted for 8.0 h/day of
 *     that on its own (96 wakes x 5 min) — about 64%, before any user traffic.
 *
 * TWO PROPERTIES KEEP THAT FLOOR LOW, AND NEITHER IS SELF-EVIDENT IN A DIFF:
 *
 *   1. Cadence. An hourly cron costs 2.0 h/day; a 15-minute one costs
 *      8.0 h/day. A
 *      one-character edit to a cron field quadruples the bill. (A minute
 *      field of star-slash-15 is 96 wakes/day; the literal cannot be
 *      written here because it would close this comment.)
 *   2. ALIGNMENT. Wakes only overlap if the crons fire in the same minute.
 *      Three crons at `:00` share one 5-minute window; the same three at
 *      `:00`, `:07` and `:23` cost three. Nothing fails, nothing logs, and the
 *      only symptom is a larger invoice — so this is asserted, not commented.
 *
 * A wrangler comment cannot enforce either, because the wrong version can
 * still be written and shipped. This test can only pass if it is true.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const WORKERS_DIR = join(REPO_ROOT, 'workers');

/**
 * The minute every cron must fire on, so their autosuspend windows coincide.
 * The value itself is arbitrary; that they AGREE is the point.
 */
const SHARED_WAKE_MINUTE = '0';

/** Strip JSONC comments and trailing commas. Mirrors rate-limit-bindings.test.ts. */
function parseJsonc(source: string, path: string): Record<string, unknown> {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${(error as Error).message}. Fix the parser or the config rather than deleting this guard.`
    );
  }
}

interface CronEntry {
  worker: string;
  env: string;
  expression: string;
}

/**
 * Every cron expression declared anywhere in workers/, top level or per-env.
 * Per-env matters: these crons live under `env.production` precisely so they
 * do not inherit into dev/staging, so a top-level-only reader would find none
 * and pass vacuously.
 */
function collectCrons(): CronEntry[] {
  if (!existsSync(WORKERS_DIR)) {
    throw new Error(
      `workers/ not found at ${WORKERS_DIR}; the cron alignment guard cannot run.`
    );
  }

  const found: CronEntry[] = [];

  const readTriggers = (node: unknown, worker: string, env: string): void => {
    const triggers = (node as { triggers?: { crons?: unknown } } | null)
      ?.triggers;
    const crons = triggers?.crons;
    if (!Array.isArray(crons)) return;
    for (const expression of crons) {
      if (typeof expression === 'string') {
        found.push({ worker, env, expression });
      }
    }
  };

  for (const worker of readdirSync(WORKERS_DIR)) {
    const path = join(WORKERS_DIR, worker, 'wrangler.jsonc');
    if (!existsSync(path)) continue;
    const config = parseJsonc(readFileSync(path, 'utf-8'), path);

    readTriggers(config, worker, 'top-level');

    const envs = config.env as Record<string, unknown> | undefined;
    for (const [envName, envConfig] of Object.entries(envs ?? {})) {
      readTriggers(envConfig, worker, envName);
    }
  }

  return found;
}

describe('cron wake alignment', () => {
  const crons = collectCrons();

  it('finds the crons at all', () => {
    // Calibration. Every assertion below is over `crons`, so an empty list
    // would make the whole suite pass while asserting nothing — the exact
    // failure mode of a guard that reads the wrong nesting level.
    expect(
      crons.length,
      'no crons found in any workers/*/wrangler.jsonc — the reader is looking in the wrong place'
    ).toBeGreaterThan(0);
  });

  it.each(
    crons
  )('$worker/$env "$expression" fires on the shared wake minute', ({
    expression,
  }) => {
    const minute = expression.trim().split(/\s+/)[0];
    expect(
      minute,
      `every cron must fire on minute ${SHARED_WAKE_MINUTE} so the wakes overlap into ONE autosuspend window. A cron on its own minute adds a separate 5-minute Neon wake, every hour, silently.`
    ).toBe(SHARED_WAKE_MINUTE);
  });

  it.each(crons)('$worker/$env "$expression" does not run sub-hourly', ({
    expression,
  }) => {
    const minute = expression.trim().split(/\s+/)[0];
    // A step or a list in the MINUTE field is the expensive shape: `*/15`
    // is 96 wakes/day = 8.0 h/day awake. Anything hourly-or-slower is 24
    // wakes/day = 2.0 h/day. If a sub-hourly cron is ever genuinely needed,
    // price it against those figures and change this guard deliberately.
    expect(
      minute.includes('/') || minute.includes(',') || minute === '*',
      `"${expression}" fires more than once an hour. At a 5-minute autosuspend each wake costs 5 minutes of Neon compute: */15 = 8.0 h/day vs hourly = 2.0 h/day.`
    ).toBe(false);
  });
});
