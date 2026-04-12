import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before import
vi.mock('@codex/constants', () => ({
  getServiceUrl: vi.fn().mockReturnValue('http://localhost:42075'),
}));

vi.mock('@codex/security', () => ({
  workerFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));

import { getServiceUrl } from '@codex/constants';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import { sendEmailToWorker } from '../send-email';

describe('sendEmailToWorker', () => {
  const mockEnv = {
    WORKER_SHARED_SECRET: 'test-secret',
  } as unknown as Bindings;

  const mockWaitUntil = vi.fn();
  const mockExecutionCtx = {
    waitUntil: mockWaitUntil,
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  const validParams = {
    to: 'user@example.com',
    templateName: 'purchase-receipt',
    category: 'transactional' as const,
    data: { userName: 'Alice', priceFormatted: '£9.99' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls workerFetch with correct notifications-api URL', () => {
    sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);

    expect(getServiceUrl).toHaveBeenCalledWith('notifications', mockEnv);
    // waitUntil receives a promise that calls workerFetch
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  it('wraps the fetch in executionCtx.waitUntil()', () => {
    sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);

    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    const waitUntilArg = mockWaitUntil.mock.calls[0][0];
    expect(waitUntilArg).toBeInstanceOf(Promise);
  });

  it('sends correct request body as JSON', async () => {
    sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);

    // Wait for the promise inside waitUntil to resolve
    await mockWaitUntil.mock.calls[0][0];

    expect(workerFetch).toHaveBeenCalledWith(
      'http://localhost:42075/internal/send',
      {
        method: 'POST',
        body: JSON.stringify(validParams),
      },
      'test-secret'
    );
  });

  it('silently catches network errors (does not throw)', async () => {
    vi.mocked(workerFetch).mockRejectedValueOnce(new Error('Network timeout'));

    // Should not throw
    sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);

    // Wait for the promise to settle (the .catch swallows the error)
    await mockWaitUntil.mock.calls[0][0];

    // If we get here without error, the catch worked
    expect(workerFetch).toHaveBeenCalled();
  });

  it('returns void synchronously', () => {
    const result = sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);
    expect(result).toBeUndefined();
  });
});
