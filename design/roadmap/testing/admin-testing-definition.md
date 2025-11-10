# Admin Dashboard Testing Definition

**Feature**: Admin Dashboard Backend (P1-ADMIN-001)
**Last Updated**: 2025-11-05

---

## Overview

This document defines the testing strategy for admin dashboard features, covering analytics, content management, and customer management.

**Key Testing Principles**:
- Test platform owner authorization
- Test SQL aggregations (revenue, counts)
- Test organization scoping on all queries
- Test manual access grants

---

## Test Categories

### 1. Platform Owner Middleware Tests

**Location**: `workers/auth/src/middleware/require-platform-owner.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePlatformOwner } from './require-platform-owner';
import { Context } from 'hono';

describe('requirePlatformOwner', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    mockNext = vi.fn();
    mockContext = {
      get: vi.fn(),
      json: vi.fn((data, status) => ({ data, status })),
      env: { ENVIRONMENT: 'test' },
    };
  });

  it('should allow platform owners', async () => {
    mockContext.get.mockReturnValue({
      id: 'user-123',
      isPlatformOwner: true,
    });

    const middleware = requirePlatformOwner();
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should deny non-platform-owners', async () => {
    mockContext.get.mockReturnValue({
      id: 'user-123',
      isPlatformOwner: false, // Not platform owner
    });

    const middleware = requirePlatformOwner();
    const result = await middleware(mockContext, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(result.status).toBe(403);
    expect(result.data.error.code).toBe('FORBIDDEN');
  });

  it('should deny unauthenticated users', async () => {
    mockContext.get.mockReturnValue(null); // No user context

    const middleware = requirePlatformOwner();
    const result = await middleware(mockContext, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });
});
```

---

### 2. Analytics Service Tests

**Location**: `packages/admin/src/analytics-service.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminAnalyticsService } from './analytics-service';

describe('AdminAnalyticsService', () => {
  let mockDb: any;
  let mockObs: any;
  let service: AdminAnalyticsService;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      })),
      execute: vi.fn(),
    };

    mockObs = {
      info: vi.fn(),
    };

    service = new AdminAnalyticsService({
      db: mockDb,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('getRevenueStats', () => {
    it('should calculate total revenue', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              totalRevenueCents: 9990, // $99.90
              totalPurchases: 10,
            },
          ]),
        })),
      });

      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      });

      const stats = await service.getRevenueStats({});

      expect(stats.totalRevenueCents).toBe(9990);
      expect(stats.totalPurchases).toBe(10);
      expect(stats.averageOrderValueCents).toBe(999); // 9990 / 10
    });

    it('should handle zero revenue', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              totalRevenueCents: 0,
              totalPurchases: 0,
            },
          ]),
        })),
      });

      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      });

      const stats = await service.getRevenueStats({});

      expect(stats.totalRevenueCents).toBe(0);
      expect(stats.averageOrderValueCents).toBe(0); // Avoid division by zero
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      await service.getRevenueStats({ startDate, endDate });

      // Verify date filters applied
      expect(mockObs.info).toHaveBeenCalledWith(
        'Getting revenue stats',
        expect.objectContaining({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        })
      );
    });
  });

  describe('getCustomerStats', () => {
    it('should count customers correctly', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ count: 100 }]),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ count: 50 }]),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ count: 10 }]),
          })),
        });

      const stats = await service.getCustomerStats();

      expect(stats.totalCustomers).toBe(100);
      expect(stats.totalPurchasingCustomers).toBe(50);
      expect(stats.newCustomersLast30Days).toBe(10);
    });
  });

  describe('getTopContent', () => {
    it('should return top content by revenue', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue([
                    {
                      contentId: 'content-1',
                      title: 'Video 1',
                      totalRevenueCents: 5000,
                      totalPurchases: 5,
                    },
                    {
                      contentId: 'content-2',
                      title: 'Video 2',
                      totalRevenueCents: 3000,
                      totalPurchases: 3,
                    },
                  ]),
                })),
              })),
            })),
          })),
        })),
      });

      const topContent = await service.getTopContent(10);

      expect(topContent).toHaveLength(2);
      expect(topContent[0].totalRevenueCents).toBe(5000);
      expect(topContent[1].totalRevenueCents).toBe(3000);
    });
  });
});
```

