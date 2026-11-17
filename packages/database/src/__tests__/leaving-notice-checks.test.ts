/**
 * Migration 0131 (Codex-a6ofh.6, the leaving notice): the database's backstop
 * for a piece that is leaving, and for the emails its owners are due.
 *
 * The service refuses each of these first (publish refuses a leaving piece;
 * the sweep moves a notice to `sent` with its time). Without this file, a
 * schema edit that dropped or loosened one of these CHECKs, then
 * regenerated, would pass every suite.
 *
 * Every write runs inside ONE transaction that is always rolled back, and
 * each refusal in its own savepoint:
 *   - content: a leave date on a piece that is not published is accepted;
 *     on a published one it is refused (`check_content_leaving_not_published`),
 *     whether at insert or by a later publish; `owners_can_download` is on
 *     by default;
 *   - notices: every kind and state the constants name is accepted, and
 *     anything else refused; `sent` and `sent_at` come together or not at
 *     all; one email of a kind per person per round, while a new round (a
 *     piece kept, then deleted again) is accepted.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/** The refused statement's SQLSTATE and constraint; drizzle wraps it in `cause`. */
function refusal(error: unknown): { code?: string; constraint?: string } {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  return {
    code: e.code ?? e.cause?.code,
    constraint: e.constraint ?? e.cause?.constraint,
  };
}

class Rollback extends Error {}

describe.skipIf(!HAS_DB)(
  '0131 leaving notice: the CHECKs and the unique',
  () => {
    it('lets only an unpublished piece leave, and keeps each notice to one per person per round', async () => {
      const { dbWs } = await import('../index');
      const { content, contentLeavingNotices, users } = await import(
        '../schema'
      );
      const { CONTENT_LEAVING_NOTICE_KINDS, CONTENT_LEAVING_NOTICE_STATES } =
        await import('@codex/constants');
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `ln_checks_user_${tag}`;
      const leaves = new Date(Date.UTC(2026, 11, 17, 12));
      const later = new Date(Date.UTC(2027, 0, 20, 12));

      const accepted: string[] = [];
      const refused: Record<string, { code?: string; constraint?: string }> =
        {};
      let defaultDownload: boolean | undefined;
      try {
        await dbWs.transaction(async (tx) => {
          await tx.insert(users).values({
            id: userId,
            email: `ln-checks-${tag}@example.test`,
            name: 'Leaving checks',
          });
          const piece = async (name: string, status: string) => {
            const [row] = await tx
              .insert(content)
              .values({
                creatorId: userId,
                title: name,
                slug: `ln-checks-${name}-${tag}`,
                contentType: 'video',
                status,
                leavesAt: status === 'published' ? null : leaves,
              })
              .returning({
                id: content.id,
                ownersCanDownload: content.ownersCanDownload,
              });
            if (!row) throw new Error(`no row for ${name}`);
            return row;
          };
          const refuse = async (
            name: string,
            statement: ReturnType<typeof sql>
          ) => {
            try {
              await tx.transaction(async (savepoint) => {
                await savepoint.execute(statement);
              });
            } catch (error) {
              refused[name] = refusal(error);
            }
          };

          // A leave date on an archived piece and on a draft (a once-live
          // draft reads Off sale too).
          const archived = await piece('archived', 'archived');
          await piece('draft', 'draft');
          accepted.push('archived leaving', 'draft leaving');
          defaultDownload = archived.ownersCanDownload;

          const live = await piece('live', 'published');
          await refuse(
            'a published piece with a leave date',
            sql`INSERT INTO content (creator_id, title, slug, content_type, status, leaves_at)
              VALUES (${userId}, 'x', ${`ln-checks-x-${tag}`}, 'video', 'published', ${leaves})`
          );
          await refuse(
            'a leave date set on a live piece',
            sql`UPDATE content SET leaves_at = ${leaves} WHERE id = ${live.id}`
          );
          await refuse(
            'a leaving piece published',
            sql`UPDATE content SET status = 'published' WHERE id = ${archived.id}`
          );

          // Every kind in every state the constants name, one round each.
          for (const kind of CONTENT_LEAVING_NOTICE_KINDS) {
            for (const state of CONTENT_LEAVING_NOTICE_STATES) {
              await tx.insert(contentLeavingNotices).values({
                contentId: archived.id,
                userId,
                kind,
                // A round per state, so the unique never fires here.
                round: new Date(
                  leaves.getTime() +
                    CONTENT_LEAVING_NOTICE_STATES.indexOf(state) * 1000
                ),
                state,
                sentAt: state === 'sent' ? leaves : null,
              });
              accepted.push(`${kind}/${state}`);
            }
          }
          // Kept, then deleted again: the same person is told again.
          await tx.insert(contentLeavingNotices).values({
            contentId: archived.id,
            userId,
            kind: 'leaving',
            round: later,
          });
          accepted.push('a new round');

          const notice = (
            name: string,
            kind: string,
            state: string,
            sentAt: Date | null,
            round: Date
          ) =>
            refuse(
              name,
              sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round, state, sent_at)
                VALUES (${archived.id}, ${userId}, ${kind}, ${round}, ${state}, ${sentAt})`
            );
          const fresh = new Date(Date.UTC(2027, 5, 1, 12));
          await notice('an unknown kind', 'refunded', 'due', null, fresh);
          await notice('an unknown state', 'leaving', 'bounced', null, fresh);
          await notice('sent with no time', 'leaving', 'sent', null, fresh);
          await notice('a time but not sent', 'leaving', 'due', leaves, fresh);
          await notice(
            'the same email twice in a round',
            'leaving',
            'due',
            null,
            later
          );
          await refuse(
            'negative attempts',
            sql`UPDATE content_leaving_notices SET attempts = -1
              WHERE content_id = ${archived.id} AND round = ${later}`
          );

          const kept = await tx
            .select({ id: contentLeavingNotices.id })
            .from(contentLeavingNotices)
            .where(eq(contentLeavingNotices.contentId, archived.id));
          expect(kept).toHaveLength(
            CONTENT_LEAVING_NOTICE_KINDS.length *
              CONTENT_LEAVING_NOTICE_STATES.length +
              1
          );
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      expect(defaultDownload).toBe(true);
      expect(accepted).toHaveLength(
        2 +
          CONTENT_LEAVING_NOTICE_KINDS.length *
            CONTENT_LEAVING_NOTICE_STATES.length +
          1
      );
      expect(refused).toEqual({
        'a published piece with a leave date': {
          code: '23514',
          constraint: 'check_content_leaving_not_published',
        },
        'a leave date set on a live piece': {
          code: '23514',
          constraint: 'check_content_leaving_not_published',
        },
        'a leaving piece published': {
          code: '23514',
          constraint: 'check_content_leaving_not_published',
        },
        'an unknown kind': {
          code: '23514',
          constraint: 'check_content_leaving_notices_kind',
        },
        'an unknown state': {
          code: '23514',
          constraint: 'check_content_leaving_notices_state',
        },
        'sent with no time': {
          code: '23514',
          constraint: 'check_content_leaving_notices_sent',
        },
        'a time but not sent': {
          code: '23514',
          constraint: 'check_content_leaving_notices_sent',
        },
        'the same email twice in a round': {
          code: '23505',
          constraint: 'uq_content_leaving_notices_person',
        },
        'negative attempts': {
          code: '23514',
          constraint: 'check_content_leaving_notices_attempts',
        },
      });
    });
  }
);
