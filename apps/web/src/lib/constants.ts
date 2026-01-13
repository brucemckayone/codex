/**
 * Auth routes that can be accessed from any domain
 */
export const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
]);

/**
 * Default worker URLs for local development
 */
export const DEFAULT_AUTH_URL = 'http://localhost:42069';
