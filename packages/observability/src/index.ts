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
      mode: environment === 'production' ? 'mask' : 'mask',
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
