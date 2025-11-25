/**
 * Subscription Event Metadata Schemas
 *
 * Define Zod schemas for subscription-related event metadata here.
 * These schemas validate metadata on customer.subscription.* and invoice.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const SubscriptionMetadataSchema = z.object({
  // TODO: Define required fields for subscription metadata
  // Example:
  // userId: z.string().uuid(),
  // planType: z.enum(['basic', 'premium', 'enterprise']),
});

export type SubscriptionMetadata = z.infer<typeof SubscriptionMetadataSchema>;
