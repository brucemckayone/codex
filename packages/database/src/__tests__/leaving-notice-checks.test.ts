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
import { getConstraintName } from '../utils/db-errors';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

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

      /** Each refused statement, by name, with the constraint that refused it. */
      const refused: Record<string, string | null> = {};
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
              refused[name] = getConstraintName(error);
            }
          };

          // A leave date on an archived piece and on a draft (a once-live
          // draft reads Off sale too), and downloads on by default.
          const archived = await piece('archived', 'archived');
          await piece('draft', 'draft');
          expect(archived.ownersCanDownload).toBe(true);

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

          // Every kind in every state the constants name, a round per state so
          // the unique never fires here.
          for (const kind of CONTENT_LEAVING_NOTICE_KINDS) {
            for (const [i, state] of CONTENT_LEAVING_NOTICE_STATES.entries()) {
              await tx.insert(contentLeavingNotices).values({
                contentId: archived.id,
                userId,
                kind,
                round: new Date(leaves.getTime() + i * 1000),
                state,
                sentAt: state === 'sent' ? leaves : null,
              });
            }
          }
          // Kept, then deleted again: the same person is told again.
          await tx.insert(contentLeavingNotices).values({
            contentId: archived.id,
            userId,
            kind: 'leaving',
            round: later,
          });

          /** A notice that differs from a fresh, valid one only by `change`. */
          const notice = (
            name: string,
            change: Partial<{
              kind: string;
              state: string;
              sentAt: Date;
              round: Date;
            }>
          ) => {
            const row = {
              kind: 'leaving',
              state: 'due',
              sentAt: null,
              round: new Date(Date.UTC(2027, 5, 1, 12)),
              ...change,
            };
            return refuse(
              name,
              sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round, state, sent_at)
                VALUES (${archived.id}, ${userId}, ${row.kind}, ${row.round}, ${row.state}, ${row.sentAt})`
            );
          };
          await notice('an unknown kind', { kind: 'refunded' });
          await notice('an unknown state', { state: 'bounced' });
          await notice('sent with no time', { state: 'sent' });
          await notice('a time but not sent', { sentAt: leaves });
          await notice('the same email twice in a round', { round: later });
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

      expect(refused).toEqual({
        'a published piece with a leave date':
          'check_content_leaving_not_published',
        'a leave date set on a live piece':
          'check_content_leaving_not_published',
        'a leaving piece published': 'check_content_leaving_not_published',
        'an unknown kind': 'check_content_leaving_notices_kind',
        'an unknown state': 'check_content_leaving_notices_state',
        'sent with no time': 'check_content_leaving_notices_sent',
        'a time but not sent': 'check_content_leaving_notices_sent',
        'the same email twice in a round': 'uq_content_leaving_notices_person',
        'negative attempts': 'check_content_leaving_notices_attempts',
      });
    });
  }
);
