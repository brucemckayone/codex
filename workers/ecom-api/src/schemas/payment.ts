/**
 * Payment Event Metadata Schemas
 *
 * Define Zod schemas for payment-related event metadata here.
 * These schemas validate metadata on payment_intent.* and charge.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const PaymentMetadataSchema = z.object({
  // TODO: Define required fields for payment metadata
  // Example:
  // orderId: z.string().uuid(),
  // customerId: z.string().uuid(),
  // orderType: z.enum(['booking', 'subscription', 'product']),
});

export type PaymentMetadata = z.infer<typeof PaymentMetadataSchema>;
