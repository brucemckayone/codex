/**
 * Migration 0117 — the team-invitation email names the organisation and opens
 * it (Codex-2hxff.84, from Codex-bnxhw, owner decision 2026-10-27 "Open the
 * org").
 *
 * Kept OUT of the tree until 0117 ships, one release after the code that
 * sends `orgUrl` and `roleLabel`. Production runs migrations before the
 * workers deploy, so the same release would let the previous
 * notifications-api render the new row with a blank button. To land it, put
 * it at packages/database/src/__tests__/member-invitation-copy-migration.test.ts
 * beside migrations/0117_member_invitation_copy.sql (the scratchpad draft
 * fu-0117-invitation-template.sql).
 *
 * Adding someone makes them a member at once, so nothing is accepted and
 * nothing expires. The email said "has invited you to join", its "Accept
 * Invitation" button went to /accept-invite (which does not exist), and it said
 * the invitation expires. The seed was corrected, but it skips templates that
 * already exist, so the migration rewrites the live rows.
 *
 * Runs the migration's own SQL against real rows inside ONE transaction that
 * is always rolled back, so the shared test database is left exactly as it
 * was. Pins:
 *   - a stale stock row becomes EXACTLY the current seed, in a global and an
 *     org-scoped copy;
 *   - a customised copy keeps its own words, including a plain
 *     `{{roleName}}`, but `{{acceptUrl}}` becomes `{{orgUrl}}`, because the
 *     sender will stop passing `acceptUrl` (Codex-2hxff.83) and a missing
 *     token renders as nothing;
 *   - a row with none of the old phrases, a soft-deleted row and another
 *     template are untouched;
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
  path.resolve(here, '../migrations/0117_member_invitation_copy.sql'),
  'utf8'
);
const SEED = readFileSync(
  path.resolve(here, '../../scripts/seed-email-templates.ts'),
  'utf8'
);

const TEMPLATE = 'org-member-invitation';

/** The seed's own entry for the template: subject and both bodies. */
function seedEntry(): { subject: string; htmlBody: string; textBody: string } {
  const start = SEED.indexOf(`name: '${TEMPLATE}'`);
  expect(start).toBeGreaterThan(-1);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const subject = /subject: "([^"]*)"/.exec(entry)?.[1];
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (!subject || !htmlBody || !textBody) {
    throw new Error('seed entry not found');
  }
  // The seed's bodies are template literals: `\n` in the source is a newline.
  return { subject, htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const NEW = seedEntry();
const OLD_SUBJECT = "You've been invited to {{orgName}}";
const NEW_SUBJECT = "You've been added to {{orgName}}";

// The HTML's head and footer did not change; only the middle did.
const HEAD = NEW.htmlBody.slice(0, NEW.htmlBody.indexOf('<h1>'));
const FOOT = NEW.htmlBody.slice(NEW.htmlBody.indexOf('<div class="footer">'));
const OLD_MIDDLE =
  '<h1>You\'ve been invited!</h1><p><strong>{{inviterName}}</strong> has invited you to join <strong>{{orgName}}</strong> as a <strong>{{roleName}}</strong>.</p><p style="text-align:center;margin:30px 0;"><a href="{{acceptUrl}}" class="button" style="color:white;">Accept Invitation</a></p><p style="color:#666;font-size:13px;">This invitation expires in {{expiryDays}} days.</p>';
const NEW_MIDDLE =
  '<h1>You\'ve been added to {{orgName}}</h1><p><strong>{{inviterName}}</strong> has added you to <strong>{{orgName}}</strong> as <strong>{{roleLabel}}</strong>.</p><p style="text-align:center;margin:30px 0;"><a href="{{orgUrl}}" class="button" style="color:white;">Open {{orgName}}</a></p>';
const OLD_HTML = `${HEAD}${OLD_MIDDLE}${FOOT}`;
const OLD_TEXT =
  '{{inviterName}} has invited you to join {{orgName}} as a {{roleName}}.\n\nAccept your invitation: {{acceptUrl}}\n\nThis invitation expires in {{expiryDays}} days.\n\n{{platformName}}';
const NEW_TEXT =
  '{{inviterName}} has added you to {{orgName}} as {{roleLabel}}.\n\nOpen {{orgName}}: {{orgUrl}}\n\n{{platformName}}';

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

describe('the member invitation copy migration (Codex-2hxff.84)', () => {
  it('the seed carries the new wording, so a fresh database never needs the migration', () => {
    expect(NEW.subject).toBe(NEW_SUBJECT);
    expect(NEW.htmlBody).toBe(`${HEAD}${NEW_MIDDLE}${FOOT}`);
    expect(NEW.textBody).toBe(NEW_TEXT);
    for (const gone of ['acceptUrl', 'expiryDays', 'Accept', 'expires']) {
      expect(NEW.htmlBody).not.toContain(gone);
      expect(NEW.textBody).not.toContain(gone);
    }
  });

  it.skipIf(!HAS_DB)(
    'rewords every live stale copy exactly, renames the token in a customised one, and touches nothing else',
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
      // Its own words: a plain `{{roleName}}` outside the stock phrase stays.
      const CUSTOM_HTML =
        '<p>Welcome aboard, {{roleName}}!</p><a href="{{acceptUrl}}">Come in</a>';
      const CUSTOM_TEXT = 'Welcome aboard! {{acceptUrl}}';
      // Its own expiry wording: nothing can reword it, so it keeps the token.
      // A send of it is warned once the sender stops passing `expiryDays`.
      const OWN_EXPIRY = '<p>Join within {{expiryDays}} days!</p>';

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
          const [orgA, orgB, orgC, orgD] = await tx
            .insert(organizations)
            .values([
              { name: 'Invite Copy Org A', slug: `invite-copy-a-${suffix}` },
              { name: 'Invite Copy Org B', slug: `invite-copy-b-${suffix}` },
              { name: 'Invite Copy Org C', slug: `invite-copy-c-${suffix}` },
              { name: 'Invite Copy Org D', slug: `invite-copy-d-${suffix}` },
            ])
            .returning({ id: organizations.id });
          if (!orgA || !orgB || !orgC || !orgD) {
            throw new Error('fixture orgs not inserted');
          }

          const [stale, orgCopy, custom, edited, deleted, other, ownExpiry] =
            await tx
              .insert(emailTemplates)
              .values([
                { ...row(TEMPLATE, OLD_HTML, OLD_TEXT), scope: 'global' },
                {
                  ...row(TEMPLATE, OLD_HTML, OLD_TEXT),
                  scope: 'organization',
                  organizationId: orgA.id,
                },
                {
                  ...row(TEMPLATE, CUSTOM_HTML, CUSTOM_TEXT),
                  subject: 'Welcome to {{orgName}}',
                  scope: 'organization',
                  organizationId: orgB.id,
                },
                {
                  ...row(
                    TEMPLATE,
                    '<p>Our own wording.</p>',
                    'Our own wording.'
                  ),
                  subject: 'Our own subject',
                  scope: 'organization',
                  organizationId: orgC.id,
                },
                {
                  ...row(TEMPLATE, OLD_HTML, OLD_TEXT),
                  scope: 'global',
                  deletedAt: stamp,
                },
                {
                  ...row(`${TEMPLATE}-other-${suffix}`, OLD_HTML, OLD_TEXT),
                  scope: 'global',
                },
                {
                  ...row(TEMPLATE, OWN_EXPIRY, 'Join soon.'),
                  subject: 'Join us',
                  scope: 'organization',
                  organizationId: orgD.id,
                },
              ])
              .returning({ id: emailTemplates.id });
          if (
            !stale ||
            !orgCopy ||
            !custom ||
            !edited ||
            !deleted ||
            !other ||
            !ownExpiry
          ) {
            throw new Error('fixture templates not inserted');
          }
          ids = {
            stale: stale.id,
            orgCopy: orgCopy.id,
            custom: custom.id,
            edited: edited.id,
            deleted: deleted.id,
            other: other.id,
            ownExpiry: ownExpiry.id,
          };

          // As the migrator runs it: one statement per breakpoint (just the
          // UPDATE: migrate-direct.ts shows no NOTICE, so none is raised).
          const statements = MIGRATION.split('--> statement-breakpoint')
            .map((statement) => statement.trim())
            .filter(Boolean);
          expect(statements).toHaveLength(1);
          for (const statement of statements) {
            await tx.execute(sql.raw(statement));
          }
          // Safe to run again: no old phrase is left to replace.
          for (const statement of statements) {
            await tx.execute(sql.raw(statement));
          }

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
        expect(fixed?.subject).toBe(NEW.subject);
        expect(fixed?.htmlBody).toBe(NEW.htmlBody);
        expect(fixed?.textBody).toBe(NEW.textBody);
        expect(fixed?.updatedAt.getTime()).not.toBe(stamp.getTime());
      }
      const custom = byId(ids.custom);
      expect(custom?.subject).toBe('Welcome to {{orgName}}');
      expect(custom?.htmlBody).toBe(
        '<p>Welcome aboard, {{roleName}}!</p><a href="{{orgUrl}}">Come in</a>'
      );
      expect(custom?.textBody).toBe('Welcome aboard! {{orgUrl}}');
      expect(custom?.updatedAt.getTime()).not.toBe(stamp.getTime());
      const edited = byId(ids.edited);
      expect(edited?.subject).toBe('Our own subject');
      expect(edited?.htmlBody).toBe('<p>Our own wording.</p>');
      expect(edited?.updatedAt.getTime()).toBe(stamp.getTime());
      for (const key of ['deleted', 'other'] as const) {
        const untouched = byId(ids[key]);
        expect(untouched?.subject).toBe(OLD_SUBJECT);
        expect(untouched?.htmlBody).toBe(OLD_HTML);
        expect(untouched?.textBody).toBe(OLD_TEXT);
        expect(untouched?.updatedAt.getTime()).toBe(stamp.getTime());
      }
      // Left as it was: nothing can reword a sentence it doesn't know.
      const ownExpiry = byId(ids.ownExpiry);
      expect(ownExpiry?.htmlBody).toBe(OWN_EXPIRY);
      expect(ownExpiry?.updatedAt.getTime()).toBe(stamp.getTime());
      expect(rows).toHaveLength(7);
    }
  );
});
