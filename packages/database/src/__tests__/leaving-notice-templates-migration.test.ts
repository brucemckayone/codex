/**
 * The leaving notice's templates migration (Codex-a6ofh.6.4; its file is
 * MIGRATION_TAG below, the one place this suite names its number): the four
 * emails reach production as data, generated from the seed (0123's precedent
 * for the fee emails). Pins:
 *   - each INSERT carries exactly the seed's subject, both bodies,
 *     description and status, as a global template, and guards on a live
 *     GLOBAL row of its name;
 *   - run against real rows (in ONE transaction, always rolled back), it
 *     inserts the four, a second run inserts nothing, a live global row an
 *     admin already edited is left as it is, never doubled, and an org's own
 *     template of the same name never stops the global one.
 *
 * Real DB for the second half. Skips when DB_METHOD is not configured.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/** The migration's file name: renumbering it at PR time changes this alone. */
const MIGRATION_TAG = '0134_leaving_notice_templates';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.resolve(here, `../migrations/${MIGRATION_TAG}.sql`),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const NAMES = [
  'content-leaving',
  'content-leaving-reminder',
  'content-staying',
  'content-removed',
] as const;

function seedEntry(name: string) {
  const start = SEED.indexOf(`name: '${name}'`);
  expect(start, name).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const field = (key: string) =>
    new RegExp(`${key}: \`([^\`]*)\``).exec(entry)?.[1];
  const description = /description:\s*(['"])([\s\S]*?)\1,/.exec(entry)?.[2];
  const status = /status:\s*'(\w+)'/.exec(entry)?.[1];
  const subject = field('subject');
  const htmlBody = field('htmlBody');
  const textBody = field('textBody')?.replaceAll('\\n', '\n');
  if (!subject || !htmlBody || !textBody || !description || !status) {
    throw new Error(`seed entry ${name} is incomplete`);
  }
  return { subject, htmlBody, textBody, description, status };
}

const STATEMENTS = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

/** The dollar-quoted values of one INSERT, in column order. */
function valuesOf(statement: string): string[] {
  return [...statement.matchAll(/\$tpl\$([\s\S]*?)\$tpl\$/g)].map(
    (m) => m[1] ?? ''
  );
}

/** The status an INSERT writes: its SELECT list's last literal. */
const statusOf = (statement: string) =>
  /'(\w+)'\s*WHERE NOT EXISTS/.exec(statement)?.[1];

/** Its guard: only a live GLOBAL row of its name stops it. */
const guardOf = (name: string) =>
  `WHERE NOT EXISTS (\n  SELECT 1 FROM "email_templates"\n  WHERE "name" = $tpl$${name}$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL\n)`;

class Rollback extends Error {}

describe(MIGRATION_TAG, () => {
  it('inserts each of the four exactly as the seed has it', () => {
    expect(STATEMENTS).toHaveLength(NAMES.length);
    NAMES.forEach((name, i) => {
      const statement = STATEMENTS[i] ?? '';
      const seed = seedEntry(name);
      // name, subject, html, text, description, then the guard's name.
      expect(valuesOf(statement)).toEqual([
        name,
        seed.subject,
        seed.htmlBody,
        seed.textBody,
        seed.description,
        name,
      ]);
      expect(statusOf(statement)).toBe(seed.status);
      expect(statement).toContain(guardOf(name));
    });
    expect(MIGRATION).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER)\b/);
  });

  it.skipIf(!HAS_DB)(
    'inserts the four once, and leaves an edited live row alone',
    async () => {
      const { dbWs } = await import('../index');
      const { emailTemplates, organizations } = await import('../schema');
      const live = (
        tx: Parameters<Parameters<typeof dbWs.transaction>[0]>[0]
      ) =>
        tx
          .select()
          .from(emailTemplates)
          .where(
            and(
              inArray(emailTemplates.name, [...NAMES]),
              eq(emailTemplates.scope, 'global'),
              isNull(emailTemplates.deletedAt)
            )
          );
      let afterOne: Array<typeof emailTemplates.$inferSelect> = [];
      let afterTwo: Array<typeof emailTemplates.$inferSelect> = [];
      try {
        await dbWs.transaction(async (tx) => {
          // As before the migration: none of the four, but an admin's own
          // staying copy, and an org's own takedown template.
          await tx
            .update(emailTemplates)
            .set({ deletedAt: new Date() })
            .where(
              and(
                inArray(emailTemplates.name, [...NAMES]),
                eq(emailTemplates.scope, 'global'),
                isNull(emailTemplates.deletedAt)
              )
            );
          await tx.insert(emailTemplates).values({
            name: 'content-staying',
            scope: 'global',
            subject: 'Our own subject',
            htmlBody: '<p>Our own wording.</p>',
            textBody: 'Our own wording.',
            status: 'active',
          });
          const [org] = await tx
            .insert(organizations)
            .values({
              name: 'Templates migration test',
              slug: `templates-migration-${crypto.randomUUID()}`,
            })
            .returning({ id: organizations.id });
          await tx.insert(emailTemplates).values({
            name: 'content-removed',
            scope: 'organization',
            organizationId: org?.id,
            subject: 'An org wrote this',
            htmlBody: '<p>An org wrote this.</p>',
            textBody: 'An org wrote this.',
            status: 'active',
          });
          for (const statement of STATEMENTS) {
            await tx.execute(sql.raw(statement));
          }
          afterOne = await live(tx);
          for (const statement of STATEMENTS) {
            await tx.execute(sql.raw(statement));
          }
          afterTwo = await live(tx);
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      expect(afterOne.map((row) => row.name).sort()).toEqual([...NAMES].sort());
      for (const name of NAMES) {
        const row = afterOne.find((r) => r.name === name);
        if (name === 'content-staying') {
          expect(row?.subject).toBe('Our own subject');
          continue;
        }
        const seed = seedEntry(name);
        expect(row).toMatchObject({
          subject: seed.subject,
          htmlBody: seed.htmlBody,
          textBody: seed.textBody,
          status: seed.status,
        });
      }
      expect(afterTwo.map((row) => row.id).sort()).toEqual(
        afterOne.map((row) => row.id).sort()
      );
    }
  );
});
