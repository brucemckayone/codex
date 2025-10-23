/**
 * Shared Vitest configuration values for all packages
 * Import these values into package-specific configs
 *
 * Note: poolOptions must be configured at root level only
 */
export const sharedTestConfig = {
  globals: true,
  testTimeout: 10000,
  hookTimeout: 10000,
} as const;
