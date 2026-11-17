/**
 * `wasWelcomeEmailSent` against the real email log (final review, fin-own's
 * finding): a creator may test-send their own `welcome` template to anyone's
 * address, and that row must not stand for the person's real welcome email.
 * Its status rule (any status counts) is left as it was: changing it is not
 * decided.
 */

import { env } from 'cloudflare:test';
import {
  createDbClient,
  inArray,
  schema,
  TEST_SEND_METADATA,
} from '@codex/database';
import { afterAll, describe, expect, it } from 'vitest';
import { wasWelcomeEmailSent } from '../email';

const db = createDbClient(
  env as unknown as Parameters<typeof createDbClient>[0]
);
const tag = `welcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const logIds: string[] = [];

async function logged(
  recipientEmail: string,
  status: 'success' | 'failed',
  metadata: string
): Promise<void> {
  const [row] = await db
    .insert(schema.emailAuditLogs)
    .values({ templateName: 'welcome', recipientEmail, status, metadata })
    .returning({ id: schema.emailAuditLogs.id });
  if (row) logIds.push(row.id);
}

describe('wasWelcomeEmailSent, on the real email log', () => {
  afterAll(async () => {
    if (logIds.length > 0) {
      await db
        .delete(schema.emailAuditLogs)
        .where(inArray(schema.emailAuditLogs.id, logIds));
    }
  });

  it('a test send of the welcome template to their address does not count', async () => {
    const to = `${tag}-tested@example.test`;
    // The text the send path stores for a test send.
    await logged(to, 'success', JSON.stringify(TEST_SEND_METADATA));

    expect(await wasWelcomeEmailSent(db, to)).toBe(false);
  });

  it('their real welcome email still counts, beside a test send', async () => {
    const to = `${tag}-welcomed@example.test`;
    await logged(to, 'success', JSON.stringify(TEST_SEND_METADATA));
    await logged(
      to,
      'success',
      JSON.stringify({ userName: 'Ada', loginUrl: '/login', exploreUrl: '' })
    );

    expect(await wasWelcomeEmailSent(db, to)).toBe(true);
  });

  it('any status of a real one still counts, failed included: that rule is unchanged', async () => {
    const to = `${tag}-failed@example.test`;
    await logged(
      to,
      'failed',
      JSON.stringify({ userName: 'Bo', loginUrl: '/login', exploreUrl: '' })
    );

    expect(await wasWelcomeEmailSent(db, to)).toBe(true);
  });
});
