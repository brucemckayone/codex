/**
 * Worker base URLs configuration
 * Can be overridden via environment variables for CI
 */
export const WORKER_URLS = {
  auth: process.env.AUTH_URL || 'http://localhost:42069',
  content: process.env.CONTENT_URL || 'http://localhost:4001',
  identity: process.env.IDENTITY_URL || 'http://localhost:42071',
  ecom: process.env.ECOM_URL || 'http://localhost:42072',
  admin: process.env.ADMIN_URL || 'http://localhost:42073',
} as const;
