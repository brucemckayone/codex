/**
 * Observability Package
 *
 * Simple, cost-effective observability for Cloudflare Workers and SvelteKit
 * Designed to be extended with services like Axiom, Baselime, or custom solutions
 */

import { type RedactionOptions, redactSensitiveData } from './redact';

export interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface RequestMetrics {
  url: string;
  method: string;
  duration: number;
  status?: number;
  userAgent?: string;
}

export interface ErrorContext {
  stack?: string;
  url?: string;
  method?: string;
  userAgent?: string;
  [key: string]: unknown;
}

/**
 * Observability Client
 *
 * Provides logging, metrics, and error tracking for the Codex platform.
 * Currently logs to console; can be extended to send to external services.
 */
export class ObservabilityClient {
  private environment: string;
  private serviceName: string;
  private requestId?: string;
  private redactionOptions: RedactionOptions;

  constructor(
    serviceName: string,
    environment: string = 'development',
    redactionOptions?: RedactionOptions
  ) {
    this.serviceName = serviceName;
    this.environment = environment;

    // Default redaction based on environment
    this.redactionOptions = redactionOptions ?? {
      mode: environment === 'production' ? 'hash' : 'mask',
      redactEmails: environment === 'production',
      keepChars: environment === 'production' ? undefined : 4,
    };
  }

  /**
   * Set the request ID for correlation across log entries
   */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  /**
   * Log a generic event
   */
  log(event: LogEvent): void {
    // Redact sensitive data from metadata
    const safeMetadata = event.metadata
      ? redactSensitiveData(event.metadata, this.redactionOptions)
      : undefined;

    const logEntry = {
      ...event,
      metadata: safeMetadata,
      service: this.serviceName,
      environment: this.environment,
      timestamp: event.timestamp.toISOString(),
      ...(this.requestId && { requestId: this.requestId }),
    };

    // Current implementation: console logging
    // TODO: Add integration with external logging service
    switch (event.level) {
      case 'debug':
        console.debug(JSON.stringify(logEntry));
        break;
      case 'info':
        console.info(JSON.stringify(logEntry));
        break;
      case 'warn':
        console.warn(JSON.stringify(logEntry));
        break;
      case 'error':
        console.error(JSON.stringify(logEntry));
        break;
    }
  }

  /**
   * Track HTTP request metrics
   */
  trackRequest(metrics: RequestMetrics): void {
    this.log({
      level: 'info',
      message: 'Request processed',
      timestamp: new Date(),
      metadata: {
        ...metrics,
        service: this.serviceName,
      },
    });
  }

  /**
   * Track errors with context
   */
  trackError(error: Error, context?: ErrorContext): void {
    this.log({
      level: 'error',
      message: error.message,
      timestamp: new Date(),
      metadata: {
        name: error.name,
        stack: error.stack,
        ...context,
      },
    });
  }

  /**
   * Info-level logging
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log({
      level: 'info',
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Warning-level logging
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log({
      level: 'warn',
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Error-level logging
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this.log({
      level: 'error',
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Debug-level logging (only in development)
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    if (this.environment === 'development') {
      this.log({
        level: 'debug',
        message,
        timestamp: new Date(),
        metadata,
      });
    }
  }

  /**
   * Track performance timing.
   *
   * Logs at 'warn' level when durationMs exceeds threshold (signals a
   * problem worth investigating in any environment). Logs at 'debug'
   * level otherwise (dev-only visibility for routine timings).
   *
   * @param label  - Human-readable operation name, e.g. "session-validation"
   * @param durationMs - Measured duration in milliseconds
   * @param options.threshold - Warn threshold in ms (default 2000)
   * @param options.metadata - Extra context to attach to the log entry
   */
  perf(
    label: string,
    durationMs: number,
    options?: { threshold?: number; metadata?: Record<string, unknown> }
  ): void {
    const threshold = options?.threshold ?? 2000;
    const rounded = Math.round(durationMs);
    const level = durationMs > threshold ? 'warn' : 'debug';

    // debug() already gates on environment, but we call log() directly
    // so both levels flow through the same structured output path.
    if (level === 'debug' && this.environment !== 'development') return;

    this.log({
      level,
      message: `perf: ${label}`,
      timestamp: new Date(),
      metadata: { durationMs: rounded, threshold, ...options?.metadata },
    });
  }

  /**
   * Start a performance timer.
   *
   * Returns an object whose `end()` method logs the elapsed time via
   * `perf()` and returns the duration in milliseconds.
   *
   * @example
   * ```ts
   * const timer = logger.startTimer('org-layout', { threshold: 3000 });
   * const org = await api.org.getPublicInfo(slug);
   * const ms = timer.end({ slug });
   * ```
   */
  startTimer(
    label: string,
    options?: { threshold?: number }
  ): { end: (metadata?: Record<string, unknown>) => number } {
    const start = performance.now();
    return {
      end: (metadata?: Record<string, unknown>) => {
        const durationMs = performance.now() - start;
        this.perf(label, durationMs, {
          threshold: options?.threshold,
          metadata,
        });
        return durationMs;
      },
    };
  }
}

/**
 * Request timing middleware helper
 *
 * Usage in Hono:
 * ```typescript
 * app.use('*', async (c, next) => {
 *   const timer = createRequestTimer(obs, c.req);
 *   await next();
 *   timer.end(c.res.status);
 * });
 * ```
 */
export function createRequestTimer(
  obs: ObservabilityClient,
  request: {
    url: string;
    method: string;
    headers?: { get: (key: string) => string | null };
  }
) {
  const start = Date.now();

  return {
    end: (status?: number) => {
      const duration = Date.now() - start;
      obs.trackRequest({
        url: request.url,
        method: request.method,
        duration,
        status,
        userAgent: request.headers?.get('user-agent') ?? undefined,
      });
    },
  };
}

/**
 * Error handling middleware helper
 *
 * Usage in Hono:
 * ```typescript
 * app.onError((err, c) => {
 *   obs.trackError(err, { url: c.req.url, method: c.req.method });
 *   return c.text('Error', 500);
 * });
 * ```
 */
export function trackRequestError(
  obs: ObservabilityClient,
  error: Error,
  request: { url: string; method: string }
): void {
  obs.trackError(error, {
    url: request.url,
    method: request.method,
  });
}

// Re-export redaction utilities
export {
  REDACTION_PRESETS,
  type RedactionMode,
  type RedactionOptions,
  redactSensitiveData,
  redactSensitiveDataAsync,
} from './redact';
