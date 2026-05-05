/**
 * Unit tests for the welcome-email plumbing in workers/auth/src/email.ts.
 *
 * Two surfaces are covered:
 *  1. sendWelcomeEmail — fires sendEmailToWorker with the right template/data.
 *  2. wasWelcomeEmailSent — dedupe predicate against emailAuditLogs.
 *
 * Pattern follows packages/worker-utils/src/email/__tests__/send-email.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codex/worker-utils', () => ({
  sendEmailToWorker: vi.fn(),
}));

import type { Database } from '@codex/database';
import { sendEmailToWorker } from '@codex/worker-utils';
import { sendWelcomeEmail, wasWelcomeEmailSent } from '../email';
import type { AuthBindings } from '../types';

const mockEnv = {
  WORKER_SHARED_SECRET: 'test-secret',
  WEB_APP_URL: 'https://example.com',
} as unknown as AuthBindings;

const mockExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

describe('sendWelcomeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sendEmailToWorker with the welcome template and transactional category', () => {
    sendWelcomeEmail(mockEnv, mockExecutionCtx, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
    expect(sendEmailToWorker).toHaveBeenCalledWith(mockEnv, mockExecutionCtx, {
      to: 'alice@example.com',
      toName: 'Alice',
      templateName: 'welcome',
      category: 'transactional',
      data: {
        userName: 'Alice',
        loginUrl: 'https://example.com/login',
        exploreUrl: 'https://example.com',
      },
    });
  });

  it("falls back to userName='there' when name is null", () => {
    sendWelcomeEmail(mockEnv, mockExecutionCtx, {
      name: null,
      email: 'no-name@example.com',
    });

    const call = vi.mocked(sendEmailToWorker).mock.calls[0];
    expect(call?.[2]?.data).toMatchObject({ userName: 'there' });
    expect(call?.[2]?.toName).toBeUndefined();
  });

  it('handles empty WEB_APP_URL by passing empty exploreUrl', () => {
    const envNoUrl = { WORKER_SHARED_SECRET: 's' } as unknown as AuthBindings;

    sendWelcomeEmail(envNoUrl, mockExecutionCtx, {
      name: 'Bob',
      email: 'bob@example.com',
    });

    const call = vi.mocked(sendEmailToWorker).mock.calls[0];
    expect(call?.[2]?.data).toMatchObject({
      loginUrl: '/login',
      exploreUrl: '',
    });
  });

  it('returns void (synchronous)', () => {
    const result = sendWelcomeEmail(mockEnv, mockExecutionCtx, {
      name: 'C',
      email: 'c@example.com',
    });
    expect(result).toBeUndefined();
  });
});

describe('wasWelcomeEmailSent', () => {
  function makeDb(rows: Array<{ id: string }>): Database {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    return { select } as unknown as Database;
  }

  it('returns false when no prior welcome audit log exists', async () => {
    const db = makeDb([]);
    const result = await wasWelcomeEmailSent(db, 'new-user@example.com');
    expect(result).toBe(false);
  });

  it('returns true when a prior welcome audit log row exists', async () => {
    const db = makeDb([{ id: 'audit-row-1' }]);
    const result = await wasWelcomeEmailSent(db, 'returning@example.com');
    expect(result).toBe(true);
  });

  it('propagates DB errors so the caller can decide (caller catches in afterEmailVerification)', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('connection refused'));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    await expect(wasWelcomeEmailSent(db, 'x@example.com')).rejects.toThrow(
      'connection refused'
    );
  });
});
