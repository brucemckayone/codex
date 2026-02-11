import { z } from 'zod';

import { createSanitizedStringSchema } from '../primitives';

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
 */
export const updateProfileSchema = z.object({
  name: createSanitizedStringSchema(1, 255, 'Name').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Update notification preferences schema
 */
export const updateNotificationPreferencesSchema = z.object({
  emailMarketing: z.boolean().optional(),
  emailTransactional: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
});

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
