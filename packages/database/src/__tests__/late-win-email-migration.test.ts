/**
 * Migration 0126 (Codex-2hxff.70; late-win data design §3.1, §7, §9) inserts
 * the buyer's `purchase-access-restored` email, generated from the seed as
 * 0123's fee emails are. This holds the two together.
 *
 * Pins:
 *   - the migration's row is the seed entry byte for byte: subject, both
 *     bodies, description and status;
 *   - the file sets lock_timeout first and resets it last (as 0125);
 *   - run on real rows inside ONE transaction that is always rolled back, the
 *     INSERT adds the seed's row only when no live global row of the name
 *     exists: a second run adds nothing, a live global row (edited) is left
 *     alone, and a soft-deleted or org-scoped one doesn't count.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.resolve(here, '../migrations/0126_dispute_late_win.sql'),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const NAME = 'purchase-access-restored';

function seedEntry(name: string) {
  const start = SEED.indexOf(`name: '${name}'`);
  expect(start).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const subject = /subject: '([^']*)'/.exec(entry)?.[1];
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  const description = /description:\s*'([^']*)'/.exec(entry)?.[1];
  const status = /status: '(\w+)'/.exec(entry)?.[1];
  if (!subject || !htmlBody || !textBody || !description || !status) {
    throw new Error(`seed entry ${name} not found`);
  }
  return {
    subject,
    htmlBody,
    textBody: textBody.replaceAll('\\n', '\n'),
    description,
    status,
  };
}

const SEEDED = seedEntry(NAME);
const statements = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const INSERT = statements.find((s) => s.includes(`$tpl$${NAME}$tpl$`));

/** The migration's row: its `$tpl$`-quoted values, in column order. */
function migrationRow() {
  if (!INSERT) throw new Error('no template INSERT in 0126');
  const values = [...INSERT.matchAll(/\$tpl\$([\s\S]*?)\$tpl\$/g)].map(
    (m) => m[1]
  );
  const [name, subject, htmlBody, textBody, description] = values;
  const status = /'(\w+)'\s*WHERE NOT EXISTS/.exec(INSERT)?.[1];
  return { name, subject, htmlBody, textBody, description, status };
}

class Rollback extends Error {}

describe('0126 late win: the access-restored email', () => {
  it('inserts the seed entry byte for byte', () => {
    const row = migrationRow();
    expect(row.name).toBe(NAME);
    expect(row.subject).toBe(SEEDED.subject);
    expect(row.htmlBody).toBe(SEEDED.htmlBody);
    expect(row.textBody).toBe(SEEDED.textBody);
    expect(row.description).toBe(SEEDED.description);
    expect(row.status).toBe(SEEDED.status);
  });

  it('bounds its lock wait, as 0125 does', () => {
    expect(statements[0]).toMatch(/SET lock_timeout = '5s';$/);
    expect(statements.at(-1)).toBe('RESET lock_timeout;');
    expect(MIGRATION).not.toMatch(/RAISE\s+NOTICE/i);
  });

  it.skipIf(!HAS_DB)(
    'inserts the seed row only where no live global one is, twice over',
    async () => {
      const { dbWs } = await import('../index');
      const { emailTemplates, organizations } = await import('../schema');
      if (!INSERT) throw new Error('no template INSERT in 0126');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      type Row = typeof emailTemplates.$inferSelect;
      let firstRun: Row[] = [];
      let secondRun: Row[] = [];
      let editedRun: Row[] = [];
      try {
        await dbWs.transaction(async (tx) => {
          const liveGlobal = () =>
            tx
              .select()
              .from(emailTemplates)
              .where(
                and(
                  eq(emailTemplates.name, NAME),
                  eq(emailTemplates.scope, 'global'),
                  isNull(emailTemplates.deletedAt)
                )
              );
          // The migrated test database has the row: put it out of the way,
          // which also leaves a soft-deleted global row that must not count.
          await tx
            .update(emailTemplates)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(emailTemplates.name, NAME),
                eq(emailTemplates.scope, 'global'),
                isNull(emailTemplates.deletedAt)
              )
            );
          const [org] = await tx
            .insert(organizations)
            .values({ name: 'Late Win Org', slug: `late-win-${suffix}` })
            .returning({ id: organizations.id });
          if (!org) throw new Error('org not inserted');
          await tx.insert(emailTemplates).values({
            name: NAME,
            scope: 'organization',
            organizationId: org.id,
            subject: 'Our own subject',
            htmlBody: '<p>Our own wording.</p>',
            textBody: 'Our own wording.',
            status: 'active',
          });

          await tx.execute(sql.raw(INSERT));
          firstRun = await liveGlobal();
          await tx.execute(sql.raw(INSERT));
          secondRun = await liveGlobal();
          const [made] = firstRun;
          if (!made) throw new Error('nothing inserted');
          await tx
            .update(emailTemplates)
            .set({ htmlBody: '<p>Edited by support.</p>' })
            .where(eq(emailTemplates.id, made.id));
          await tx.execute(sql.raw(INSERT));
          editedRun = await liveGlobal();
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      expect(firstRun).toHaveLength(1);
      expect(firstRun[0]).toMatchObject({
        subject: SEEDED.subject,
        htmlBody: SEEDED.htmlBody,
        textBody: SEEDED.textBody,
        description: SEEDED.description,
        status: SEEDED.status,
        organizationId: null,
      });
      expect(secondRun.map((r) => r.id)).toEqual(firstRun.map((r) => r.id));
      expect(editedRun.map((r) => r.id)).toEqual(firstRun.map((r) => r.id));
      expect(editedRun[0]?.htmlBody).toBe('<p>Edited by support.</p>');
    }
  );
});
