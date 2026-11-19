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
 * each write that may be refused in its own savepoint and its own round, so
 * one refusal that wrongly passed can't make the next refused for the wrong
 * reason:
 *   - content: a leave date is accepted on a piece that is neither published
 *     nor scheduled, and refused on one that is either, whichever is set
 *     first; `owners_can_download` is on by default; a leave date set in SQL
 *     and read into JS matches back exactly, and so does a round set from
 *     the clock (millisecond precision);
 *   - notices: every kind and state the constants name is accepted, and
 *     anything else refused, a reason too; `sent` and `sent_at` come
 *     together; every state a try leaves has the try counted, and a try
 *     that did not send has a reason that fits its state, null included; a
 *     `removed` notice is never cancelled; one
 *     email of a kind per person per round, while a new round (a piece kept,
 *     then deleted again) is accepted.
 * The outcomes are checked first, after the rollback, so a constraint that
 * stopped refusing is named rather than showing up as a wrong row count.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import type {
  ContentLeavingNoticeReason,
  ContentLeavingNoticeState,
} from '@codex/constants';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
      const {
        CONTENT_LEAVING_NOTICE_KINDS,
        CONTENT_LEAVING_NOTICE_OPEN_STATES,
        CONTENT_LEAVING_NOTICE_REASONS,
        CONTENT_LEAVING_NOTICE_STATES,
        CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES,
      } = await import('@codex/constants');
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `ln_checks_user_${tag}`;
      // A second owner, so the unique is proved per person, not per round.
      const otherUserId = `ln_checks_other_${tag}`;
      const leaves = new Date(Date.UTC(2026, 11, 17, 12));
      const later = new Date(Date.UTC(2027, 0, 20, 12));
      /** The reason each tried state's model row gives, as the sweep would. */
      const reasonFor: Partial<
        Record<ContentLeavingNoticeState, ContentLeavingNoticeReason>
      > = {
        failed: 'refused',
        unknown: 'unknown',
        abandoned: 'no_address',
      };

      /**
       * Each write that may be refused, by name: null if it was accepted,
       * else the constraint that refused it.
       */
      const outcome: Record<string, string | null> = {};
      /** Every tried state with every reason, the same way. */
      const pairs: Record<string, string | null> = {};
      let downloadDefault: boolean | undefined;
      const matchedBack = { piece: -1, notice: -1 };
      /** The claim index's states, as the migrated database holds them. */
      let claimStates: string[] = [];
      let kept = -1;
      try {
        await dbWs.transaction(async (tx) => {
          await tx.insert(users).values([
            {
              id: userId,
              email: `ln-checks-${tag}@example.test`,
              name: 'Leaving checks',
            },
            {
              id: otherUserId,
              email: `ln-checks-other-${tag}@example.test`,
              name: 'Leaving checks, other owner',
            },
          ]);
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
          /** null if `statement` was accepted, else the refusing constraint. */
          const attempt = async (statement: ReturnType<typeof sql>) => {
            try {
              await tx.transaction(async (savepoint) => {
                await savepoint.execute(statement);
              });
              return null;
            } catch (error) {
              return getConstraintName(error);
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
          outcome['a published piece with a leave date'] = await attempt(
            sql`INSERT INTO content (creator_id, title, slug, content_type, status, leaves_at)
              VALUES (${userId}, 'x', ${`ln-checks-x-${tag}`}, 'video', 'published', ${leaves})`
          );
          outcome['a leave date set on a live piece'] = await attempt(
            sql`UPDATE content SET leaves_at = ${leaves} WHERE id = ${live.id}`
          );
          outcome['a leaving piece published'] = await attempt(
            sql`UPDATE content SET status = 'published' WHERE id = ${archived.id}`
          );
          outcome['a leave date set on a scheduled piece'] = await attempt(
            sql`UPDATE content SET leaves_at = ${leaves} WHERE id = ${scheduled.id}`
          );
          outcome['a leaving piece scheduled'] = await attempt(
            sql`UPDATE content SET publish_requested_at = ${leaves} WHERE id = ${archived.id}`
          );

          // Dates set from the clock in SQL, which keeps microseconds, read
          // into JS, which keeps milliseconds, and matched back: the piece's
          // date as the delete sets it and Keep matches it, and a takedown's
          // round as the admin delete sets it.
          const timed = await piece('timed', 'archived');
          await tx.execute(
            sql`UPDATE content SET leaves_at = now() + interval '30 days' WHERE id = ${timed.id}`
          );
          await tx.execute(
            sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round)
              VALUES (${timed.id}, ${userId}, 'removed', now())`
          );
          const [read] = await tx
            .select({ leavesAt: content.leavesAt })
            .from(content)
            .where(eq(content.id, timed.id));
          const [readRound] = await tx
            .select({ round: contentLeavingNotices.round })
            .from(contentLeavingNotices)
            .where(eq(contentLeavingNotices.contentId, timed.id));
          if (!read?.leavesAt || !readRound) {
            throw new Error('no date read back');
          }
          const [byDate] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(content)
            .where(
              and(eq(content.id, timed.id), eq(content.leavesAt, read.leavesAt))
            );
          const [byRound] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(contentLeavingNotices)
            .where(
              and(
                eq(contentLeavingNotices.contentId, timed.id),
                eq(contentLeavingNotices.round, readRound.round)
              )
            );
          matchedBack.piece = byDate?.n ?? 0;
          matchedBack.notice = byRound?.n ?? 0;

          // Every kind in every state the constants name, a round per state so
          // the unique never fires here, except a cancelled `removed`.
          for (const kind of CONTENT_LEAVING_NOTICE_KINDS) {
            for (const [i, state] of CONTENT_LEAVING_NOTICE_STATES.entries()) {
              if (kind === 'removed' && state === 'cancelled') continue;
              const reason = reasonFor[state] ?? null;
              await tx.insert(contentLeavingNotices).values({
                contentId: archived.id,
                userId,
                kind,
                round: new Date(leaves.getTime() + i * 1000),
                state,
                attempts: state === 'sent' || reason ? 1 : 0,
                lastReason: reason,
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
            change: Partial<{
              kind: string;
              state: string;
              attempts: number;
              lastReason: string | null;
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
            return attempt(
              sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round, state, attempts, last_reason, sent_at)
                VALUES (${archived.id}, ${userId}, ${row.kind}, ${row.round}, ${row.state}, ${row.attempts}, ${row.lastReason}, ${row.sentAt})`
            );
          };
          outcome['an unknown kind'] = await notice({ kind: 'refunded' });
          outcome['an unknown state'] = await notice({ state: 'bounced' });
          outcome['an unknown reason'] = await notice({
            // `abandoned` keeps any reason, so only the value CHECK speaks.
            state: 'abandoned',
            attempts: 1,
            // Fits the column, so only the CHECK can refuse it.
            lastReason: 'smtp_550',
          });
          outcome['sent with no time'] = await notice({
            state: 'sent',
            attempts: 1,
          });
          outcome['a time but not sent'] = await notice({ sentAt: leaves });
          outcome['sent with no try'] = await notice({
            state: 'sent',
            sentAt: leaves,
          });
          outcome['failed with no try'] = await notice({
            state: 'failed',
            lastReason: 'refused',
          });
          outcome['unknown with no try'] = await notice({
            state: 'unknown',
            lastReason: 'unknown',
          });
          outcome['abandoned with no try'] = await notice({
            state: 'abandoned',
            lastReason: 'no_address',
          });
          outcome['abandoned with no reason'] = await notice({
            state: 'abandoned',
            attempts: 5,
          });
          outcome['a removed notice cancelled'] = await notice({
            kind: 'removed',
            state: 'cancelled',
          });
          outcome['the same email twice in a round'] = await notice({
            round: later,
          });
          outcome['negative attempts'] = await attempt(
            sql`UPDATE content_leaving_notices SET attempts = -1
              WHERE content_id = ${archived.id} AND round = ${later}`
          );
          // The unique is per person AND per piece: a second owner of the same
          // piece, and the same owner's second piece, in the round `later`
          // already holds, are both accepted. A unique that lost either
          // column would let DO NOTHING drop every owner but one.
          const secondPiece = await piece('second', 'archived', {
            leavesAt: later,
          });
          outcome['a second owner, same piece and round'] = await attempt(
            sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round)
              VALUES (${archived.id}, ${otherUserId}, 'leaving', ${later})`
          );
          outcome['a second piece, same owner and round'] = await attempt(
            sql`INSERT INTO content_leaving_notices (content_id, user_id, kind, round)
              VALUES (${secondPiece.id}, ${userId}, 'leaving', ${later})`
          );
          // Legitimate tried forms of the open and cancelled states: the claim
          // adds the try while a row stays `due`, and Keep cancels a row
          // tried or not, keeping its reason.
          outcome['due with a try'] = await notice({ attempts: 1 });
          outcome['cancelled with a try and a reason'] = await notice({
            state: 'cancelled',
            attempts: 2,
            lastReason: 'refused',
          });
          outcome['failed with three tries'] = await notice({
            state: 'failed',
            attempts: 3,
            lastReason: 'refused',
          });
          for (const state of CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES) {
            for (const lastReason of [
              ...CONTENT_LEAVING_NOTICE_REASONS,
              null,
            ]) {
              pairs[`${state} ${lastReason ?? 'none'}`] = await notice({
                state,
                attempts: 1,
                lastReason,
              });
            }
          }

          // The DDL is generated from @codex/constants' built dist/, so a
          // list changed without a rebuild and regenerate leaves the index
          // on the old one with no error. Read it back from the database.
          const index = await tx.execute(
            sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_content_leaving_notices_open'`
          );
          const indexdef = index.rows[0]?.indexdef;
          claimStates =
            typeof indexdef === 'string'
              ? [...indexdef.matchAll(/'([a-z_]+)'/g)]
                  .map((match) => match[1] ?? '')
                  .sort()
              : [];

          const rows = await tx
            .select({ id: contentLeavingNotices.id })
            .from(contentLeavingNotices)
            .where(
              inArray(contentLeavingNotices.contentId, [
                archived.id,
                secondPiece.id,
              ])
            );
          kept = rows.length;
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      expect(outcome).toEqual({
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
        'sent with no try': 'check_content_leaving_notices_tried',
        'failed with no try': 'check_content_leaving_notices_tried',
        'unknown with no try': 'check_content_leaving_notices_tried',
        'abandoned with no try': 'check_content_leaving_notices_tried',
        'abandoned with no reason':
          'check_content_leaving_notices_reason_given',
        'a removed notice cancelled': 'check_content_leaving_notices_cancelled',
        'the same email twice in a round': 'uq_content_leaving_notices_person',
        'negative attempts': 'check_content_leaving_notices_attempts',
        'a second owner, same piece and round': null,
        'a second piece, same owner and round': null,
        'due with a try': null,
        'cancelled with a try and a reason': null,
        'failed with three tries': null,
      });
      // A refused or skipped try is `failed`; a try with no answer is
      // `unknown`, never the other way; no address only ends a row
      // `abandoned`, which keeps any reason; none of them goes without one.
      const fits = 'check_content_leaving_notices_reason_fits';
      const given = 'check_content_leaving_notices_reason_given';
      expect(pairs).toEqual({
        'failed refused': null,
        'failed skipped': null,
        'failed no_address': fits,
        'failed unknown': fits,
        'failed none': given,
        'unknown refused': fits,
        'unknown skipped': fits,
        'unknown no_address': fits,
        'unknown unknown': null,
        'unknown none': given,
        'abandoned refused': null,
        'abandoned skipped': null,
        'abandoned no_address': null,
        'abandoned unknown': null,
        'abandoned none': given,
      });
      expect(downloadDefault).toBe(true);
      expect(matchedBack).toEqual({ piece: 1, notice: 1 });
      expect(claimStates).toEqual(
        [...CONTENT_LEAVING_NOTICE_OPEN_STATES].sort()
      );
      // Every kind × state but a cancelled `removed`, the second round, the
      // second owner and the second piece, the three tried forms, and the
      // seven accepted pairs.
      expect(kept).toBe(
        CONTENT_LEAVING_NOTICE_KINDS.length *
          CONTENT_LEAVING_NOTICE_STATES.length -
          1 +
          1 +
          2 +
          3 +
          7
      );
    });
  }
);
