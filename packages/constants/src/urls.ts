export const SERVICE_PORTS = {
  AUTH: 42069,
  CONTENT: 4001,
  ACCESS: 4001,
  ORGANIZATION: 42071,
  ECOMMERCE: 42072,
  ADMIN: 42073,
  IDENTITY: 42074,
  NOTIFICATIONS: 42075,
  MEDIA: 8788,
} as const;

export const DOMAINS = {
  PROD: 'revelations.studio',
  STAGING: 'staging.revelations.studio',
  LOCAL: 'localhost',
} as const;
