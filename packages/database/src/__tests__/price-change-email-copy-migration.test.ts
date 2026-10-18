/**
 * Migration 0098 — the price-change email's "next billing cycle" sentence
 * (Codex-2hxff.35).
 *
 * Since Codex-2hxff.3 a price change reaches a subscriber at their first
 * renewal ≥ 30 days after the email, so "your subscription will renew at the
 * new price on the next billing cycle" is false. The seed was corrected, but it
 * skips templates that already exist, so 0098 rewrites the live rows.
 *
 * Runs 0098's own SQL against real rows inside ONE transaction that is always
 * rolled back, so the shared test database is left exactly as it was. Pins:
 *   - a stale row gets exactly the new sentence, every other byte unchanged;
 *   - an org-scoped copy is fixed too (the sentence describes platform billing);
 *   - an edited row, a soft-deleted row and another template are untouched.
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
  path.resolve(here, '../migrations/0098_price_change_email_copy.sql'),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const OLD =
  'your subscription will renew at the new price on the next billing cycle.';
const NEW =
  'your subscription renews at the new price from {{effectiveDate}}. Renewals before then stay at your current price.';
const TEMPLATE = 'subscription-tier-price-change';

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

describe('0098 price-change email copy (Codex-2hxff.35)', () => {
  it('the seed carries the new sentence, so a fresh database never needs 0098', () => {
    expect(SEED).toContain(NEW);
    expect(SEED).not.toContain(OLD);
  });

  it.skipIf(!HAS_DB)(
    'replaces exactly the old sentence on every live copy, and touches nothing else',
    async () => {
      const { dbWs } = await import('../index');
      const { emailTemplates, organizations } = await import('../schema');
      const stamp = new Date('2020-01-01T00:00:00Z');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const row = (name: string, body: string) => ({
        name,
        subject: 'Your price is changing',
        htmlBody: `<p>No action is needed — ${body}</p>`,
        textBody: `No action is needed — ${body}\n\nThanks`,
        status: 'active' as const,
        updatedAt: stamp,
      });

      let rows: Array<typeof emailTemplates.$inferSelect> = [];
      let ids: Record<string, string> = {};
      try {
        await dbWs.transaction(async (tx) => {
          // Stand the real global row aside so this fixture owns the name
          // (unique per scope while live). Rolled back with everything else.
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
          // Two orgs: a copy is unique per (name, org) while live.
          const [orgA, orgB] = await tx
            .insert(organizations)
            .values([
              { name: 'Email Copy Org A', slug: `email-copy-a-${suffix}` },
              { name: 'Email Copy Org B', slug: `email-copy-b-${suffix}` },
            ])
            .returning({ id: organizations.id });
          if (!orgA || !orgB) throw new Error('fixture orgs not inserted');

          const [stale, orgCopy, edited, deleted, other] = await tx
            .insert(emailTemplates)
            .values([
              { ...row(TEMPLATE, OLD), scope: 'global' },
              {
                ...row(TEMPLATE, OLD),
                scope: 'organization',
                organizationId: orgA.id,
              },
              {
                ...row(TEMPLATE, 'we wrote our own wording.'),
                scope: 'organization',
                organizationId: orgB.id,
              },
              { ...row(TEMPLATE, OLD), scope: 'global', deletedAt: stamp },
              { ...row(`${TEMPLATE}-other-${suffix}`, OLD), scope: 'global' },
            ])
            .returning({ id: emailTemplates.id });
          if (!stale || !orgCopy || !edited || !deleted || !other) {
            throw new Error('fixture templates not inserted');
          }
          ids = {
            stale: stale.id,
            orgCopy: orgCopy.id,
            edited: edited.id,
            deleted: deleted.id,
            other: other.id,
          };

          await tx.execute(sql.raw(MIGRATION));

          rows = await tx
            .select()
            .from(emailTemplates)
            .where(inArray(emailTemplates.id, Object.values(ids)));
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      const byId = (id: string | undefined) => rows.find((r) => r.id === id);
      for (const key of ['stale', 'orgCopy'] as const) {
        const fixed = byId(ids[key]);
        expect(fixed?.htmlBody).toBe(`<p>No action is needed — ${NEW}</p>`);
        expect(fixed?.textBody).toBe(`No action is needed — ${NEW}\n\nThanks`);
        expect(fixed?.updatedAt.getTime()).not.toBe(stamp.getTime());
      }
      for (const key of ['deleted', 'other'] as const) {
        const untouched = byId(ids[key]);
        expect(untouched?.htmlBody).toBe(`<p>No action is needed — ${OLD}</p>`);
        expect(untouched?.updatedAt.getTime()).toBe(stamp.getTime());
      }
      const edited = byId(ids.edited);
      expect(edited?.htmlBody).toBe(
        '<p>No action is needed — we wrote our own wording.</p>'
      );
      expect(edited?.updatedAt.getTime()).toBe(stamp.getTime());
      expect(rows).toHaveLength(5);
    }
  );
});
