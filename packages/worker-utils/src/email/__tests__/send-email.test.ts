import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before import
vi.mock('@codex/urls', () => ({
  buildServiceUrl: vi.fn().mockReturnValue('http://localhost:42075'),
}));

vi.mock('@codex/security', () => ({
  workerFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));

import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import { buildServiceUrl as getServiceUrl } from '@codex/urls';
import { sendEmailToWorker, sendEmailToWorkerAwaited } from '../send-email';

describe('sendEmailToWorker', () => {
  const mockEnv = {
    WORKER_SHARED_SECRET: 'test-secret',
  } as unknown as Bindings;

  const mockWaitUntil = vi.fn();

  /** The promise handed to executionCtx.waitUntil(). Asserted present,
   * because every test that reaches for it depends on the call having
   * been made. */
  function waitUntilPromise(): unknown {
    const [firstCall] = mockWaitUntil.mock.calls;
    expect(firstCall).toBeDefined();
    return firstCall![0];
  }
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
    const waitUntilArg = waitUntilPromise();
    expect(waitUntilArg).toBeInstanceOf(Promise);
  });

  it('sends correct request body as JSON', async () => {
    sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);

    // Wait for the promise inside waitUntil to resolve
    await waitUntilPromise();

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
    await waitUntilPromise();

    // If we get here without error, the catch worked
    expect(workerFetch).toHaveBeenCalled();
  });

  it('logs a refusal from notifications-api, by template and user only', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      sendEmailToWorker(mockEnv, mockExecutionCtx, {
        ...validParams,
        userId: 'user_abc123',
      });
      await waitUntilPromise();

      expect(errorSpy).toHaveBeenCalledWith('[sendEmailToWorker] refused', {
        templateName: validParams.templateName,
        userId: 'user_abc123',
        status: 404,
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        'user@example.com'
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs nothing for an accepted send', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);
      await waitUntilPromise();

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns void synchronously', () => {
    const result = sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);
    expect(result).toBeUndefined();
  });

  it('never logs the recipient address on transport failure (PII)', async () => {
    // console.* bypasses the ObservabilityClient redaction pipeline, so the
    // transport-failure log used to carry `to: params.to` — the recipient's
    // email address — into CF Workers logs on every failed send. It must
    // correlate by userId instead.
    vi.mocked(workerFetch).mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      sendEmailToWorker(mockEnv, mockExecutionCtx, {
        ...validParams,
        userId: 'user_abc123',
      });
      await waitUntilPromise();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify(errorSpy.mock.calls[0]);
      expect(payload).not.toContain('user@example.com');
      expect(payload).toContain('user_abc123');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    400, 500,
  ])('logs a %i from notifications-api with the status and template, never the address', async (status) => {
    // workerFetch resolves on any status, so a refused send used to vanish:
    // the catch only sees transport failures.
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response('{}', { status })
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      sendEmailToWorker(mockEnv, mockExecutionCtx, {
        ...validParams,
        userId: 'user_abc123',
      });
      await waitUntilPromise();

      expect(errorSpy).toHaveBeenCalledWith('[sendEmailToWorker] refused', {
        templateName: 'purchase-receipt',
        userId: 'user_abc123',
        status,
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        'user@example.com'
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs nothing for an accepted send', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      sendEmailToWorker(mockEnv, mockExecutionCtx, validParams);
      await waitUntilPromise();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// The price-change notice waits for notifications-api's answer before the
// price moves (owner decision D-P3, Codex-2hxff.43).
describe('sendEmailToWorkerAwaited', () => {
  const mockEnv = {
    WORKER_SHARED_SECRET: 'test-secret',
  } as unknown as Bindings;

  const params = {
    to: 'user@example.com',
    templateName: 'subscription-tier-price-change',
    category: 'transactional' as const,
    userId: 'user_abc123',
    data: { planName: 'Basic' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** notifications-api's answer, inside procedure()'s `{ data }` envelope. */
  function sent(data: unknown, status = 200) {
    return new Response(JSON.stringify({ data }), { status });
  }

  it('a 2xx saying success is accepted, and the send is signed to /internal/send with a timeout', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      sent({ success: true, messageId: 'msg_1' })
    );

    await expect(sendEmailToWorkerAwaited(mockEnv, params)).resolves.toEqual({
      accepted: true,
    });
    expect(workerFetch).toHaveBeenCalledWith(
      'http://localhost:42075/internal/send',
      {
        method: 'POST',
        body: JSON.stringify(params),
        signal: expect.any(AbortSignal),
      },
      'test-secret'
    );
  });

  // Review A, silent #9: a 2xx is accepted only when the body says it sent.
  // Review A, silent #1: the fan-out's last batch (started by 20 s) must
  // finish its notice and its Stripe write inside the 30 s waitUntil budget.
  it('waits at most 5 s by default', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(sent({ success: true }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await sendEmailToWorkerAwaited(mockEnv, params);
      expect(timeout).toHaveBeenCalledWith(5_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('a 2xx that skipped the send is not accepted, and says why', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      sent({ success: false, skipped: 'opted_out' })
    );

    await expect(sendEmailToWorkerAwaited(mockEnv, params)).resolves.toEqual({
      accepted: false,
      skipped: 'opted_out',
    });
  });

  it.each([
    ['an empty body', new Response('{}', { status: 200 })],
    ['a body that is not JSON', new Response('ok', { status: 200 })],
    ['success that is not true', sent({ success: 'yes' })],
  ])('a 2xx with %s is not accepted: its outcome is unknown', async (_label, response) => {
    vi.mocked(workerFetch).mockResolvedValueOnce(response);

    await expect(sendEmailToWorkerAwaited(mockEnv, params)).resolves.toEqual({
      accepted: false,
      error: '2xx without a send result',
    });
  });

  it.each([
    404, 422, 500,
  ])('a %i is refused, with its status', async (status) => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response('{}', { status })
    );

    await expect(sendEmailToWorkerAwaited(mockEnv, params)).resolves.toEqual({
      accepted: false,
      status,
    });
  });

  it('a transport failure is not accepted, and never throws', async () => {
    vi.mocked(workerFetch).mockRejectedValueOnce(new Error('Network timeout'));

    await expect(sendEmailToWorkerAwaited(mockEnv, params)).resolves.toEqual({
      accepted: false,
      error: 'Network timeout',
    });
  });

  it('a send with no answer within the timeout is not accepted', async () => {
    vi.mocked(workerFetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
        })
    );

    const result = await sendEmailToWorkerAwaited(mockEnv, params, {
      timeoutMs: 10,
    });

    expect(result).toMatchObject({
      accepted: false,
      error: expect.any(String),
    });
  });

  it('logs nothing itself: the caller reports the outcome, without the address', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response('{}', { status: 422 })
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await sendEmailToWorkerAwaited(mockEnv, params);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
