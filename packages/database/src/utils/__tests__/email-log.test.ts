/**
 * The email log's one rule (owner, 2026-11-09), against real rows: every
 * morning reader and auth's welcome check build on these two fragments.
 */

import { and, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { emailAuditLogs } from '../../schema/notifications';
import {
  EMAIL_IN_FLIGHT_MS,
  emailLogShowsSent,
  notATestSend,
  TEST_SEND_METADATA,
} from '../email-log';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

describe.skipIf(!HAS_DB)('the email log rule', () => {
  const tag = `emaillog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** The run's clock: a morning run's start. */
  const now = new Date('2026-11-10T08:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MINUTE = 60 * 1000;

  afterAll(async () => {
    const { dbHttp } = await import('../../index');
    await dbHttp
      .delete(emailAuditLogs)
      .where(like(emailAuditLogs.recipientEmail, `${tag}-%`));
  });

  /** One row per case, each its own recipient; the cases whose rows pass. */
  async function passing(
    rule: ReturnType<typeof emailLogShowsSent>,
    cases: Record<
      string,
      {
        status: 'pending' | 'success' | 'failed' | 'skipped';
        at: Date;
        metadata: string | null;
      }
    >
  ): Promise<string[]> {
    const { dbHttp } = await import('../../index');
    const run = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
    await dbHttp.insert(emailAuditLogs).values(
      Object.entries(cases).map(([name, c]) => ({
        templateName: 'fee-change-notice',
        recipientEmail: `${run}-${name}@example.test`,
        status: c.status,
        metadata: c.metadata,
        createdAt: c.at,
        updatedAt: c.at,
      }))
    );
    const rows = await dbHttp
      .select({ to: emailAuditLogs.recipientEmail })
      .from(emailAuditLogs)
      .where(and(like(emailAuditLogs.recipientEmail, `${run}-%`), rule));
    return rows
      .map((r) => r.to.slice(run.length + 1, -'@example.test'.length))
      .sort();
  }

  const data = JSON.stringify({ feeNoticeId: 'n-1' });

  it('shows sent: success, and pending only while it may still be in flight', async () => {
    expect(
      await passing(emailLogShowsSent(now), {
        success: {
          status: 'success',
          at: ago(3 * 60 * MINUTE),
          metadata: data,
        },
        inFlight: { status: 'pending', at: ago(2 * MINUTE), metadata: data },
        // Made after the run started, by a run beside it.
        sinceStart: {
          status: 'pending',
          at: new Date(now.getTime() + 3 * MINUTE),
          metadata: data,
        },
        // An earlier run's: its invocation has ended, the outcome never came.
        leftBehind: {
          status: 'pending',
          at: ago(EMAIL_IN_FLIGHT_MS + MINUTE),
          metadata: data,
        },
        yesterday: {
          status: 'pending',
          at: ago(24 * 60 * MINUTE),
          metadata: data,
        },
        failed: { status: 'failed', at: ago(2 * MINUTE), metadata: data },
        skipped: { status: 'skipped', at: ago(2 * MINUTE), metadata: data },
      })
    ).toEqual(['inFlight', 'sinceStart', 'success']);
  });

  it('never shows a test send sent, in the text its writer stores', async () => {
    const marker = JSON.stringify(TEST_SEND_METADATA);
    expect(marker).toBe('{"testSend":true}');
    expect(
      await passing(emailLogShowsSent(now), {
        testSend: { status: 'success', at: ago(MINUTE), metadata: marker },
        // A marker beside a reader's keys still marks it.
        testSendWithKeys: {
          status: 'success',
          at: ago(MINUTE),
          metadata: JSON.stringify({
            ...TEST_SEND_METADATA,
            feeNoticeId: 'n-1',
          }),
        },
        real: { status: 'success', at: ago(MINUTE), metadata: data },
      })
    ).toEqual(['real']);
  });

  it('a test send is told apart by its marker alone: an opt-out of one still is one; a value naming it, or no metadata, is not', async () => {
    expect(
      await passing(notATestSend(), {
        // The send path's opt-out row keeps the marker first, then its keys.
        optedOutTestSend: {
          status: 'skipped',
          at: ago(MINUTE),
          metadata: JSON.stringify({
            ...TEST_SEND_METADATA,
            skipReason: 'opted_out',
            category: 'marketing',
          }),
        },
        // JSON escapes the quotes inside a value, so it can't read as the key.
        valueNamingIt: {
          status: 'success',
          at: ago(MINUTE),
          metadata: JSON.stringify({ note: '"testSend":true' }),
        },
        noMetadata: { status: 'success', at: ago(MINUTE), metadata: null },
      })
    ).toEqual(['noMetadata', 'valueNamingIt']);
  });

  it('the window is the cron wall, under the hour between price-moves runs', () => {
    expect(EMAIL_IN_FLIGHT_MS).toBe(15 * MINUTE);
    expect(EMAIL_IN_FLIGHT_MS).toBeLessThan(60 * MINUTE);
  });
});
