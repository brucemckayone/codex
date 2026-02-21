/**
 * Account Schemas
 *
 * Zod schemas for account-related forms and queries.
 * These schemas are imported by remote functions and tests.
 *
 * References:
 * - Remote functions: src/lib/remote/account.remote.ts
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Helper validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * URL protocol validator - only allows HTTP and HTTPS protocols
 *
 * This prevents dangerous protocols like javascript:, data:, or file: from being accepted.
 * Zod's url() validator accepts these by default, so we add an additional refinement.
 */
export const httpUrl = (url: string) => /^https?:\/\//.test(url);

/**
 * Optional URL field with HTTP/HTTPS protocol validation
 *
 * Combines:
 * 1. Optional (accepts undefined/empty)
 * 2. URL format validation via z.string().url()
 * 3. Protocol restriction to http/https only
 */
export const optionalHttpUrl = () =>
  z
    .string()
    .url('Invalid URL format')
    .refine(httpUrl, 'Only HTTP and HTTPS URLs are allowed')
    .optional();

// ─────────────────────────────────────────────────────────────────────────────
// Form schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profile update form schema
 *
 * Validates user profile information including:
 * - Display name (1-255 chars)
 * - Username (2-50 chars, lowercase alphanumeric with hyphens)
 * - Bio (max 500 chars)
 * - Social links (must be valid HTTP/HTTPS URLs)
 */
export const updateProfileFormSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(255)
    .optional(),
  username: z
    .string()
    .min(2, 'Username must be at least 2 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Username must be lowercase letters, numbers, and hyphens'
    )
    .optional(),
  bio: z.string().max(500).optional(),
  website: optionalHttpUrl(),
  twitter: optionalHttpUrl(),
  youtube: optionalHttpUrl(),
  instagram: optionalHttpUrl(),
});

/**
 * Notification preferences form schema
 *
 * Validates notification preference toggles:
 * - emailMarketing: Promotional and marketing emails
 * - emailTransactional: Transactional emails (receipts, notifications)
 * - emailDigest: Weekly digest emails
 */
export const updateNotificationsFormSchema = z.object({
  emailMarketing: z.boolean(),
  emailTransactional: z.boolean(),
  emailDigest: z.boolean(),
});

/**
 * Purchase history query schema
 *
 * Validates parameters for fetching user's purchase history:
 * - page: Page number (min 1, default 1)
 * - limit: Items per page (min 1, max 100, default 20)
 * - status: Optional filter by purchase status ('pending' | 'complete' | 'refunded' | 'failed')
 * - contentId: Optional filter by content UUID
 */
export const purchaseHistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  status: z.enum(['pending', 'complete', 'refunded', 'failed']).optional(),
  contentId: z.string().uuid().optional(),
});
