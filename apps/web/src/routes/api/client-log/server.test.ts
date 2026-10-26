/**
 * POST /api/client-log (Codex-l2c48.7): an anonymous endpoint that writes to
 * the logs, so each refusal is a way to abuse it.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger }));

import { CLIENT_LOG_MAX_BYTES } from '$lib/client-log';
import { POST } from './+server';

const ORIGIN = 'https://acme.revelations.studio';

const record = {
  level: 'error',
  message: 'Media upload failed',
  at: 1_800_000_000_000,
  path: '/studio/media',
  dropped: 2,
  metadata: { mediaId: 'm1' },
};

function call(init: {
  body?: BodyInit | null;
  origin?: string | null;
  headers?: Record<string, string>;
}) {
  const headers = new Headers({
    'content-type': 'application/json',
    ...init.headers,
  });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  const request = new Request(`${ORIGIN}/api/client-log`, {
    method: 'POST',
    headers,
    body: init.body === undefined ? JSON.stringify(record) : init.body,
    // A ReadableStream body needs it in Node's fetch.
    ...(init.body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
  return POST({
    request,
    url: new URL(request.url),
    locals: { userId: 'user_1' },
  } as unknown as RequestEvent);
}

beforeEach(() => {
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe('POST /api/client-log', () => {
  it('writes the record under one fixed message, and answers 204', async () => {
    const res = await call({ headers: { 'user-agent': 'Safari' } });
    expect(res.status).toBe(204);
    expect(logger.error).toHaveBeenCalledWith('client.log', {
      clientMessage: 'Media upload failed',
      clientAt: new Date(record.at).toISOString(),
      path: '/studio/media',
      dropped: 2,
      userId: 'user_1',
      userAgent: 'Safari',
      client: { mediaId: 'm1' },
    });
  });

  it('logs a warning at warn', async () => {
    await call({ body: JSON.stringify({ ...record, level: 'warn' }) });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    null,
    'https://evil.example',
  ])('refuses the origin %j', async (origin) => {
    expect((await call({ origin })).status).toBe(403);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('refuses a body its Content-Length says is too large, unread', async () => {
    const res = await call({
      headers: { 'content-length': String(CLIENT_LOG_MAX_BYTES + 1) },
    });
    expect(res.status).toBe(413);
  });

  it('refuses a chunked body once it passes the cap', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(4_096));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 10) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await call({ body });
    expect(res.status).toBe(413);
    // It stopped reading rather than buffering all 40 KB.
    expect(sent).toBeLessThan(10);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an unknown level', JSON.stringify({ ...record, level: 'info' })],
    ['no message', JSON.stringify({ ...record, message: '' })],
    ['a date no Date can hold', JSON.stringify({ ...record, at: 9e15 })],
    ['a list', JSON.stringify([record])],
  ])('refuses %s', async (_case, body) => {
    expect((await call({ body })).status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it('says it refused, once a minute, with how many it refused since', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Far past any refusal an earlier test logged.
      vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));
      await call({ origin: 'https://preview.example' });
      expect(logger.warn).toHaveBeenLastCalledWith(
        'client.log_refused',
        expect.objectContaining({
          reason: 'origin',
          origin: 'https://preview.example',
        })
      );

      logger.warn.mockReset();
      vi.setSystemTime(new Date('2100-01-01T00:00:01Z'));
      await call({ body: JSON.stringify({ ...record, level: 'info' }) });
      await call({ body: JSON.stringify({ ...record, level: 'info' }) });
      expect(logger.warn).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2100-01-01T00:01:01Z'));
      await call({ body: JSON.stringify({ ...record, level: 'info' }) });
      expect(logger.warn).toHaveBeenCalledWith('client.log_refused', {
        reason: 'schema',
        field: 'level',
        refused: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