---

### 3. Customer Management Service Tests

**Location**: `packages/admin/src/customer-management-service.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminCustomerManagementService } from './customer-management-service';

describe('AdminCustomerManagementService', () => {
  let mockDb: any;
  let mockObs: any;
  let service: AdminCustomerManagementService;

  beforeEach(() => {
    mockDb = {
      query: {
        users: {
          findFirst: vi.fn(),
        },
        content: {
          findFirst: vi.fn(),
        },
        contentPurchases: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    offset: vi.fn().mockResolvedValue([]),
                  })),
                })),
              })),
            })),
          })),
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    };

    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    service = new AdminCustomerManagementService({
      db: mockDb,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('grantContentAccess', () => {
    it('should create manual purchase grant', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-123',
        organizationId: 'org-123',
      });

      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue(null); // No existing purchase

      await service.grantContentAccess('user-123', 'content-123');

      expect(mockDb.insert).toHaveBeenCalled();

      // Verify purchase details
      const insertCall = mockDb.insert.mock.calls[0];
      const valuesCall = insertCall[0]().values.mock.calls[0];
      const purchase = valuesCall[0];

      expect(purchase.customerId).toBe('user-123');
      expect(purchase.contentId).toBe('content-123');
      expect(purchase.priceCents).toBe(0); // Manual grant = free
      expect(purchase.status).toBe('completed');
      expect(purchase.stripeCheckoutSessionId).toBeNull();
      expect(purchase.stripePaymentIntentId).toBeNull();
    });

    it('should reject if customer not found', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      await expect(
        service.grantContentAccess('missing-user', 'content-123')
      ).rejects.toThrow('CUSTOMER_NOT_FOUND');
    });

    it('should reject if content not found', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-123',
        organizationId: 'org-123',
      });

      mockDb.query.content.findFirst.mockResolvedValue(null);

      await expect(
        service.grantContentAccess('user-123', 'missing-content')
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });

    it('should reject if purchase already exists', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-123',
        organizationId: 'org-123',
      });

      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue({
        id: 'existing-purchase',
      });

      await expect(
        service.grantContentAccess('user-123', 'content-123')
      ).rejects.toThrow('PURCHASE_ALREADY_EXISTS');
    });
  });

  describe('getCustomerDetails', () => {
    it('should return customer with purchase history', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        createdAt: new Date('2025-01-01'),
      });

      mockDb.query.contentPurchases.findMany.mockResolvedValue([
        {
          id: 'purchase-1',
          priceCents: 999,
          status: 'completed',
          createdAt: new Date('2025-01-15'),
          content: {
            title: 'Video 1',
          },
        },
        {
          id: 'purchase-2',
          priceCents: 1999,
          status: 'completed',
          createdAt: new Date('2025-01-20'),
          content: {
            title: 'Video 2',
          },
        },
      ]);

      const details = await service.getCustomerDetails('user-123');

      expect(details.customer.name).toBe('John Doe');
      expect(details.purchases).toHaveLength(2);
      expect(details.stats.totalPurchases).toBe(2);
      expect(details.stats.totalSpentCents).toBe(2998); // 999 + 1999
    });

    it('should exclude pending purchases from stats', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        createdAt: new Date('2025-01-01'),
      });

      mockDb.query.contentPurchases.findMany.mockResolvedValue([
        {
          id: 'purchase-1',
          priceCents: 999,
          status: 'completed',
          createdAt: new Date('2025-01-15'),
          content: { title: 'Video 1' },
        },
        {
          id: 'purchase-2',
          priceCents: 1999,
          status: 'pending', // Not completed
          createdAt: new Date('2025-01-20'),
          content: { title: 'Video 2' },
        },
      ]);

      const details = await service.getCustomerDetails('user-123');

      expect(details.purchases).toHaveLength(2); // Both shown
      expect(details.stats.totalPurchases).toBe(1); // Only completed
      expect(details.stats.totalSpentCents).toBe(999); // Only completed
    });
  });
});
```

