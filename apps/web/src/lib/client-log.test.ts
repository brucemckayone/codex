/**
 * The browser's log sink (Codex-l2c48.7): what it sends, what it drops, and
 * that it never throws inside the logger that called it.
 */
import type { LogEvent } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_LOG_MAX_BYTES,
  CLIENT_LOG_PER_HOUR,
  CLIENT_LOG_PER_MINUTE,
  CLIENT_LOG_REPEAT_MS,
  clientLogEntrySchema,
  createClientLogSink,
  describeThrown,
} from './client-log';

function sink(start = 1_800_000_000_000) {
  let now = start;
  const sent: string[] = [];
  const s = createClientLogSink({
    send: (body) => sent.push(body),
    now: () => now,
    path: () => '/studio/media',
  });
  return {
    forward: (event: Partial<LogEvent> & { message: string }) =>
      s.forward({ level: 'error', timestamp: new Date(now), ...event }),
    advance: (ms: number) => {
      now += ms;
    },
    sent,
    parsed: () =>
      sent.map((body) => clientLogEntrySchema.parse(JSON.parse(body))),
  };
}

describe('createClientLogSink', () => {
  it('sends warnings and errors as records the route accepts', () => {
    const s = sink();
    s.forward({
      level: 'warn',
      message: 'media_status.polling',
      metadata: { failures: 5 },
    });
    s.forward({ level: 'error', message: 'Media upload failed' });
    expect(s.parsed()).toEqual([
      {
        level: 'warn',
        message: 'media_status.polling',
        at: 1_800_000_000_000,
        path: '/studio/media',
        dropped: 0,
        metadata: { failures: 5 },
      },
      expect.objectContaining({
        level: 'error',
        message: 'Media upload failed',
      }),
    ]);
  });

  it('keeps info and debug in the browser', () => {
    const s = sink();
    s.forward({ level: 'info', message: 'a' });
    s.forward({ level: 'debug', message: 'b' });
    expect(s.sent).toEqual([]);
  });

  it('redacts metadata before it leaves the browser', () => {
    const s = sink();
    s.forward({
      message: 'sign-in failed',
      metadata: {
        password: 'hunter2',
        token: 'tok_live_abc',
        email: 'a@b.test',
        step: 'submit',
      },
    });
    const body = s.sent[0] ?? '';
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('tok_live_abc');
    expect(body).not.toContain('a@b.test');
    expect(s.parsed()[0]?.metadata?.step).toBe('submit');
  });

  it('sends a message once per 5 minutes, then again', () => {
    const s = sink();
    s.forward({ message: 'same' });
    s.advance(CLIENT_LOG_REPEAT_MS - 1);
    s.forward({ message: 'same' });
    expect(s.sent).toHaveLength(1);
    s.advance(1);
    s.forward({ message: 'same' });
    expect(s.parsed().map((e) => e.dropped)).toEqual([0, 1]);
  });

  it('sends at most 10 a minute, and says how many it dropped', () => {
    const s = sink();
    for (let i = 0; i < CLIENT_LOG_PER_MINUTE + 3; i++)
      s.forward({ message: `m${i}` });
    expect(s.sent).toHaveLength(CLIENT_LOG_PER_MINUTE);
    s.advance(60_000);
    s.forward({ message: 'after' });
    expect(s.parsed().at(-1)).toMatchObject({ message: 'after', dropped: 3 });
  });

  it('sends at most 100 an hour, then again with the count it dropped', () => {
    const s = sink();
    // 6 a minute: under the per-minute limit, so only the hour's budget bites.
    for (let i = 0; i < CLIENT_LOG_PER_HOUR + 5; i++) {
      s.forward({ message: `m${i}` });
      s.advance(10_000);
    }
    expect(s.sent).toHaveLength(CLIENT_LOG_PER_HOUR);
    s.advance(60 * 60_000);
    s.forward({ message: 'next hour' });
    expect(s.parsed().at(-1)).toMatchObject({
      message: 'next hour',
      dropped: 5,
    });
  });

  it('tells apart different errors logged under one message', () => {
    const s = sink();
    const thrown = (error: string) => ({
      message: 'client.unhandled_error',
      metadata: { name: 'TypeError', error, route: '/studio/media' },
    });
    s.forward(thrown('a is undefined'));
    s.forward(thrown('b is not a function'));
    s.forward(thrown('a is undefined'));
    expect(s.parsed().map((e) => e.metadata?.error)).toEqual([
      'a is undefined',
      'b is not a function',
    ]);
  });

  it('counts a record it could not send in the next one', () => {
    const s = sink();
    s.forward({ message: 'bigint', metadata: { size: 10n } });
    s.forward({ message: 'after' });
    expect(s.parsed()).toEqual([
      expect.objectContaining({ message: 'after', dropped: 1 }),
    ]);
  });

  it('describes an Error in metadata instead of sending it empty', () => {
    const s = sink();
    s.forward({
      message: 'with error',
      metadata: { cause: new RangeError('out') },
    });
    expect(s.parsed()[0]?.metadata?.cause).toMatchObject({
      name: 'RangeError',
      error: 'out',
    });
  });

  it('cuts oversized metadata down to a preview the route still accepts', () => {
    const s = sink();
    // Real frames: a 32-character run would be redacted whole as a secret.
    const frames =
      '    at render (/_app/immutable/chunks/Bk3xJk2l.js:1:2048)\n'.repeat(
        1_000
      );
    s.forward({ message: 'big', metadata: { stack: frames } });
    const body = s.sent[0] ?? '';
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
      CLIENT_LOG_MAX_BYTES
    );
    expect(s.parsed()[0]?.metadata).toMatchObject({ truncated: true });
  });

  it('counts bytes, not characters: non-ASCII metadata still fits', () => {
    const s = sink();
    s.forward({
      message: 'emoji',
      metadata: { title: '🎬 Morning flow '.repeat(2_000) },
    });
    const body = s.sent[0] ?? '';
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
      CLIENT_LOG_MAX_BYTES
    );
    expect(s.parsed()[0]?.metadata).toMatchObject({ truncated: true });
  });

  it('never throws: not on metadata it cannot serialise, not when sending fails', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const failing = createClientLogSink({
      send: () => {
        throw new Error('offline');
      },
      now: () => 0,
      path: () => '/',
    });
    expect(() =>
      failing.forward({
        level: 'error',
        message: 'x',
        timestamp: new Date(),
        metadata: circular,
      })
    ).not.toThrow();
    expect(() =>
      failing.forward({ level: 'error', message: 'y', timestamp: new Date() })
    ).not.toThrow();
  });
});

describe('describeThrown', () => {
  it('keeps an Error’s name, message and stack, bounded', () => {
    const error = new TypeError('x'.repeat(1_000));
    const described = describeThrown(error);
    expect(described.name).toBe('TypeError');
    expect(String(described.error)).toHaveLength(300);
    expect(String(described.stack).length).toBeLessThanOrEqual(2_000);
  });

  it('reads a remote function’s HttpError', () => {
    expect(
      describeThrown({
        status: 429,
        body: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
      })
    ).toEqual({
      status: 429,
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('stringifies anything else', () => {
    expect(describeThrown('boom')).toEqual({ error: 'boom' });
    expect(describeThrown(undefined)).toEqual({ error: 'undefined' });
  });
});

describe('the default sink', () => {
  it('posts same-origin with keepalive', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { clientLogSink, CLIENT_LOG_ROUTE } = await import('./client-log');
    clientLogSink.forward({
      level: 'error',
      message: `unique-${Math.random()}`,
      timestamp: new Date(),
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      CLIENT_LOG_ROUTE,
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
      })
    );
    fetchSpy.mockRestore();
  });
});
