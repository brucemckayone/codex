/**
 * The `payout-released` copy and the drain's mailer agree (Codex-2hxff.29;
 * batch B design §5.5, §12 "the N+1 draft migration's fields are all sent by
 * N's drain").
 *
 * The seed carries the final copy, the one migration 0119 writes to the live
 * row a release later. Every bank token it uses must come back, non-empty, in
 * every case the drain composes: an account not switched yet, all of it older
 * than 14 days (M5), some from the last 14 days (M6), and all of it young. A
 * token the drain never sends would render blank.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { payoutReleasedBankFields } from '../bank-payouts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

function seedTokens(name: string): string[] {
  const start = SEED.indexOf(`name: '${name}'`);
  expect(start).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  return [...entry.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] ?? '');
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-28T10:00:00Z');
const old = {
  cents: 4210,
  createdAt: new Date(NOW.getTime() - 20 * DAY),
  hasCharge: true,
};
const young = {
  cents: 2040,
  createdAt: new Date(NOW.getTime() - 3 * DAY),
  hasCharge: true,
};

const CASES = {
  'not switched yet': { slices: [old, young], manualPayouts: false },
  'all older than 14 days (M5)': { slices: [old], manualPayouts: true },
  'some from the last 14 days (M6)': {
    slices: [old, young],
    manualPayouts: true,
  },
  'all from the last 14 days': { slices: [young], manualPayouts: true },
};

describe('payout-released: the seed copy uses only fields the drain sends', () => {
  const bankTokens = [...new Set(seedTokens('payout-released'))].filter((t) =>
    t.startsWith('bank')
  );

  it('the final copy uses the bank fields', () => {
    expect(bankTokens.sort()).toEqual(['bankLines', 'bankSentence']);
  });

  it.each(Object.entries(CASES))('%s: each is sent, non-empty', (_, input) => {
    const fields: Record<string, string> = {
      ...payoutReleasedBankFields({ ...input, now: NOW }),
    };
    for (const token of bankTokens) {
      expect(fields[token], token).toBeTruthy();
    }
  });
});
