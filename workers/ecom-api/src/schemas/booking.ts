/**
 * Booking Event Metadata Schemas
 *
 * Define Zod schemas for booking-related event metadata here.
 * These schemas validate metadata on checkout.session.* events.
 */

import { z } from 'zod';

// Example schema - customize as needed
export const BookingMetadataSchema = z.object({
  // TODO: Define required fields for booking metadata
  // Example:
  // bookingId: z.string().uuid(),
  // sessionDate: z.string().datetime(),
  // duration: z.string().regex(/^\d+$/),
});

export type BookingMetadata = z.infer<typeof BookingMetadataSchema>;
