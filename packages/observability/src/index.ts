/**
 * Observability Package
 *
 * Simple, cost-effective observability for Cloudflare Workers and SvelteKit
 * Designed to be extended with services like Axiom, Baselime, or custom solutions
 */

import { type RedactionOptions, redactSensitiveData } from './redact';

// ── ANSI color helpers (dev console only) ──────────────────────────
const LEVEL_COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
} as const;

const LEVEL_BADGES = {
  debug: '🔍 DEBUG',
  info: 'ℹ️  INFO ',
  warn: '⚠️  WARN ',
  error: '🔴 ERROR',
} as const;

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Format a log entry as a colorized, human-readable string for the dev console.
 * Only used when environment === 'development'.
 */
function formatDevLog(
  level: LogEvent['level'],
  message: string,
  service: string,
  timestamp: string,
  requestId?: string,
  metadata?: Record<string, unknown>
): string {
  const color = LEVEL_COLORS[level];
  const badge = LEVEL_BADGES[level];
  const time = new Date(timestamp).toLocaleTimeString('en-GB', {
    hour12: false,
  });

  let line = `${DIM}${time}${RESET} ${color}${badge}${RESET} ${BOLD}${message}${RESET} ${DIM}[${service}]${RESET}`;

  if (requestId) {
    line += ` ${DIM}req:${requestId}${RESET}`;
  }

  if (metadata && Object.keys(metadata).length > 0) {
    // Promote key request fields to the main line for quick scanning
    const inline: string[] = [];

    for (const k of [
      'method',
      'url',
      'status',
      'duration',
      'durationMs',
      'error',
    ] as const) {
      const v = (metadata as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (k === 'method' || k === 'status') {
        inline.push(`${color}${v}${RESET}`);
      } else if (k === 'url') {
        inline.push(`${v}`);
      } else if (k === 'duration' || k === 'durationMs') {
        inline.push(`${DIM}${v}ms${RESET}`);
      } else if (k === 'error') {
        inline.push(`${color}${v}${RESET}`);
      }
    }

    if (inline.length > 0) {
      line += ` ${inline.join(' ')}`;
    }

    // Show ALL metadata on the detail line — nothing is hidden
    const allPairs = Object.entries(metadata)
      .map(([k, v]) => {
        if (k === 'stack' && typeof v === 'string') {
          return `${DIM}stack=${RESET}\n    ${v.split('\n').slice(0, 3).join('\n    ')}`;
        }
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `${DIM}${k}=${RESET}${val}`;
      })
      .join(' ');
    line += `\n  ${allPairs}`;
  }

  return line;
}

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

    // Dev: colorized human-readable output. Prod/test: structured JSON for log aggregators.
    // The `environment` constructor parameter is the authoritative source — set from
    // wrangler ENVIRONMENT var (workers) or explicit config (BaseService, tests).
    const output =
      this.environment === 'development'
        ? formatDevLog(
            event.level,
            event.message,
            this.serviceName,
            logEntry.timestamp as string,
            this.requestId,
            safeMetadata as Record<string, unknown> | undefined
          )
        : JSON.stringify(logEntry);

    switch (event.level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
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
