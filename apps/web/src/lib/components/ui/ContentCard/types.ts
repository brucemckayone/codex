/**
 * ContentCard Types
 *
 * Shared types for the ContentCard component and its consumers.
 */

export interface LibraryProgress {
  positionSeconds?: number;
  durationSeconds?: number;
  completed?: boolean;
  percentComplete?: number;
}

export interface PriceInfo {
  amountCents: number;
  currency?: string;
}
