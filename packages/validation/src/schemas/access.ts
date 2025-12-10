import { z } from 'zod';
import {
  nonNegativeIntSchema,
  positiveIntSchema,
  uuidSchema,
} from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Validation schemas for content access endpoints
 *
 * Design principles:
 * - Pure validation (no DB dependency)
 * - Clear error messages for API responses
 * - Sensible defaults (1 hour expiry, page 1, limit 20)
 * - Bounds checking (expiry: 5 minutes to 2 hours, page max 1000)
 * - Imperative error message pattern: "Must be..."
 */

export const getStreamingUrlSchema = z.object({
  contentId: uuidSchema,
  expirySeconds: z
    .number()
    .int('Must be a whole number')
    .min(300, 'Must be at least 5 minutes (300 seconds)')
    .max(7200, 'Must be 2 hours or less (7200 seconds)')
    .optional()
    .default(3600), // 1 hour default
});

export const savePlaybackProgressSchema = z.object({
  contentId: uuidSchema,
  positionSeconds: nonNegativeIntSchema,
  durationSeconds: positiveIntSchema,
  completed: z.boolean().optional().default(false),
});

export const getPlaybackProgressSchema = z.object({
  contentId: uuidSchema,
});

export const listUserLibrarySchema = paginationSchema.extend({
  filter: z.enum(['all', 'in-progress', 'completed']).optional().default('all'),
  sortBy: z.enum(['recent', 'title', 'duration']).optional().default('recent'),
});

// Type exports
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
export type SavePlaybackProgressInput = z.infer<
  typeof savePlaybackProgressSchema
>;
export type GetPlaybackProgressInput = z.infer<
  typeof getPlaybackProgressSchema
>;
export type ListUserLibraryInput = z.infer<typeof listUserLibrarySchema>;
