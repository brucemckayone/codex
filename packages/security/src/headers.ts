import type { Context, Next } from 'hono';

export interface SecurityHeadersOptions {
  /**
   * Environment (production, preview, development)
   * HSTS is only enabled in production
   */
  environment?: string;

  /**
   * Custom CSP directives (merged with defaults)
   */
  csp?: Partial<CSPDirectives>;

  /**
   * Disable X-Frame-Options (defaults to DENY)
   */
  disableFrameOptions?: boolean;
}

export interface CSPDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  frameSrc: string[];
  frameAncestors: string[];
  baseUri: string[];
  formAction: string[];
}

const DEFAULT_CSP: CSPDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline often needed for component libraries
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Merge CSP directives
 */
function mergeCSP(
  base: CSPDirectives,
  custom?: Partial<CSPDirectives>
): CSPDirectives {
  if (!custom) return base;

  return {
    defaultSrc: custom.defaultSrc ?? base.defaultSrc,
    scriptSrc: custom.scriptSrc ?? base.scriptSrc,
    styleSrc: custom.styleSrc ?? base.styleSrc,
    imgSrc: custom.imgSrc ?? base.imgSrc,
    fontSrc: custom.fontSrc ?? base.fontSrc,
    connectSrc: custom.connectSrc ?? base.connectSrc,
    frameSrc: custom.frameSrc ?? base.frameSrc,
    frameAncestors: custom.frameAncestors ?? base.frameAncestors,
    baseUri: custom.baseUri ?? base.baseUri,
    formAction: custom.formAction ?? base.formAction,
  };
}

/**
 * Convert CSP directives object to header string
 */
function buildCSPHeader(directives: CSPDirectives): string {
  return [
    `default-src ${directives.defaultSrc.join(' ')}`,
    `script-src ${directives.scriptSrc.join(' ')}`,
    `style-src ${directives.styleSrc.join(' ')}`,
    `img-src ${directives.imgSrc.join(' ')}`,
    `font-src ${directives.fontSrc.join(' ')}`,
    `connect-src ${directives.connectSrc.join(' ')}`,
    `frame-src ${directives.frameSrc.join(' ')}`,
    `frame-ancestors ${directives.frameAncestors.join(' ')}`,
    `base-uri ${directives.baseUri.join(' ')}`,
    `form-action ${directives.formAction.join(' ')}`,
  ].join('; ');
}

/**
 * Hono middleware to add security headers
 *
 * @example
 * ```ts
 * import { securityHeaders } from '@codex/security';
 *
 * app.use('*', securityHeaders({
 *   environment: c.env.ENVIRONMENT,
 *   csp: {
 *     scriptSrc: ["'self'", "https://js.stripe.com"],
 *     frameSrc: ["https://js.stripe.com"]
 *   }
 * }));
 * ```
 */
export function securityHeaders(options: SecurityHeadersOptions = {}) {
  const cspDirectives = mergeCSP(DEFAULT_CSP, options.csp);
  const cspHeader = buildCSPHeader(cspDirectives);

  return async (c: Context, next: Next) => {
    await next();

    // Content Security Policy
    c.header('Content-Security-Policy', cspHeader);

    // Prevent clickjacking
    if (!options.disableFrameOptions) {
      c.header('X-Frame-Options', 'DENY');
    }

    // Prevent MIME sniffing
    c.header('X-Content-Type-Options', 'nosniff');

    // Referrer policy
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy (disable unnecessary browser features)
    c.header(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=()'
    );

    // HSTS - only in production (avoid issues in dev/preview)
    if (options.environment === 'production') {
      c.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }

    return undefined;
  };
}

/**
 * Preset CSP configurations for common scenarios
 */
export const CSP_PRESETS = {
  /**
   * Stripe integration (Stripe.js + Elements)
   */
  stripe: {
    scriptSrc: ["'self'", 'https://js.stripe.com'],
    frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
    connectSrc: ["'self'", 'https://api.stripe.com'],
  } satisfies Partial<CSPDirectives>,

  /**
   * API worker (no frontend, restrictive)
   */
  api: {
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
  } satisfies Partial<CSPDirectives>,
};
