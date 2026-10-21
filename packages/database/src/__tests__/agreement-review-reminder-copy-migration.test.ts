/**
 * Migration 0106 — the 30-day agreement email is a REVIEW reminder
 * (Codex-2hxff.17).
 *
 * The term's end is a review date, not an expiry (owner decision AGR-01): the
 * agreement keeps paying past it. The email said it "expires" and that "after
 * expiry the org reverts to keeping 100%". The seed was corrected, but it skips
 * templates that already exist, so 0106 rewrites the live rows.
 *
 * Runs 0106's own SQL against real rows inside ONE transaction that is always
 * rolled back, so the shared test database is left exactly as it was. Pins:
 *   - a stale row gets exactly the new subject and sentences, nothing else;
 *   - an org-scoped copy is fixed too;
 *   - a row whose HTML was customised keeps it, while its stock text is fixed;
 *   - an edited row, a soft-deleted row and another template are untouched;
 *   - a second run changes nothing.
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
  path.resolve(here, '../migrations/0106_agreement_review_reminder_copy.sql'),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const TEMPLATE = 'agreement-expiring-soon';
const OLD_SUBJECT = 'Revenue-share agreement with {{orgName}} expires soon';
const NEW_SUBJECT =
  'Time to review your revenue-share agreement with {{orgName}}';
const OLD_CLOSE =
  'If you wish to extend or renegotiate, open a new proposal before the expiry date. After expiry the org reverts to keeping 100% of post-platform {{revenueTypeLabel}} revenue.';
const NEW_CLOSE =
  'Nothing changes on that date: the agreement keeps paying until either of you ends it, or a new agreement replaces it. To agree different terms, open a new proposal.';

const oldHtml = `<h1>Agreement expiring soon</h1><p>Your agreement is approaching its expiry date.</p><p><strong>Expires on:</strong> {{expiryDate}}</p><p>${OLD_CLOSE}</p>`;
const newHtml = `<h1>Agreement review due</h1><p>Your agreement reaches its review date soon.</p><p><strong>Review by:</strong> {{expiryDate}}</p><p>${NEW_CLOSE}</p>`;
const oldText = `Your agreement is approaching its expiry date.\nExpires on: {{expiryDate}}\n\n${OLD_CLOSE}\n\nThanks`;
const newText = `Your agreement reaches its review date soon.\nReview by: {{expiryDate}}\n\n${NEW_CLOSE}\n\nThanks`;

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

describe('0106 agreement review-reminder copy (Codex-2hxff.17)', () => {
  it('the seed carries the review wording, so a fresh database never needs 0106', () => {
    expect(SEED).toContain(NEW_SUBJECT);
    expect(SEED).toContain(NEW_CLOSE);
    expect(SEED).not.toContain(OLD_SUBJECT);
    expect(SEED).not.toContain('After expiry the org reverts');
  });

  it.skipIf(!HAS_DB)(
    'rewords every live stale copy exactly, and touches nothing else',
    async () => {
      const { dbWs } = await import('../index');
      const { emailTemplates, organizations } = await import('../schema');
      const stamp = new Date('2020-01-01T00:00:00Z');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const row = (name: string, htmlBody: string, textBody: string) => ({
        name,
        subject: OLD_SUBJECT,
        htmlBody,
        textBody,
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
          const [orgA, orgB, orgC] = await tx
            .insert(organizations)
            .values([
              { name: 'Review Copy Org A', slug: `review-copy-a-${suffix}` },
              { name: 'Review Copy Org B', slug: `review-copy-b-${suffix}` },
              { name: 'Review Copy Org C', slug: `review-copy-c-${suffix}` },
            ])
            .returning({ id: organizations.id });
          if (!orgA || !orgB || !orgC) {
            throw new Error('fixture orgs not inserted');
          }

          const [stale, orgCopy, edited, deleted, other, htmlEdited] = await tx
            .insert(emailTemplates)
            .values([
              { ...row(TEMPLATE, oldHtml, oldText), scope: 'global' },
              {
                ...row(TEMPLATE, oldHtml, oldText),
                scope: 'organization',
                organizationId: orgA.id,
              },
              {
                ...row(TEMPLATE, '<p>Our own wording.</p>', 'Our own wording.'),
                scope: 'organization',
                organizationId: orgB.id,
              },
              {
                ...row(TEMPLATE, oldHtml, oldText),
                scope: 'global',
                deletedAt: stamp,
              },
              {
                ...row(`${TEMPLATE}-other-${suffix}`, oldHtml, oldText),
                scope: 'global',
              },
              {
                ...row(TEMPLATE, '<p>Our own wording.</p>', oldText),
                scope: 'organization',
                organizationId: orgC.id,
              },
            ])
            .returning({ id: emailTemplates.id });
          if (
            !stale ||
            !orgCopy ||
            !edited ||
            !deleted ||
            !other ||
            !htmlEdited
          ) {
            throw new Error('fixture templates not inserted');
          }
          ids = {
            stale: stale.id,
            orgCopy: orgCopy.id,
            edited: edited.id,
            deleted: deleted.id,
            other: other.id,
            htmlEdited: htmlEdited.id,
          };

          await tx.execute(sql.raw(MIGRATION));
          // Safe to run again: the guard no longer matches a fixed body.
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
        expect(fixed?.subject).toBe(NEW_SUBJECT);
        expect(fixed?.htmlBody).toBe(newHtml);
        expect(fixed?.textBody).toBe(newText);
        expect(fixed?.updatedAt.getTime()).not.toBe(stamp.getTime());
      }
      for (const key of ['deleted', 'other'] as const) {
        const untouched = byId(ids[key]);
        expect(untouched?.htmlBody).toBe(oldHtml);
        expect(untouched?.subject).toBe(OLD_SUBJECT);
        expect(untouched?.updatedAt.getTime()).toBe(stamp.getTime());
      }
      const edited = byId(ids.edited);
      expect(edited?.htmlBody).toBe('<p>Our own wording.</p>');
      expect(edited?.subject).toBe(OLD_SUBJECT);
      expect(edited?.updatedAt.getTime()).toBe(stamp.getTime());
      const htmlEdited = byId(ids.htmlEdited);
      expect(htmlEdited?.htmlBody).toBe('<p>Our own wording.</p>');
      expect(htmlEdited?.textBody).toBe(newText);
      expect(htmlEdited?.subject).toBe(NEW_SUBJECT);
      expect(rows).toHaveLength(6);
    }
  );
});
