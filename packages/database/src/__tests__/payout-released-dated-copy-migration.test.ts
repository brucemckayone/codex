/**
 * Migration 0119, one release after 0118 (Codex-2hxff.93): `payout-released`
 * says when each part of the payout reaches the bank (Codex-2hxff.29; batch B
 * design §5.5; mock-b-studio emails.html M5, M6).
 *
 * 0118 swapped the "within 2 business days" line for a line with no token.
 * This swaps that line for `{{bankSentence}}` and adds the `{{bankLines}}`
 * row. The drain has sent both since 0118's release.
 *
 * Runs the migration's own SQL against real rows inside ONE transaction that
 * is always rolled back. Pins:
 *   - a row as 0118 left it becomes EXACTLY the current seed, in a global and
 *     an org-scoped copy;
 *   - an edited row, a soft-deleted row, a row seeded from the current seed
 *     and another template are untouched;
 *   - a second run changes nothing;
 *   - the only new tokens are the two the drain sends.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

const MIGRATION_FILE = '../migrations/0119_payout_released_dated_copy.sql';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(path.resolve(here, MIGRATION_FILE), 'utf8');
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const TEMPLATE = 'payout-released';
const STEP_ONE_LINE =
  'Your Earnings page shows the date each payment goes to your bank.';

function seedEntry(name: string): { htmlBody: string; textBody: string } {
  const start = SEED.indexOf(`name: '${name}'`);
  expect(start).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (!htmlBody || !textBody) throw new Error(`seed entry ${name} not found`);
  return { htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const FINAL = seedEntry(TEMPLATE);
/** The row as 0118 leaves it: the final copy with both fields undone. */
const AFTER_0118 = {
  htmlBody: FINAL.htmlBody
    .replace('<p style="margin:5px 0;">{{bankLines}}</p>', '')
    .replace('<p>{{bankSentence}}</p>', `<p>${STEP_ONE_LINE}</p>`),
  textBody: FINAL.textBody.replace(
    '\n{{bankLines}}\n\n{{bankSentence}}',
    `\n\n${STEP_ONE_LINE}`
  ),
};

const tokensOf = (body: string) =>
  new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));

class Rollback extends Error {}

describe('0119 payout-released dated copy (held back)', () => {
  it('adds exactly the two fields the drain sends since 0118, and raises no notice', () => {
    const before = tokensOf(AFTER_0118.htmlBody + AFTER_0118.textBody);
    const after = tokensOf(FINAL.htmlBody + FINAL.textBody);
    const added = [...after].filter((t) => !before.has(t)).sort();
    // B1's payoutReleasedBankFields returns these (bank-payouts.ts).
    expect(added).toEqual(['bankLines', 'bankSentence']);
    expect(AFTER_0118.htmlBody).toContain(STEP_ONE_LINE);
    expect(AFTER_0118.textBody).toContain(STEP_ONE_LINE);
    expect(MIGRATION).not.toMatch(/RAISE\s+NOTICE/i);
  });

  it.skipIf(!HAS_DB)(
    'rewords every row 0118 left exactly, touches nothing else, twice over',
    async () => {
      const { dbWs } = await import('../index');
      const { emailTemplates, organizations } = await import('../schema');
      const stamp = new Date('2020-01-01T00:00:00Z');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const row = (
        name: string,
        body: { htmlBody: string; textBody: string }
      ) => ({
        name,
        subject: 'Subject',
        htmlBody: body.htmlBody,
        textBody: body.textBody,
        status: 'active' as const,
        updatedAt: stamp,
      });
      const statements = MIGRATION.split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(1);

      let afterOne: Array<typeof emailTemplates.$inferSelect> = [];
      let afterTwo: Array<typeof emailTemplates.$inferSelect> = [];
      let ids: Record<string, string> = {};
      try {
        await dbWs.transaction(async (tx) => {
          await tx
            .update(emailTemplates)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(emailTemplates.name, TEMPLATE),
                eq(emailTemplates.scope, 'global'),
                isNull(emailTemplates.deletedAt)
              )
            );
          const [orgA, orgB, orgC] = await tx
            .insert(organizations)
            .values([
              { name: 'Dated Copy Org A', slug: `dated-copy-a-${suffix}` },
              { name: 'Dated Copy Org B', slug: `dated-copy-b-${suffix}` },
              { name: 'Dated Copy Org C', slug: `dated-copy-c-${suffix}` },
            ])
            .returning({ id: organizations.id });
          if (!orgA || !orgB || !orgC) throw new Error('orgs not inserted');
          const inserted = await tx
            .insert(emailTemplates)
            .values([
              { ...row(TEMPLATE, AFTER_0118), scope: 'global' },
              {
                ...row(TEMPLATE, AFTER_0118),
                scope: 'organization',
                organizationId: orgA.id,
              },
              {
                ...row(TEMPLATE, {
                  htmlBody: '<p>Our own wording.</p>',
                  textBody: 'Our own wording.',
                }),
                scope: 'organization',
                organizationId: orgB.id,
              },
              {
                ...row(TEMPLATE, AFTER_0118),
                scope: 'global',
                deletedAt: stamp,
              },
              {
                ...row(TEMPLATE, FINAL),
                scope: 'organization',
                organizationId: orgC.id,
              },
              {
                ...row(`${TEMPLATE}-other-${suffix}`, AFTER_0118),
                scope: 'global',
              },
            ])
            .returning({ id: emailTemplates.id });
          const keys = [
            'stale',
            'orgCopy',
            'edited',
            'deleted',
            'seeded',
            'other',
          ] as const;
          ids = Object.fromEntries(
            keys.map((key, i) => {
              const id = inserted[i]?.id;
              if (!id) throw new Error(`fixture ${key} not inserted`);
              return [key, id];
            })
          );
          const read = () =>
            tx
              .select()
              .from(emailTemplates)
              .where(inArray(emailTemplates.id, Object.values(ids)));
          for (const statement of statements) {
            await tx.execute(sql.raw(statement));
          }
          afterOne = await read();
          for (const statement of statements) {
            await tx.execute(sql.raw(statement));
          }
          afterTwo = await read();
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      const byId = (rows: typeof afterOne, key: string) =>
        rows.find((r) => r.id === ids[key]);
      for (const key of ['stale', 'orgCopy']) {
        expect(byId(afterOne, key)?.htmlBody, key).toBe(FINAL.htmlBody);
        expect(byId(afterOne, key)?.textBody, key).toBe(FINAL.textBody);
      }
      for (const key of ['edited', 'deleted', 'seeded', 'other']) {
        expect(byId(afterOne, key)?.updatedAt.getTime(), key).toBe(
          stamp.getTime()
        );
      }
      for (const key of Object.keys(ids)) {
        expect(byId(afterTwo, key)?.htmlBody, key).toBe(
          byId(afterOne, key)?.htmlBody
        );
        expect(byId(afterTwo, key)?.textBody, key).toBe(
          byId(afterOne, key)?.textBody
        );
        expect(byId(afterTwo, key)?.updatedAt.getTime(), key).toBe(
          byId(afterOne, key)?.updatedAt.getTime()
        );
      }
    }
  );
});
