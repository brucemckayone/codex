/**
 * Web app-specific type definitions
 *
 * NOTE: Most API types (UserData, SessionData, ProgressData, CheckoutResponse)
 * are imported from @codex/shared-types for consistency across the platform.
 * Only web-app-specific types should be defined here.
 */

// Re-export commonly used types for convenience
export type {
  CheckoutResponse,
  ProgressData,
  SessionData,
  UserData,
} from '@codex/shared-types';

import type { Content, MediaItem, Organization } from '@codex/database/schema';

export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
  organization?: Organization | null;
  mediaItem?: MediaItem | null;
}

export interface MediaItemWithRelations extends MediaItem {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Shared layout types used across Header, Footer, and Sidebar components.
 * Single source of truth — imported by all layout components.
 */
export interface LayoutUser {
  name: string;
  email: string;
  image?: string;
}

export interface LayoutOrganization {
  name: string;
  slug: string;
  logoUrl?: string;
}

/**
 * Organization data for org context (web app extended version)
 * Includes UI-specific fields not present in backend Organization type
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
