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
 * Revenue analytics query parameters
 * Optional date range for filtering revenue data
 */
export const adminRevenueQuerySchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
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
  );

export type AdminRevenueQueryInput = z.infer<typeof adminRevenueQuerySchema>;

// ============================================================================
// Analytics Schemas
// ============================================================================

/**
 * Top content query parameters
 * Limit the number of top content items returned
 */
export const adminTopContentQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int({ message: 'Limit must be a whole number' })
    .min(1, { message: 'Limit must be at least 1' })
    .max(100, { message: 'Limit must be 100 or less' })
    .default(10),
});

export type AdminTopContentQueryInput = z.infer<
  typeof adminTopContentQuerySchema
>;

// ============================================================================
// Content Management Schemas
// ============================================================================

/**
 * Admin content status filter
 * Includes 'all' option to show content in any status
 */
export const adminContentStatusEnum = z.enum(
  ['draft', 'published', 'archived', 'all'],
  {
    errorMap: () => ({
      message: 'Status must be draft, published, archived, or all',
    }),
  }
);

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
 * Uses standard pagination
 */
export const adminCustomerListQuerySchema = paginationSchema;

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
// Re-export Content Status Enum
// ============================================================================

/**
 * Re-export contentStatusEnum for service layer usage
 * Matches database CHECK constraint values
 */
export { contentStatusEnum };
