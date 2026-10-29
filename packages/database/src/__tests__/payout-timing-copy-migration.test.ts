/**
 * Migration 0118's two copy swaps (Codex-2hxff.34, .29; batch B design §5.5).
 *
 * - `creator-connect-needed` (M4): it now goes for the first waiting sale
 *   only, so it says when the money moves and that no per-sale emails follow.
 * - `payout-released`, step 1 of 2: the "within 2 business days" line becomes
 *   a line with no token. Step 2, the dated copy using `bankSentence` and
 *   `bankLines`, is 0119, one release later, because production runs
 *   migrations before notifications-api learns those tokens.
 *
 * The seed skips templates that already exist, so only a migration reaches
 * the live rows. Runs the migration's own UPDATE statements against real rows
 * inside ONE transaction that is always rolled back, so the shared test
 * database is left exactly as it was. Pins:
 *   - a stale stock connect-needed row becomes EXACTLY the current seed, in a
 *     global and an org-scoped copy;
 *   - a stale payout-released row loses the "2 business days" line and gains
 *     no token;
 *   - an edited row, a soft-deleted row, a row seeded from the new seed and
 *     another template are untouched;
 *   - a second run changes nothing.
 *
 * 0118's DDL is not run here: the test database already has it.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.resolve(here, '../migrations/0118_payout_timing_and_money_owed.sql'),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

/** The seed's own entry for a template: both bodies. */
function seedEntry(name: string): { htmlBody: string; textBody: string } {
  const start = SEED.indexOf(`name: '${name}'`);
  expect(start).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (!htmlBody || !textBody) throw new Error(`seed entry ${name} not found`);
  // The seed's bodies are template literals: `\n` in the source is a newline.
  return { htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

/** 0118's copy statements, as the migrator runs them: one per breakpoint. */
const COPY_STATEMENTS = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes('UPDATE "email_templates"'));

const CONNECT = 'creator-connect-needed';
const RELEASED = 'payout-released';

const OLD_CONNECT_SENTENCE =
  'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.';
const NEW_CONNECT_SENTENCE =
  "Your earnings are held safely and moved to your Stripe account once you connect it and Stripe approves it. From there, each sale's money goes to your bank 14 days after the sale.";
const QUIET =
  "We won't email you about each sale. If money is still waiting after 30 days, we'll remind you once a month.";
const QUIET_HTML = `<p style="color:#666;font-size:13px;">${QUIET}</p>`;

const OLD_BANK_LINE =
  'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.';
const STEP_ONE_LINE =
  'Your Earnings page shows the date each payment goes to your bank.';

const CONNECT_NEW = seedEntry(CONNECT);
/** The stock row production has: the seed before batch B, rebuilt by undoing exactly the two changes. */
const CONNECT_OLD = {
  htmlBody: CONNECT_NEW.htmlBody
    .replace(NEW_CONNECT_SENTENCE, OLD_CONNECT_SENTENCE)
    .replace(QUIET_HTML, ''),
  textBody: CONNECT_NEW.textBody
    .replace(NEW_CONNECT_SENTENCE, OLD_CONNECT_SENTENCE)
    .replace(`\n\n${QUIET}`, ''),
};

const RELEASED_FINAL = seedEntry(RELEASED);
/** The stock row production has: the seed before batch B. */
const RELEASED_OLD = {
  htmlBody: RELEASED_FINAL.htmlBody
    .replace('<p style="margin:5px 0;">{{bankLines}}</p>', '')
    .replace('<p>{{bankSentence}}</p>', `<p>${OLD_BANK_LINE}</p>`),
  textBody: RELEASED_FINAL.textBody.replace(
    '\n{{bankLines}}\n\n{{bankSentence}}',
    `\n\n${OLD_BANK_LINE}`
  ),
};

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

describe('0118 copy swaps: connect-needed and payout-released step 1', () => {
  it('the seed carries the final copy, and the stock rows are rebuilt exactly', () => {
    // A rebuilt stock row that still held a new phrase would make the
    // migration's "stale row -> seed" assertion vacuous.
    for (const body of [CONNECT_OLD.htmlBody, CONNECT_OLD.textBody]) {
      expect(body).toContain(OLD_CONNECT_SENTENCE);
      expect(body).not.toContain(QUIET);
    }
    for (const body of [RELEASED_OLD.htmlBody, RELEASED_OLD.textBody]) {
      expect(body).toContain(OLD_BANK_LINE);
      expect(body).not.toMatch(/bankLines|bankSentence/);
    }
    for (const body of [RELEASED_FINAL.htmlBody, RELEASED_FINAL.textBody]) {
      expect(body).not.toContain('within 2 business days');
      expect(body).toContain('{{bankSentence}}');
    }
    expect(COPY_STATEMENTS).toHaveLength(2);
    // migrate-direct.ts attaches no notice listener (Codex-2hxff.84).
    expect(MIGRATION).not.toMatch(/RAISE\s+NOTICE/i);
  });

  it.skipIf(!HAS_DB)(
    'rewords every live stale copy exactly and touches nothing else, twice over',
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

      let afterOne: Array<typeof emailTemplates.$inferSelect> = [];
      let afterTwo: Array<typeof emailTemplates.$inferSelect> = [];
      let ids: Record<string, string> = {};
      try {
        await dbWs.transaction(async (tx) => {
          // Stand the real global rows aside so these fixtures own the names
          // (unique per scope while live). Rolled back with everything else.
          await tx
            .update(emailTemplates)
            .set({ deletedAt: new Date() })
            .where(
              and(
                inArray(emailTemplates.name, [CONNECT, RELEASED]),
                eq(emailTemplates.scope, 'global'),
                isNull(emailTemplates.deletedAt)
              )
            );
          const [orgA, orgB, orgC] = await tx
            .insert(organizations)
            .values([
              { name: 'Payout Copy Org A', slug: `payout-copy-a-${suffix}` },
              { name: 'Payout Copy Org B', slug: `payout-copy-b-${suffix}` },
              { name: 'Payout Copy Org C', slug: `payout-copy-c-${suffix}` },
            ])
            .returning({ id: organizations.id });
          if (!orgA || !orgB || !orgC) throw new Error('orgs not inserted');

          const inserted = await tx
            .insert(emailTemplates)
            .values([
              { ...row(CONNECT, CONNECT_OLD), scope: 'global' },
              {
                ...row(CONNECT, CONNECT_OLD),
                scope: 'organization',
                organizationId: orgA.id,
              },
              {
                ...row(CONNECT, {
                  htmlBody: '<p>Our own wording.</p>',
                  textBody: 'Our own wording.',
                }),
                scope: 'organization',
                organizationId: orgB.id,
              },
              {
                ...row(CONNECT, CONNECT_OLD),
                scope: 'global',
                deletedAt: stamp,
              },
              { ...row(RELEASED, RELEASED_OLD), scope: 'global' },
              {
                ...row(RELEASED, RELEASED_FINAL),
                scope: 'organization',
                organizationId: orgC.id,
              },
              {
                ...row(`${CONNECT}-other-${suffix}`, CONNECT_OLD),
                scope: 'global',
              },
            ])
            .returning({ id: emailTemplates.id });
          const keys = [
            'connectStale',
            'connectOrg',
            'connectEdited',
            'connectDeleted',
            'releasedStale',
            'releasedSeeded',
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
          for (const statement of COPY_STATEMENTS) {
            await tx.execute(sql.raw(statement));
          }
          afterOne = await read();
          // Safe to run again: no old phrase is left to replace.
          for (const statement of COPY_STATEMENTS) {
            await tx.execute(sql.raw(statement));
          }
          afterTwo = await read();
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      const byId = (rows: typeof afterOne, key: keyof typeof ids | string) =>
        rows.find((r) => r.id === ids[key]);

      for (const key of ['connectStale', 'connectOrg']) {
        const fixed = byId(afterOne, key);
        expect(fixed?.htmlBody).toBe(CONNECT_NEW.htmlBody);
        expect(fixed?.textBody).toBe(CONNECT_NEW.textBody);
        expect(fixed?.updatedAt.getTime()).not.toBe(stamp.getTime());
      }

      const released = byId(afterOne, 'releasedStale');
      expect(released?.htmlBody).toBe(
        RELEASED_OLD.htmlBody.replace(OLD_BANK_LINE, STEP_ONE_LINE)
      );
      expect(released?.textBody).toBe(
        RELEASED_OLD.textBody.replace(OLD_BANK_LINE, STEP_ONE_LINE)
      );
      for (const body of [released?.htmlBody, released?.textBody]) {
        expect(body).not.toContain('within 2 business days');
        // No token the previous notifications-api would blank.
        expect(body).not.toMatch(/bankLines|bankSentence|bankDate/);
      }

      for (const key of [
        'connectEdited',
        'connectDeleted',
        'releasedSeeded',
        'other',
      ]) {
        expect(byId(afterOne, key)?.updatedAt.getTime(), key).toBe(
          stamp.getTime()
        );
      }
      expect(byId(afterOne, 'releasedSeeded')?.htmlBody).toBe(
        RELEASED_FINAL.htmlBody
      );

      // The second run wrote nothing: every row is as the first left it.
      for (const key of Object.keys(ids)) {
        const once = byId(afterOne, key);
        const twice = byId(afterTwo, key);
        expect(twice?.htmlBody, key).toBe(once?.htmlBody);
        expect(twice?.textBody, key).toBe(once?.textBody);
        expect(twice?.updatedAt.getTime(), key).toBe(once?.updatedAt.getTime());
      }
    }
  );
});
