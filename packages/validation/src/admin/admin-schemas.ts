import { z } from 'zod';
import { contentStatusEnum } from '../content/content-schemas';
import { isoDateSchema, userIdSchema, uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Admin Dashboard Validation Schemas
 *
 * Schemas for platform owner admin operations:
 * - Analytics queries (revenue, customers, top content)
 * - Content management (list, publish, unpublish, delete)
 * - Customer management (list, details, grant access)
 *
 * Security: organizationId comes from authenticated user context, never from client input.
 */

// ============================================================================
// Analytics Schemas
// ============================================================================

/**
 * Maximum date range in days for analytics queries (prevents DoS via large data queries)
 */
const MAX_DATE_RANGE_DAYS = 365;

/**
 * Shared shape for analytics queries that support an optional main date range
 * and an optional comparison date range (for period-over-period comparisons).
 *
 * All four fields are independently optional at the field level; cross-field
 * rules (chronological order, max range size, both-or-neither for compare)
 * are enforced by {@link applyDateRangeRefinements}.
 */
type DateRangeFields = {
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
};

/**
 * Apply the five cross-field refinements shared by all date-range analytics
 * queries (revenue, dashboard, subscribers, followers, content performance):
 *
 *  1. `startDate <= endDate` when both provided.
 *  2. Main range size <= MAX_DATE_RANGE_DAYS.
 *  3. `compareFrom <= compareTo` when both provided.
 *  4. Compare range size <= MAX_DATE_RANGE_DAYS.
 *  5. Compare range is both-or-neither (half-set is a caller bug).
 *
 * Generic over the schema type so we can reuse on schemas that also carry
 * additional fields (e.g. `limit` on dashboard/content-performance).
 */
function applyDateRangeRefinements<T extends DateRangeFields>(
  schema: z.ZodType<T>
): z.ZodType<T> {
  return schema
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          return data.startDate <= data.endDate;
        }
        return true;
      },
      {
        message: 'Start date must be before or equal to end date',
        path: ['startDate'],
      }
    )
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          const diffMs = data.endDate.getTime() - data.startDate.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          return diffDays <= MAX_DATE_RANGE_DAYS;
        }
        return true;
      },
      {
        message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
        path: ['endDate'],
      }
    )
    .refine(
      (data) => {
        if (data.compareFrom && data.compareTo) {
          return data.compareFrom <= data.compareTo;
        }
        return true;
      },
      {
        message: 'Compare-from must be before or equal to compare-to',
        path: ['compareFrom'],
      }
    )
    .refine(
      (data) => {
        if (data.compareFrom && data.compareTo) {
          const diffMs = data.compareTo.getTime() - data.compareFrom.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          return diffDays <= MAX_DATE_RANGE_DAYS;
        }
        return true;
      },
      {
        message: `Compare range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
        path: ['compareTo'],
      }
    )
    .refine(
      (data) =>
        (data.compareFrom === undefined && data.compareTo === undefined) ||
        (data.compareFrom !== undefined && data.compareTo !== undefined),
      {
        message:
          'Both compareFrom and compareTo must be provided together, or neither',
        path: ['compareFrom'],
      }
    );
}

/**
 * Reusable `limit` field for analytics queries that cap result counts.
 * Matches the constraints used by `adminTopContentQuerySchema`.
 */
const analyticsLimitSchema = z.coerce
  .number()
  .int({ message: 'Limit must be a whole number' })
  .min(1, { message: 'Limit must be at least 1' })
  .max(100, { message: 'Limit must be 100 or less' })
  .default(10);

/**
 * Revenue analytics query parameters
 * Optional main date range plus optional compare date range for period-over-period.
 * Max range per window: 365 days (prevents DoS via large data queries).
 */
export const adminRevenueQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
  })
);

export type AdminRevenueQueryInput = z.infer<typeof adminRevenueQuerySchema>;

/**
 * Top content query parameters
 * Optional main date range plus optional compare date range for per-row
 * revenue-trend deltas, with a limit capping the result set.
 * Max range per window: 365 days (prevents DoS via large data queries).
 */
export const adminTopContentQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
    limit: analyticsLimitSchema,
  })
);

export type AdminTopContentQueryInput = z.infer<
  typeof adminTopContentQuerySchema
>;

/**
 * Dashboard stats query parameters
 * Combines revenue/compare date ranges with top content limit.
 */
export const adminDashboardStatsQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
    limit: analyticsLimitSchema,
  })
);

export type AdminDashboardStatsQueryInput = z.infer<
  typeof adminDashboardStatsQuerySchema
>;

/**
 * Subscriber analytics query parameters
 * Optional main date range plus optional compare date range.
 * Powers `getSubscriberStats` (period-over-period subscriber metrics).
 */
export const adminSubscribersQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
  })
);

export type AdminSubscribersQueryInput = z.infer<
  typeof adminSubscribersQuerySchema
>;

/**
 * Follower analytics query parameters
 * Optional main date range plus optional compare date range.
 * Powers `getFollowerStats` (period-over-period follower metrics).
 */
export const adminFollowersQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
  })
);

export type AdminFollowersQueryInput = z.infer<
  typeof adminFollowersQuerySchema
>;

/**
 * Content performance analytics query parameters
 * Optional main date range plus optional compare date range, with a limit
 * for the number of content items returned.
 * Powers `getContentPerformance` (per-content metrics over a window).
 */
export const adminContentPerformanceQuerySchema = applyDateRangeRefinements(
  z.object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
    limit: analyticsLimitSchema,
  })
);

export type AdminContentPerformanceQueryInput = z.infer<
  typeof adminContentPerformanceQuerySchema
>;

// ============================================================================
// Content Management Schemas
// ============================================================================

/**
 * Admin content status filter
 * Includes 'all' option to show content in any status
 */
export const adminContentStatusEnum = z.enum([
  'draft',
  'published',
  'archived',
  'all',
]);

export type AdminContentStatus = z.infer<typeof adminContentStatusEnum>;

/**
 * Admin content list query parameters
 * Extends pagination with optional status filter
 */
export const adminContentListQuerySchema = paginationSchema.extend({
  status: adminContentStatusEnum.optional().default('all'),
});

export type AdminContentListQueryInput = z.infer<
  typeof adminContentListQuerySchema
>;

/**
 * Content ID path parameter schema
 * Used for publish, unpublish, and delete operations
 */
export const adminContentIdParamsSchema = z.object({
  id: uuidSchema,
});

export type AdminContentIdParams = z.infer<typeof adminContentIdParamsSchema>;

// ============================================================================
// Customer Management Schemas
// ============================================================================

/**
 * Customer list query parameters
 * Extends standard pagination with search and content filter
 */
export const adminCustomerListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  contentId: uuidSchema.optional(),
  joinedWithin: z.coerce.number().int().positive().optional(),
  minSpendCents: z.coerce.number().int().nonnegative().optional(),
  maxSpendCents: z.coerce.number().int().positive().optional(),
});

export type AdminCustomerListQueryInput = z.infer<
  typeof adminCustomerListQuerySchema
>;

/**
 * Customer ID path parameter schema
 * Uses Better Auth user ID format (alphanumeric)
 */
export const adminCustomerIdParamsSchema = z.object({
  id: userIdSchema,
});

export type AdminCustomerIdParams = z.infer<typeof adminCustomerIdParamsSchema>;

/**
 * Grant content access path parameters
 * For POST /api/admin/customers/:customerId/grant-access/:contentId
 *
 * - customerId: Better Auth user ID (alphanumeric)
 * - contentId: UUID
 */
export const adminGrantAccessParamsSchema = z.object({
  customerId: userIdSchema,
  contentId: uuidSchema,
});

export type AdminGrantAccessParams = z.infer<
  typeof adminGrantAccessParamsSchema
>;

// ============================================================================
// Activity Feed Schemas
// ============================================================================

/**
 * Activity type enum for the activity feed
 * Represents the types of activities tracked across the platform
 */
export const activityTypeEnum = z.enum([
  'purchase',
  'content_published',
  'member_joined',
]);

/**
 * Admin activity feed query parameters
 * Extends pagination with optional activity type filter
 */
export const adminActivityQuerySchema = paginationSchema.extend({
  type: activityTypeEnum.optional(),
});

export type AdminActivityQueryInput = z.infer<typeof adminActivityQuerySchema>;

/**
 * Organization ID path parameter schema
 * Used for organization-scoped admin endpoints
 * Validates UUID format for organizationId
 */
export const adminOrganizationIdParamsSchema = z.object({
  orgId: uuidSchema,
});

export type AdminOrganizationIdParams = z.infer<
  typeof adminOrganizationIdParamsSchema
>;

/**
 * Organization activity feed query parameters
 * Combines organizationId path params with activity query params
 * For GET /api/admin/:orgId/activity endpoint
 */
export const adminOrganizationActivityQuerySchema = adminActivityQuerySchema;

export type AdminOrganizationActivityQueryInput = z.infer<
  typeof adminOrganizationActivityQuerySchema
>;

// ============================================================================
// Re-export Content Status Enum
// ============================================================================

/**
 * Re-export contentStatusEnum for service layer usage
 * Matches database CHECK constraint values
 */
export { contentStatusEnum };
