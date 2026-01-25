import { CSP_DIRECTIVES, ENV_NAMES } from '@codex/constants';
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
  readonly defaultSrc: readonly string[];
  readonly scriptSrc: readonly string[];
  readonly styleSrc: readonly string[];
  readonly imgSrc: readonly string[];
  readonly fontSrc: readonly string[];
  readonly connectSrc: readonly string[];
  readonly frameSrc: readonly string[];
  readonly frameAncestors: readonly string[];
  readonly baseUri: readonly string[];
  readonly formAction: readonly string[];
}

const DEFAULT_CSP: CSPDirectives = CSP_DIRECTIVES.DEFAULT;

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
    if (options.environment === ENV_NAMES.PRODUCTION) {
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
  stripe: CSP_DIRECTIVES.PRESETS.STRIPE satisfies Partial<CSPDirectives>,

  /**
   * API worker (no frontend, restrictive)
   */
  api: CSP_DIRECTIVES.PRESETS.API satisfies Partial<CSPDirectives>,
};
