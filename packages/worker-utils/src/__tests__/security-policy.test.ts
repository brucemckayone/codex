import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SECURITY_POLICY,
  mergePolicy,
  POLICY_PRESETS,
  withPolicy,
} from '../security-policy';

// Create a mock db instance using vi.hoisted so it's available in vi.mock factory
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      organizationMemberships: {
        findFirst: vi.fn(),
      },
      sessions: {
        findFirst: vi.fn(),
      },
    },
  },
}));

// Mock the database module for requireOrgManagement tests
vi.mock('@codex/database', () => ({
  mockDb: mockDb,
  createDbClient: vi.fn(() => mockDb),
  organizationMemberships: {
    organizationId: 'organizationId',
    userId: 'userId',
    status: 'status',
  },
}));

describe('Security Policy', () => {
  describe('DEFAULT_SECURITY_POLICY', () => {
    it('should require auth by default', () => {
      expect(DEFAULT_SECURITY_POLICY.auth).toBe('required');
    });

    it('should use api rate limit by default', () => {
      expect(DEFAULT_SECURITY_POLICY.rateLimit).toBe('api');
    });

    it('should not require org membership by default', () => {
      expect(DEFAULT_SECURITY_POLICY.requireOrgMembership).toBe(false);
    });

    it('should have empty roles by default', () => {
      expect(DEFAULT_SECURITY_POLICY.roles).toEqual([]);
    });
  });

  describe('mergePolicy', () => {
    it('should merge partial policy with defaults', () => {
      const policy = mergePolicy({ auth: 'none' });
      expect(policy.auth).toBe('none');
      expect(policy.rateLimit).toBe('api'); // default
    });

    it('should use all defaults when no policy provided', () => {
      const policy = mergePolicy();
      expect(policy).toEqual(DEFAULT_SECURITY_POLICY);
    });

    it('should override multiple defaults', () => {
      const policy = mergePolicy({
        auth: 'optional',
        rateLimit: 'auth',
        roles: ['admin'],
      });

      expect(policy.auth).toBe('optional');
      expect(policy.rateLimit).toBe('auth');
      expect(policy.roles).toEqual(['admin']);
    });
  });

  describe('POLICY_PRESETS', () => {
    it('should have public preset with no auth', () => {
      const policy = POLICY_PRESETS.public();
      expect(policy.auth).toBe('none');
      expect(policy.rateLimit).toBe('web');
    });

    it('should have authenticated preset', () => {
      const policy = POLICY_PRESETS.authenticated();
      expect(policy.auth).toBe('required');
      expect(policy.rateLimit).toBe('api');
    });

    it('should have creator preset with roles', () => {
      const policy = POLICY_PRESETS.creator();
      expect(policy.auth).toBe('required');
      expect(policy.roles).toEqual(['creator', 'admin']);
    });

    it('should have admin preset with strict rate limit', () => {
      const policy = POLICY_PRESETS.admin();
      expect(policy.auth).toBe('required');
      expect(policy.roles).toEqual(['admin']);
      expect(policy.rateLimit).toBe('auth'); // strict
    });

    it('should have internal preset for worker auth', () => {
      const policy = POLICY_PRESETS.internal();
      expect(policy.auth).toBe('worker');
      expect(policy.rateLimit).toBe('webhook');
    });

    it('should have sensitive preset', () => {
      const policy = POLICY_PRESETS.sensitive();
      expect(policy.auth).toBe('required');
      expect(policy.rateLimit).toBe('auth'); // strict
    });

    it('should have orgManagement preset with requireOrgManagement', () => {
      const policy = POLICY_PRESETS.orgManagement();
      expect(policy.auth).toBe('required');
      expect(policy.requireOrgManagement).toBe(true);
      expect(policy.rateLimit).toBe('api');
    });
  });

  describe('withPolicy middleware', () => {
    let app: Hono<HonoEnv>;

    beforeEach(() => {
      app = new Hono<HonoEnv>();
    });

    describe('auth: none', () => {
      it('should allow request without user', async () => {
        app.get('/', withPolicy({ auth: 'none' }), (c) => c.json({ ok: true }));

        const res = await app.request('/');
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true });
      });
    });

    describe('auth: optional', () => {
      it('should allow request without user', async () => {
        app.get('/', withPolicy({ auth: 'optional' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });

      it('should allow request with user', async () => {
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          await next();
        });

        app.get('/', withPolicy({ auth: 'optional' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });
    });

    describe('auth: required', () => {
      it('should reject request without user', async () => {
        app.get('/', withPolicy({ auth: 'required' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      });

      it('should allow request with user', async () => {
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          await next();
        });

        app.get('/', withPolicy({ auth: 'required' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });
    });

    describe('auth: worker', () => {
      it('should reject request without workerAuth flag', async () => {
        app.get('/', withPolicy({ auth: 'worker' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Worker authentication required',
          },
        });
      });

      it('should allow request with workerAuth flag', async () => {
        app.use('*', async (c, next) => {
          c.set('workerAuth', true);
          await next();
        });

        app.get('/', withPolicy({ auth: 'worker' }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });
    });

    describe('role-based access control', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          await next();
        });
      });

      it('should allow user with required role', async () => {
        app.get('/', withPolicy({ roles: ['user'] }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });

      it('should reject user without required role', async () => {
        app.get('/', withPolicy({ roles: ['admin'] }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
            required: ['admin'],
          },
        });
      });

      it('should allow user with any of the required roles', async () => {
        app.get('/', withPolicy({ roles: ['admin', 'user'] }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });

      it('should allow admin user', async () => {
        // Override user role to admin
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'admin-1',
            email: 'admin@example.com',
            name: 'Admin User',
            role: 'admin',
            emailVerified: true,
            createdAt: new Date(),
          });
          await next();
        });

        app.get('/', withPolicy({ roles: ['admin'] }), (c) =>
          c.json({ ok: true })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });
    });

    describe('IP whitelisting', () => {
      it('should allow request from whitelisted IP', async () => {
        app.get(
          '/',
          withPolicy({ allowedIPs: ['192.168.1.1'], auth: 'none' }),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/', {
          headers: {
            'CF-Connecting-IP': '192.168.1.1',
          },
        });

        expect(res.status).toBe(200);
      });

      it('should reject request from non-whitelisted IP', async () => {
        app.get(
          '/',
          withPolicy({ allowedIPs: ['192.168.1.1'], auth: 'none' }),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/', {
          headers: {
            'CF-Connecting-IP': '10.0.0.1',
          },
        });

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied: IP not whitelisted',
          },
        });
      });

      it('should check X-Real-IP if CF-Connecting-IP not present', async () => {
        app.get(
          '/',
          withPolicy({ allowedIPs: ['192.168.1.1'], auth: 'none' }),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/', {
          headers: {
            'X-Real-IP': '192.168.1.1',
          },
        });

        expect(res.status).toBe(200);
      });

      it('should check X-Forwarded-For if other headers not present', async () => {
        app.get(
          '/',
          withPolicy({ allowedIPs: ['192.168.1.1'], auth: 'none' }),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/', {
          headers: {
            'X-Forwarded-For': '192.168.1.1, 10.0.0.1',
          },
        });

        expect(res.status).toBe(200);
      });
    });

    describe('requireOrgManagement', () => {
      beforeEach(async () => {
        // Reset mock before each test
        vi.mocked(mockDb.query.organizationMemberships.findFirst).mockReset();

        // Set up authenticated user middleware
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          await next();
        });
      });

      it('should return 400 if organization ID not in route params', async () => {
        app.get(
          '/no-id-route',
          withPolicy({ requireOrgManagement: true }),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/no-id-route');
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'BAD_REQUEST',
            message:
              'Organization ID required but not found in route parameters',
          },
        });
      });

      it('should deny non-members (403)', async () => {
        // User has no membership record
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue(null);

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/organizations/org-123', {
          method: 'PATCH',
        });
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to manage this organization',
          },
        });
      });

      it('should deny member role (403)', async () => {
        // User is a member but not owner/admin
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue({ role: 'member' });

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/organizations/org-123', {
          method: 'PATCH',
        });
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to manage this organization',
          },
        });
      });

      it('should deny creator role (403)', async () => {
        // User is a creator but not owner/admin
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue({ role: 'creator' });

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/organizations/org-123', {
          method: 'PATCH',
        });
        expect(res.status).toBe(403);
      });

      it('should allow owner role (200)', async () => {
        // User is an owner
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue({ role: 'owner' });

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/organizations/org-123', {
          method: 'PATCH',
        });
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true });
      });

      it('should allow admin role (200)', async () => {
        // User is an admin
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue({ role: 'admin' });

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => c.json({ ok: true })
        );

        const res = await app.request('/organizations/org-123', {
          method: 'PATCH',
        });
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true });
      });

      it('should set organizationId in context after successful check', async () => {
        vi.mocked(
          mockDb.query.organizationMemberships.findFirst
        ).mockResolvedValue({ role: 'admin' });

        app.patch(
          '/organizations/:id',
          withPolicy(POLICY_PRESETS.orgManagement()),
          (c) => {
            const orgId = c.get('organizationId');
            return c.json({ organizationId: orgId });
          }
        );

        const res = await app.request('/organizations/org-789', {
          method: 'PATCH',
        });
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          organizationId: 'org-789',
        });
      });
    });
  });
});
