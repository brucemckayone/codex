import { describe, expect, it } from 'vitest';
import {
  adminContentPerformanceQuerySchema,
  adminDashboardStatsQuerySchema,
  adminFollowersQuerySchema,
  adminRevenueQuerySchema,
  adminSubscribersQuerySchema,
} from '../admin-schemas';

/**
 * Admin Analytics Schema Tests
 *
 * Covers the date-range + compare-range refinements applied via
 * applyDateRangeRefinements() to revenue, dashboard, subscribers, followers,
 * and content-performance queries.
 */

describe('adminRevenueQuerySchema', () => {
  it('accepts a fully-populated main + compare date range', () => {
    const result = adminRevenueQuerySchema.safeParse({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      compareFrom: '2025-12-01T00:00:00.000Z',
      compareTo: '2025-12-31T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.compareFrom).toBeInstanceOf(Date);
      expect(result.data.compareTo).toBeInstanceOf(Date);
    }
  });

  it('accepts an empty payload (all fields optional)', () => {
    const result = adminRevenueQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects a half-set compare range (compareFrom without compareTo)', () => {
    const result = adminRevenueQuerySchema.safeParse({
      compareFrom: '2025-12-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Both compareFrom and compareTo must be provided together, or neither'
      );
    }
  });

  it('rejects a half-set compare range (compareTo without compareFrom)', () => {
    const result = adminRevenueQuerySchema.safeParse({
      compareTo: '2025-12-31T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects compareFrom after compareTo', () => {
    const result = adminRevenueQuerySchema.safeParse({
      compareFrom: '2025-12-31T00:00:00.000Z',
      compareTo: '2025-12-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Compare-from must be before or equal to compare-to'
      );
    }
  });

  it('rejects a compare range exceeding 365 days', () => {
    const result = adminRevenueQuerySchema.safeParse({
      compareFrom: '2024-01-01T00:00:00.000Z',
      compareTo: '2025-06-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Compare range cannot exceed 365 days');
    }
  });

  it('still enforces the main range chronological rule', () => {
    const result = adminRevenueQuerySchema.safeParse({
      startDate: '2026-02-01T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('adminDashboardStatsQuerySchema', () => {
  it('accepts main + compare date range alongside a limit', () => {
    const result = adminDashboardStatsQuerySchema.safeParse({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      compareFrom: '2025-12-01T00:00:00.000Z',
      compareTo: '2025-12-31T00:00:00.000Z',
      limit: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('rejects a half-set compare range', () => {
    const result = adminDashboardStatsQuerySchema.safeParse({
      compareFrom: '2025-12-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('adminSubscribersQuerySchema', () => {
  it('accepts full main + compare date range', () => {
    const result = adminSubscribersQuerySchema.safeParse({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T00:00:00.000Z',
      compareFrom: '2025-12-01T00:00:00.000Z',
      compareTo: '2025-12-31T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });
});

describe('adminFollowersQuerySchema', () => {
  it('accepts an empty payload', () => {
    const result = adminFollowersQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('adminContentPerformanceQuerySchema', () => {
  it('accepts a minimal payload with just a limit', () => {
    const result = adminContentPerformanceQuerySchema.safeParse({ limit: 10 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it('defaults limit to 10 when omitted', () => {
    const result = adminContentPerformanceQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it('rejects limit above 100', () => {
    const result = adminContentPerformanceQuerySchema.safeParse({
      limit: 500,
    });

    expect(result.success).toBe(false);
  });
});
