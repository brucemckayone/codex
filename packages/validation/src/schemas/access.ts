import { z } from 'zod';
import {
  nonNegativeIntSchema,
  positiveIntSchema,
  uuidSchema,
} from '../primitives';

/**
 * Validation schemas for content access endpoints
 *
 * Design principles:
 * - Pure validation (no DB dependency)
 * - Clear error messages for API responses
 * - Sensible defaults (1 hour expiry, page 1, limit 20)
 * - Bounds checking (expiry: 5 minutes to 24 hours)
 */

export const getStreamingUrlSchema = z.object({
  contentId: uuidSchema,
  expirySeconds: z
    .number()
    .int('Expiry must be an integer')
    .min(300, 'Minimum expiry is 5 minutes (300 seconds)')
    .max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
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

export const listUserLibrarySchema = z.object({
  page: positiveIntSchema.optional().default(1),
  limit: positiveIntSchema.max(100).optional().default(20),
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
