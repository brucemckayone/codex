/**
 * Customer Event Metadata Schemas
 *
 * Define Zod schemas for customer-related event metadata here.
 * These schemas validate metadata on customer.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const CustomerMetadataSchema = z.object({
  // TODO: Define required fields for customer metadata
  // Example:
  // userId: z.string().uuid(),
  // accountType: z.enum(['client', 'provider', 'admin']),
});

export type CustomerMetadata = z.infer<typeof CustomerMetadataSchema>;
