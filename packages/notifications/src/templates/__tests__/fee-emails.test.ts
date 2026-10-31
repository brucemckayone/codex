/**
 * The fee emails' seed copy against their allowlists (Codex-2hxff.33; batch
 * C1 Part B data design §1.9).
 *
 * The renderer blanks any token not on the template's allowlist, so a token
 * the seed uses but the list lacks ships as an empty sentence. The fee
 * step's own payloads are rendered against the same seed in the worker's
 * tests (notifications-api `handlers/__tests__/fee-notice-copy.test.ts`):
 * the two close the chain seed → allowlist → payload.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAllowedTokens, getTokensThatMayRenderBlank } from '../renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

/** Every token the seed's entry for `name` uses. */
function seedTokens(name: string): string[] {
  const start = SEED.indexOf(`name: '${name}'`);
  if (start < 0) throw new Error(`seed entry for ${name} not found`);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  return [...entry.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].flatMap((m) =>
    m[1] ? [m[1]] : []
  );
}

const NAMES = ['fee-change-notice', 'fee-change-cancelled'];

describe('the fee emails (batch C1 §1.9)', () => {
  it.each(
    NAMES
  )('%s: every token in the seed copy is on its allowlist', (name) => {
    const used = seedTokens(name);
    expect(used.length).toBeGreaterThan(0);
    const allowed = getAllowedTokens(name);
    for (const token of used) {
      expect(allowed, `${name}: {{${token}}}`).toContain(token);
    }
  });

  it.each(NAMES)('%s: transactional, and no token may render blank', (name) => {
    // A rule sentence that is not needed is sent as '', never left out.
    expect(getAllowedTokens(name)).not.toContain('unsubscribeUrl');
    expect(getTokensThatMayRenderBlank(name)).toEqual([]);
  });
});
