import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';
import { createRequestTrackingMiddleware } from '../middleware';

describe('Request Tracking Middleware', () => {
  let app: Hono<HonoEnv>;

  beforeEach(() => {
    app = new Hono<HonoEnv>();
    app.use('*', createRequestTrackingMiddleware());
  });

  it('should generate and set requestId', async () => {
    app.get('/', (c) => {
      const requestId = c.get('requestId');
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      return c.json({ requestId });
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
  });

  it('should use existing X-Request-ID header if provided', async () => {
    const existingId = 'custom-request-id-123';

    app.get('/', (c) => {
      const requestId = c.get('requestId');
      expect(requestId).toBe(existingId);
      return c.json({ requestId });
    });

    const res = await app.request('/', {
      headers: {
        'X-Request-ID': existingId,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ requestId: existingId });
  });

  it('should extract clientIP from CF-Connecting-IP header', async () => {
    app.get('/', (c) => {
      const clientIP = c.get('clientIP');
      expect(clientIP).toBe('192.168.1.1');
      return c.json({ clientIP });
    });

    const res = await app.request('/', {
      headers: {
        'CF-Connecting-IP': '192.168.1.1',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ clientIP: '192.168.1.1' });
  });

  it('should fallback to X-Real-IP if CF-Connecting-IP not present', async () => {
    app.get('/', (c) => {
      const clientIP = c.get('clientIP');
      expect(clientIP).toBe('10.0.0.1');
      return c.json({ clientIP });
    });

    const res = await app.request('/', {
      headers: {
        'X-Real-IP': '10.0.0.1',
      },
    });

    expect(res.status).toBe(200);
  });

  it('should fallback to X-Forwarded-For and take first IP', async () => {
    app.get('/', (c) => {
      const clientIP = c.get('clientIP');
      expect(clientIP).toBe('172.16.0.1');
      return c.json({ clientIP });
    });

    const res = await app.request('/', {
      headers: {
        'X-Forwarded-For': '172.16.0.1, 10.0.0.1, 192.168.1.1',
      },
    });

    expect(res.status).toBe(200);
  });

  it('should default to "unknown" if no IP headers present', async () => {
    app.get('/', (c) => {
      const clientIP = c.get('clientIP');
      expect(clientIP).toBe('unknown');
      return c.json({ clientIP });
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
  });

  it('should extract userAgent from User-Agent header', async () => {
    const userAgent = 'Mozilla/5.0 (Test Browser)';

    app.get('/', (c) => {
      const extractedUA = c.get('userAgent');
      expect(extractedUA).toBe(userAgent);
      return c.json({ userAgent: extractedUA });
    });

    const res = await app.request('/', {
      headers: {
        'User-Agent': userAgent,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ userAgent });
  });

  it('should default userAgent to "unknown" if not present', async () => {
    app.get('/', (c) => {
      const userAgent = c.get('userAgent');
      expect(userAgent).toBe('unknown');
      return c.json({ userAgent });
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
  });

  it('should set X-Request-ID response header', async () => {
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(200);

    const responseId = res.headers.get('X-Request-ID');
    expect(responseId).toBeDefined();
    expect(responseId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
  });

  it('should return same requestId in response header as set in context', async () => {
    let contextRequestId: string | undefined;

    app.get('/', (c) => {
      contextRequestId = c.get('requestId');
      return c.json({ ok: true });
    });

    const res = await app.request('/');
    const responseId = res.headers.get('X-Request-ID');

    expect(contextRequestId).toBe(responseId);
  });

  it('should set all tracking data in context', async () => {
    app.get('/', (c) => {
      const requestId = c.get('requestId');
      const clientIP = c.get('clientIP');
      const userAgent = c.get('userAgent');

      expect(requestId).toBeDefined();
      expect(clientIP).toBeDefined();
      expect(userAgent).toBeDefined();

      return c.json({ requestId, clientIP, userAgent });
    });

    const res = await app.request('/', {
      headers: {
        'CF-Connecting-IP': '192.168.1.100',
        'User-Agent': 'TestBot/1.0',
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(data.clientIP).toBe('192.168.1.100');
    expect(data.userAgent).toBe('TestBot/1.0');
  });

  it('should generate unique requestIds for different requests', async () => {
    const requestIds = new Set<string>();

    app.get('/', (c) => {
      const requestId = c.get('requestId');
      requestIds.add(requestId!);
      return c.json({ requestId });
    });

    // Make multiple requests
    await app.request('/');
    await app.request('/');
    await app.request('/');

    // All IDs should be unique
    expect(requestIds.size).toBe(3);
  });
});