---

### 4. API Integration Tests

**Location**: `workers/auth/src/routes/admin.integration.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import app from '../index';

describe('Admin API Integration', () => {
  describe('Authorization', () => {
    it('should return 403 for non-platform-owner', async () => {
      const request = new Request('http://localhost/api/admin/analytics/revenue', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer regular-user-token', // Not platform owner
        },
      });

      const env = { /* ... */ };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const request = new Request('http://localhost/api/admin/analytics/revenue', {
        method: 'GET',
        // No Authorization header
      });

      const env = { /* ... */ };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(401);
    });

    it('should allow platform owner access', async () => {
      const request = new Request('http://localhost/api/admin/analytics/revenue', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer platform-owner-token',
        },
      });

      const env = { /* ... */ };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/analytics/revenue', () => {
    it('should return revenue stats', async () => {
      const request = new Request('http://localhost/api/admin/analytics/revenue', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer platform-owner-token',
        },
      });

      const env = {
        DATABASE_URL: process.env.DATABASE_URL,
        ENVIRONMENT: 'test',
      };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.totalRevenueCents).toBeDefined();
      expect(body.totalPurchases).toBeDefined();
      expect(body.averageOrderValueCents).toBeDefined();
      expect(body.revenueByDay).toBeInstanceOf(Array);
    });
  });

  describe('POST /api/admin/customers/:customerId/grant-access/:contentId', () => {
    it('should grant manual access', async () => {
      const request = new Request(
        'http://localhost/api/admin/customers/user-123/grant-access/content-123',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer platform-owner-token',
          },
        }
      );

      const env = { /* ... */ };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 for missing customer', async () => {
      const request = new Request(
        'http://localhost/api/admin/customers/missing-123/grant-access/content-123',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer platform-owner-token',
          },
        }
      );

      const env = { /* ... */ };

      const response = await app.fetch(request, env);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });
  });
});
```

---

## Common Testing Patterns

### Pattern 1: Test Platform Owner Authorization

```typescript
it('should deny non-platform-owner', async () => {
  mockContext.get.mockReturnValue({
    id: 'user-123',
    isPlatformOwner: false,
  });

  const result = await requirePlatformOwner()(mockContext, mockNext);

  expect(result.status).toBe(403);
});
```

### Pattern 2: Test Organization Scoping

```typescript
it('should enforce organization scoping', async () => {
  await service.listCustomers({ page: 1, limit: 20 });

  // Verify organizationId filter was applied
  expect(mockDb.select).toHaveBeenCalled();
  // Check that where clause includes organizationId = 'org-123'
});
```

### Pattern 3: Test Manual Access Grant

```typescript
it('should create $0 purchase for manual grant', async () => {
  await service.grantContentAccess('user-123', 'content-123');

  const insertCall = mockDb.insert.mock.calls[0];
  const purchase = insertCall[0]().values.mock.calls[0][0];

  expect(purchase.priceCents).toBe(0); // Free
  expect(purchase.status).toBe('completed');
  expect(purchase.stripeCheckoutSessionId).toBeNull();
});
```

---

## Running Tests

```bash
# Run middleware tests
pnpm --filter auth-worker test

# Run admin service tests
pnpm --filter @codex/admin test

# Run API integration tests
DATABASE_URL=postgresql://... pnpm --filter auth-worker test:integration

# Run all admin tests
pnpm test --filter=admin
```

---

## Troubleshooting

**Problem**: Platform owner flag not set
**Solution**: Run migration to add `is_platform_owner` column and set for test user

**Problem**: Organization scoping not working
**Solution**: Ensure all DB queries include `eq(table.organizationId, organizationId)`

**Problem**: Manual access grant creates Stripe session
**Solution**: Verify priceCents = 0 and Stripe IDs are null

---

**Last Updated**: 2025-11-05
