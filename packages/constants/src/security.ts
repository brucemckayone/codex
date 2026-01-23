/**
 * Security domain constants
 */

import { COOKIES } from './cookies';

export const CSP_DIRECTIVES = {
  DEFAULT: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
  PRESETS: {
    STRIPE: {
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
    },
    API: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      fontSrc: ["'none'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
} as const;

export const AUTH_COOKIES = {
  SESSION: COOKIES.SESSION_NAME,
  BETTER_AUTH: 'better-auth.session_token',
} as const;

export const AUTH_ROLES = {
  USER: 'customer',
  CREATOR: 'creator',
  ADMIN: 'admin',
  SYSTEM: 'system',
  PLATFORM_OWNER: 'platform_owner',
} as const;

export const BRAND_COLORS = {
  DEFAULT_BLUE: '#3B82F6',
} as const;
