/**
 * Dispute Event Metadata Schemas
 *
 * Define Zod schemas for dispute-related event metadata here.
 * These schemas validate metadata on charge.dispute.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const DisputeMetadataSchema = z.object({
  // TODO: Define required fields for dispute metadata
  // Example:
  // disputeReason: z.string().max(200),
  // caseNumber: z.string().optional(),
});

export type DisputeMetadata = z.infer<typeof DisputeMetadataSchema>;
