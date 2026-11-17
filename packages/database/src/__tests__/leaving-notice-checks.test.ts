/**
 * The leaving notice's migration (Codex-a6ofh.6): the database's backstop for
 * a piece that is leaving, and for the emails its owners are due.
 *
 * The service refuses each of these first (publish refuses a leaving piece;
 * the sweep moves a notice to `sent` with its time). Without this file, a
 * schema edit that dropped or loosened one of these CHECKs, then
 * regenerated, would pass every suite.
 *
 * Every write runs inside ONE transaction that is always rolled back, and
 * each refusal in its own savepoint and its own round, so one refusal that
 * wrongly passed can't make the next refused for the wrong reason:
 *   - content: a leave date is accepted on a piece that is neither published
 *     nor scheduled, and refused on one that is either, whichever is set
 *     first; `owners_can_download` is on by default; a leave date set in SQL
 *     and read into JS matches back exactly (millisecond precision);
 *   - notices: every kind and state the constants name is accepted, and
 *     anything else refused, a reason too; `sent` and `sent_at` come
 *     together; a try that did not send has attempts and a reason; a
 *     `removed` notice is never cancelled; one email of a kind per person
 *     per round, while a new round (a piece kept, then deleted again) is
 *     accepted.
 * The refusals are checked first, after the rollback, so a constraint that
 * stopped refusing is named rather than showing up as a wrong row count.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getConstraintName } from '../utils/db-errors';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

class Rollback extends Error {}

describe.skipIf(!HAS_DB)(
  'the leaving notice: the CHECKs and the unique',
  () => {
    it('lets only a piece neither live nor scheduled leave, and keeps each notice to one per person per round', async () => {
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
      const tried = new Set<string>(['failed', 'unknown', 'abandoned']);

      /** Each refused statement, by name, with the constraint that refused it. */
      const refused: Record<string, string | null> = {};
      let downloadDefault: boolean | undefined;
      let matchedBack = -1;
      let kept = -1;
      try {
        await dbWs.transaction(async (tx) => {
          await tx.insert(users).values({
            id: userId,
            email: `ln-checks-${tag}@example.test`,
            name: 'Leaving checks',
          });
          const piece = async (
            name: string,
            status: string,
            change: { leavesAt?: Date; publishRequestedAt?: Date } = {}
          ) => {
            const [row] = await tx
              .insert(content)
              .values({
                creatorId: userId,
                title: name,
                slug: `ln-checks-${name}-${tag}`,
                contentType: 'video',
                status,
                ...change,
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
          // draft reads Off sale too).
          const archived = await piece('archived', 'archived', {
            leavesAt: leaves,
          });
          await piece('draft', 'draft', { leavesAt: leaves });
          downloadDefault = archived.ownersCanDownload;

          const live = await piece('live', 'published');
          const scheduled = await piece('scheduled', 'draft', {
            publishRequestedAt: leaves,
          });
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
          await refuse(
            'a leave date set on a scheduled piece',
            sql`UPDATE content SET leaves_at = ${leaves} WHERE id = ${scheduled.id}`
          );
          await refuse(
            'a leaving piece scheduled',
            sql`UPDATE content SET publish_requested_at = ${leaves} WHERE id = ${archived.id}`
          );

          // A date set in SQL, as the delete will set it, read into JS and
          // matched back, as Keep will match its notices.
          const timed = await piece('timed', 'archived');
          await tx.execute(
            sql`UPDATE content SET leaves_at = now() + interval '30 days' WHERE id = ${timed.id}`
          );
          const [read] = await tx
            .select({ leavesAt: content.leavesAt })
            .from(content)
            .where(eq(content.id, timed.id));
          const readBack = read?.leavesAt;
          if (!readBack) throw new Error('no leave date read back');
          await tx.insert(contentLeavingNotices).values({
            contentId: timed.id,
            userId,
            kind: 'leaving',
            round: readBack,
          });
          const [byDate] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(content)
            .where(
              and(eq(content.id, timed.id), eq(content.leavesAt, readBack))
            );
          const [byRound] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(contentLeavingNotices)
            .where(
              and(
                eq(contentLeavingNotices.contentId, timed.id),
                eq(contentLeavingNotices.round, readBack)
              )
            );
          matchedBack = (byDate?.n ?? 0) + (byRound?.n ?? 0);

          // Every kind in every state the constants name, a round per state so
          // the unique never fires here, except a cancelled `removed`.
          for (const kind of CONTENT_LEAVING_NOTICE_KINDS) {
            for (const [i, state] of CONTENT_LEAVING_NOTICE_STATES.entries()) {
              if (kind === 'removed' && state === 'cancelled') continue;
              await tx.insert(contentLeavingNotices).values({
                contentId: archived.id,
                userId,
                kind,
                round: new Date(leaves.getTime() + i * 1000),
                state,
                attempts: tried.has(state) ? 1 : 0,
                lastReason: tried.has(state) ? 'unknown' : null,
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
          let fresh = 0;
          const notice = (
            name: string,
            change: Partial<{
              kind: string;
              state: string;
              attempts: number;
              lastReason: string;
              sentAt: Date;
              round: Date;
            }>
          ) => {
            fresh += 1;
            const row = {
              kind: 'leaving',
              state: 'due',
              attempts: 0,
              lastReason: null,
              sentAt: null,
              round: new Date(Date.UTC(2027, 5, 1, 12) + fresh * 1000),
              ...change,
            };
            return refuse(
              name,
              sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round, state, attempts, last_reason, sent_at)
                VALUES (${archived.id}, ${userId}, ${row.kind}, ${row.round}, ${row.state}, ${row.attempts}, ${row.lastReason}, ${row.sentAt})`
            );
          };
          await notice('an unknown kind', { kind: 'refunded' });
          await notice('an unknown state', { state: 'bounced' });
          await notice('an unknown reason', {
            state: 'failed',
            attempts: 1,
            // Fits the column, so only the CHECK can refuse it.
            lastReason: 'smtp_550',
          });
          await notice('sent with no time', { state: 'sent' });
          await notice('a time but not sent', { sentAt: leaves });
          await notice('failed with no try', {
            state: 'failed',
            lastReason: 'refused',
          });
          await notice('abandoned with no reason', {
            state: 'abandoned',
            attempts: 5,
          });
          await notice('a removed notice cancelled', {
            kind: 'removed',
            state: 'cancelled',
          });
          await notice('the same email twice in a round', { round: later });
          await refuse(
            'negative attempts',
            sql`UPDATE content_leaving_notices SET attempts = -1
              WHERE content_id = ${archived.id} AND round = ${later}`
          );

          const rows = await tx
            .select({ id: contentLeavingNotices.id })
            .from(contentLeavingNotices)
            .where(eq(contentLeavingNotices.contentId, archived.id));
          kept = rows.length;
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
        'a leave date set on a scheduled piece':
          'check_content_leaving_not_scheduled',
        'a leaving piece scheduled': 'check_content_leaving_not_scheduled',
        'an unknown kind': 'check_content_leaving_notices_kind',
        'an unknown state': 'check_content_leaving_notices_state',
        'an unknown reason': 'check_content_leaving_notices_reason',
        'sent with no time': 'check_content_leaving_notices_sent',
        'a time but not sent': 'check_content_leaving_notices_sent',
        'failed with no try': 'check_content_leaving_notices_tried',
        'abandoned with no reason': 'check_content_leaving_notices_tried',
        'a removed notice cancelled': 'check_content_leaving_notices_cancelled',
        'the same email twice in a round': 'uq_content_leaving_notices_person',
        'negative attempts': 'check_content_leaving_notices_attempts',
      });
      expect(downloadDefault).toBe(true);
      // The piece by its date, and its notice by its round.
      expect(matchedBack).toBe(2);
      expect(kept).toBe(
        CONTENT_LEAVING_NOTICE_KINDS.length *
          CONTENT_LEAVING_NOTICE_STATES.length -
          1 +
          1
      );
    });
  }
);
