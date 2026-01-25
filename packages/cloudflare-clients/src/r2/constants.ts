/**
 * Internal constants for R2 client
 */

export const R2_REGIONS = {
  AUTO: 'auto',
} as const;

export const RETRYABLE_STATUS_CODES = [429, 500, 501, 502, 503, 504];
