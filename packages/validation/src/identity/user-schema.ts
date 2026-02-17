import { z } from 'zod';

import { createSanitizedStringSchema, emailSchema } from '../primitives';

/**
 * User validation schema
 */
export const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required'),
  age: z.number().min(0, 'Age must be positive').optional(),
  role: z.enum(['user', 'admin']).default('user'),
});

export type User = z.infer<typeof userSchema>;

/**
 * Login credentials schema
 */
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginCredentials = z.infer<typeof loginSchema>;

/**
 * Update profile schema
 * Allows partial updates to user profile fields
 *
 * - displayName: User's display name (maps to users.name column)
 * - email: User's email address (requires re-verification when changed)
 */
export const updateProfileSchema = z.object({
  displayName: createSanitizedStringSchema(1, 255, 'Display name').optional(),
  email: emailSchema.optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Notification preferences schema is exported from './schemas/notifications.ts
// to avoid duplicate exports
