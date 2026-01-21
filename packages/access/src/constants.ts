/**
 * Internal constants for the access package
 */

export const SERVICE_NAME = 'content-access-service';

export const LOG_EVENTS = {
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS_ATTEMPT',
  ACCESS_CONTROL: 'access_control',
} as const;

export const LOG_SEVERITY = {
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
