import { z } from 'zod';

import {
  createOptionalTextSchema,
  createSanitizedStringSchema,
  createSlugSchema,
  emailSchema,
  urlSchema,
} from '../primitives';

/**
 * Username validation schema
 * - Used for creator profile URLs (e.g., codex.platform/u/username)
 * - Must be slug-safe (lowercase alphanumeric + hyphens)
 * - Maximum 50 characters
 */
export const usernameSchema = createSlugSchema(50);

/**
 * Bio validation schema
 * - Optional user biography/bio for creator profile
 * - Maximum 500 characters
 */
export const bioSchema = createOptionalTextSchema(500, 'Bio');

/**
 * Social links validation schema
 * - Optional social media and website links for creator profile
 * - All URLs must be HTTP/HTTPS
 */
export const socialLinksSchema = z
  .object({
    website: urlSchema.optional(),
    twitter: urlSchema.optional(),
    youtube: urlSchema.optional(),
    instagram: urlSchema.optional(),
  })
  .optional();

export type SocialLinks = z.infer<typeof socialLinksSchema>;

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
 * - username: Unique username for creator profile URLs
 * - bio: User biography for creator profile
 * - socialLinks: Social media and website links
 */
export const updateProfileSchema = z.object({
  displayName: createSanitizedStringSchema(1, 255, 'Display name').optional(),
  email: emailSchema.optional(),
  username: usernameSchema.optional(),
  bio: bioSchema,
  socialLinks: socialLinksSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Notification preferences schema is exported from './schemas/notifications.ts
// to avoid duplicate exports
