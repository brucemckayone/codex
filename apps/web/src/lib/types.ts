/**
 * Shared type definitions for the web app
 */

/**
 * User data returned from auth session
 * Matches the structure from Auth Worker's /api/auth/session endpoint
 */
export interface UserData {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session data returned from auth validation
 */
export interface SessionData {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Organization data for org context
 */
export interface OrganizationData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}
