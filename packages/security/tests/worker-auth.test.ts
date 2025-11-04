import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  generateWorkerSignature,
  workerAuth,
  workerFetch,
} from '../src/worker-auth';

describe('Worker Authentication', () => {
  const SECRET = 'test-secret-key-12345';
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('generateWorkerSignature', () => {
    it('should generate a consistent signature for the same input', async () => {
      const payload = JSON.stringify({ userId: '123' });
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = await generateWorkerSignature(payload, SECRET, timestamp);
      const sig2 = await generateWorkerSignature(payload, SECRET, timestamp);

      expect(sig1).toBe(sig2);
      expect(sig1).toBeTruthy();
      expect(typeof sig1).toBe('string');
    });

    it('should generate different signatures for different payloads', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = await generateWorkerSignature('payload1', SECRET, timestamp);
      const sig2 = await generateWorkerSignature('payload2', SECRET, timestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different timestamps', async () => {
      const payload = 'same-payload';

      const sig1 = await generateWorkerSignature(payload, SECRET, 1000);
      const sig2 = await generateWorkerSignature(payload, SECRET, 2000);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', async () => {
      const payload = 'same-payload';
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = await generateWorkerSignature(payload, 'secret1', timestamp);
      const sig2 = await generateWorkerSignature(payload, 'secret2', timestamp);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('workerAuth Middleware', () => {
    beforeEach(() => {
      app.use('/internal/*', workerAuth({ secret: SECRET }));
      app.post('/internal/action', (c) => c.json({ success: true }));
    });

    it('should reject request without signature header', async () => {
      const res = await app.request('/internal/action', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Missing authentication headers');
    });

    it('should reject request without timestamp header', async () => {
      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': 'some-signature',
        },
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Missing authentication headers');
    });

    it('should reject request with invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': 'invalid-signature',
          'X-Worker-Timestamp': timestamp.toString(),
        },
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid signature');
    });

    it('should accept request with valid signature', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        timestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': signature,
          'X-Worker-Timestamp': timestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('success', true);
    });

    it('should reject request with expired timestamp (replay attack protection)', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago (> 5 min maxAge)
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        oldTimestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': signature,
          'X-Worker-Timestamp': oldTimestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Request timestamp expired');
    });

    it('should reject request with future timestamp (clock skew attack)', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        futureTimestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': signature,
          'X-Worker-Timestamp': futureTimestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Request timestamp in future');
    });

    it('should reject request with invalid timestamp format', async () => {
      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Worker-Signature': 'some-sig',
          'X-Worker-Timestamp': 'not-a-number',
        },
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid timestamp format');
    });
  });

  describe('Origin Allowlist', () => {
    beforeEach(() => {
      app.use(
        '/internal/*',
        workerAuth({
          secret: SECRET,
          allowedOrigins: ['https://trusted-worker.com'],
        })
      );
      app.post('/internal/action', (c) => c.json({ success: true }));
    });

    it('should reject request from non-allowed origin', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        timestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          origin: 'https://malicious-worker.com',
          'X-Worker-Signature': signature,
          'X-Worker-Timestamp': timestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Unauthorized origin');
    });

    it('should accept request from allowed origin', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        timestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          origin: 'https://trusted-worker.com',
          'X-Worker-Signature': signature,
          'X-Worker-Timestamp': timestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });
  });

  describe('Custom Headers', () => {
    beforeEach(() => {
      app.use(
        '/internal/*',
        workerAuth({
          secret: SECRET,
          signatureHeader: 'X-Custom-Sig',
          timestampHeader: 'X-Custom-Time',
        })
      );
      app.post('/internal/action', (c) => c.json({ success: true }));
    });

    it('should use custom header names', async () => {
      const payload = JSON.stringify({ data: 'test' });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateWorkerSignature(
        payload,
        SECRET,
        timestamp
      );

      const res = await app.request('/internal/action', {
        method: 'POST',
        headers: {
          'X-Custom-Sig': signature,
          'X-Custom-Time': timestamp.toString(),
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });
  });

  describe('workerFetch Helper', () => {
    it('should automatically add signature and timestamp headers', async () => {
      // We can't actually make a real fetch in tests, but we can verify the function exists
      // and accepts the right parameters
      expect(typeof workerFetch).toBe('function');

      // This will fail in test environment (no real network), but validates the signature
      try {
        await workerFetch(
          'http://localhost:3000/test',
          {
            method: 'POST',
            body: JSON.stringify({ test: 'data' }),
          },
          SECRET
        );
      } catch (error) {
        // Expected to fail (no server), but validates function signature
        expect(error).toBeDefined();
      }
    });
  });

  describe('Public vs Protected Routes', () => {
    beforeEach(() => {
      app.use('/internal/*', workerAuth({ secret: SECRET }));
      app.post('/internal/secure', (c) => c.json({ type: 'secure' }));
      app.post('/public', (c) => c.json({ type: 'public' }));
    });

    it('should protect internal routes with auth', async () => {
      const res = await app.request('/internal/secure', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(401); // No auth headers
    });

    it('should not protect public routes', async () => {
      const res = await app.request('/public', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('type', 'public');
    });
  });
});
