import { z } from 'zod';
import { uuidSchema } from '../primitives';
/**
 * Validation schemas for content access endpoints
 *
 * Design priciples
 *  - Pure validation (no DB dependency)
 *  - Clear error messages for API response
 *  - Sensible defaults (1 hour expiry, pagination
 *  - Bounds checking
 */

export const getStreamUrlSchema = z.object({
  contentId: uuidSchema,
  expirySeconds: z
    .number()
    .int('Expiry must be an integer')
    .min(300, 'Minimum expiry is 5 minutes (300 seconds)')
    .max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
    .optional()
    .default(3600), // 1 hour default
});

export const savePlayBackProgressSchema = z.object({
  contentId: uuidSchema,
  positionSeconds: z
    .number()
    .int('Position must be an integer')
    .min(0, 'Position cannot be negative'),
  durationSeconds: z
    .number()
    .int('Duration must be an integer')
    .min(1, 'Duration must be at least 1 second'),
  completed: z.boolean().optional().default(false),
});

export const getPlayBackProgressSchema = z.object({
  contentId: uuidSchema,
});

export const listUserLibrarySchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  filter: z.enum(['all', 'in-progress', 'completed']).optional().default('all'),
  sortBy: z.enum(['recent', 'title', 'duration']).optional().default('recent'),
});
