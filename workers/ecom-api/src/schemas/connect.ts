/**
 * Connect Event Metadata Schemas
 *
 * Define Zod schemas for Stripe Connect event metadata here.
 * These schemas validate metadata on account.* and person.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const ConnectMetadataSchema = z.object({
  // TODO: Define required fields for connect metadata
  // Example:
  // providerId: z.string().uuid(),
  // onboardingStatus: z.enum(['pending', 'completed']),
});

export type ConnectMetadata = z.infer<typeof ConnectMetadataSchema>;
