/**
 * Health Check Enhancements Tests
 *
 * Tests the new optional database and KV connectivity checks
 * added to the health check endpoint.
 */

import { describe, expect, it } from 'vitest';
import { createWorker } from '../worker-factory';

describe('Health Check Enhancements', () => {
  describe('basic health check (backward compatibility)', () => {
    it('should work without any health check options', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        status: 'healthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
      });
      expect(data.checks).toBeUndefined();
    });
  });

  describe('database connectivity check', () => {
    it('should include database check when configured and healthy', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkDatabase: async () => ({ status: 'ok' }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        status: 'healthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
        checks: {
          database: 'ok',
        },
      });
    });

    it('should return 503 when database check fails', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkDatabase: async () => ({
            status: 'error',
            message: 'Connection refused',
          }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data).toEqual({
        status: 'unhealthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
        checks: {
          database: 'error: Connection refused',
        },
      });
    });

    it('should handle database check exceptions', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkDatabase: async () => {
            throw new Error('Database connection failed');
          },
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe('error');
    });
  });

  describe('KV connectivity check', () => {
    it('should include KV check when configured and healthy', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkKV: async () => ({ status: 'ok' }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        status: 'healthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
        checks: {
          kv: 'ok',
        },
      });
    });

    it('should return 503 when KV check fails', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkKV: async () => ({
            status: 'error',
            message: 'KV namespace not found',
          }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data).toEqual({
        status: 'unhealthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
        checks: {
          kv: 'error: KV namespace not found',
        },
      });
    });
  });

  describe('multiple checks', () => {
    it('should run both database and KV checks when configured', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkDatabase: async () => ({ status: 'ok' }),
          checkKV: async () => ({ status: 'ok' }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        status: 'healthy',
        service: 'test-service',
        version: '1.0.0',
        timestamp: expect.any(String),
        checks: {
          database: 'ok',
          kv: 'ok',
        },
      });
    });

    it('should return 503 if any check fails', async () => {
      const app = createWorker({
        serviceName: 'test-service',
        version: '1.0.0',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableGlobalAuth: false,
        healthCheck: {
          checkDatabase: async () => ({ status: 'ok' }),
          checkKV: async () => ({ status: 'error', message: 'KV error' }),
        },
      });

      const res = await app.request('/health');
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe('ok');
      expect(data.checks.kv).toBe('error: KV error');
    });
  });
});
