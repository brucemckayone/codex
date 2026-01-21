/**
 * PII and Sensitive Data Redaction
 *
 * Automatically redact sensitive information from logs to prevent credential leaks
 * and ensure privacy compliance (GDPR, etc.)
 */

import { SENSITIVE_KEYS, SENSITIVE_PATTERNS } from '@codex/constants';

/**
 * Patterns to detect sensitive data in values (even if key name is not sensitive)
 */
const SENSITIVE_VALUE_PATTERNS = [
  SENSITIVE_PATTERNS.STRIPE_SK_LIVE,
  SENSITIVE_PATTERNS.STRIPE_SK_TEST,
  SENSITIVE_PATTERNS.STRIPE_PK_LIVE,
  SENSITIVE_PATTERNS.STRIPE_PK_TEST,
  SENSITIVE_PATTERNS.STRIPE_RK_LIVE,
  SENSITIVE_PATTERNS.POSTGRES_URL,
  SENSITIVE_PATTERNS.MYSQL_URL,
  SENSITIVE_PATTERNS.BEARER_TOKEN,
  SENSITIVE_PATTERNS.RANDOM_SECRET,
];

/**
 * Email detection pattern
 */
const EMAIL_PATTERN = SENSITIVE_PATTERNS.EMAIL;

/**
 * Redaction modes
 */
export type RedactionMode = 'mask' | 'hash' | 'remove';

export interface RedactionOptions {
  /**
   * Redaction mode (default: 'mask')
   * - 'mask': Replace with '[REDACTED]'
   * - 'hash': Replace with SHA-256 hash (useful for correlation)
   * - 'remove': Remove the field entirely
   */
  mode?: RedactionMode;

  /**
   * Custom sensitive keys to redact (in addition to defaults)
   */
  customKeys?: string[];

  /**
   * Whether to redact email addresses (default: true in production)
   */
  redactEmails?: boolean;

  /**
   * Whether to redact IP addresses (default: false, often needed for rate limiting)
   */
  redactIPs?: boolean;

  /**
   * Keep first/last N characters of redacted values (for debugging)
   * e.g., keepChars: 4 -> 'sk_l...abc123' instead of '[REDACTED]'
   */
  keepChars?: number;
}

/**
 * Hash a value using SHA-256
 */
async function hashValue(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hashHex.substring(0, 16)}...`;
}

/**
 * Redact a single value based on mode
 */
function redactValue(
  value: string,
  mode: RedactionMode,
  keepChars?: number
): string {
  if (mode === 'mask') {
    if (keepChars && keepChars > 0 && value.length > keepChars * 2) {
      const start = value.substring(0, keepChars);
      const end = value.substring(value.length - keepChars);
      return `${start}...${end}`;
    }
    return '[REDACTED]';
  }

  // Hash mode handled asynchronously
  return '[REDACTED]';
}

/**
 * Check if a key should be redacted
 */
function isSensitiveKey(key: string, customKeys: string[] = []): boolean {
  const keyLower = key.toLowerCase();
  const allKeys = [...SENSITIVE_KEYS, ...customKeys];

  return allKeys.some((sensitiveKey) =>
    keyLower.includes(sensitiveKey.toLowerCase())
  );
}

/**
 * Check if a value matches sensitive patterns
 */
function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Synchronous redaction (uses 'mask' or 'remove' only)
 */
export function redactSensitiveData(
  data: unknown,
  options: RedactionOptions = {}
): unknown {
  const {
    mode = 'mask',
    customKeys = [],
    redactEmails = false,
    redactIPs: _redactIPs = false,
    keepChars,
  } = options;

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, options));
  }

  // Handle non-objects (primitives)
  if (typeof data !== 'object') {
    // Check if value itself is sensitive
    if (isSensitiveValue(data)) {
      return redactValue(String(data), mode, keepChars);
    }

    // Redact emails if enabled
    if (redactEmails && typeof data === 'string' && EMAIL_PATTERN.test(data)) {
      return redactValue(data, mode, keepChars);
    }

    return data;
  }

  // Handle objects
  const redacted: Record<string, unknown> =
    mode === 'remove' ? {} : { ...data };

  for (const [key, value] of Object.entries(data)) {
    // Check if key is sensitive
    if (isSensitiveKey(key, customKeys)) {
      if (mode === 'remove') {
      } else {
        redacted[key] = redactValue(String(value), mode, keepChars);
      }
    }
    // Check if value is sensitive (even if key isn't)
    else if (isSensitiveValue(value)) {
      redacted[key] = redactValue(String(value), mode, keepChars);
    }
    // Recursively redact nested objects
    else if (typeof value === 'object') {
      redacted[key] = redactSensitiveData(value, options);
    }
    // Redact emails in string values
    else if (
      redactEmails &&
      typeof value === 'string' &&
      EMAIL_PATTERN.test(value)
    ) {
      redacted[key] = value.replace(EMAIL_PATTERN, (email) =>
        redactValue(email, mode, keepChars)
      );
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Async redaction (supports 'hash' mode)
 */
export async function redactSensitiveDataAsync(
  data: unknown,
  options: RedactionOptions = {}
): Promise<unknown> {
  const {
    mode = 'mask',
    customKeys = [],
    redactEmails = false,
    redactIPs: _redactIPs = false,
    keepChars: _keepChars,
  } = options;

  // For non-hash modes, use sync version
  if (mode !== 'hash') {
    return redactSensitiveData(data, options);
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return Promise.all(
      data.map((item) => redactSensitiveDataAsync(item, options))
    );
  }

  // Handle non-objects
  if (typeof data !== 'object') {
    if (isSensitiveValue(data)) {
      return await hashValue(String(data));
    }
    if (redactEmails && typeof data === 'string' && EMAIL_PATTERN.test(data)) {
      return await hashValue(data);
    }
    return data;
  }

  // Handle objects
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key, customKeys)) {
      redacted[key] = await hashValue(String(value));
    } else if (isSensitiveValue(value)) {
      redacted[key] = await hashValue(String(value));
    } else if (typeof value === 'object') {
      redacted[key] = await redactSensitiveDataAsync(value, options);
    } else if (
      redactEmails &&
      typeof value === 'string' &&
      EMAIL_PATTERN.test(value)
    ) {
      // Replace emails with hashes
      const emails = value.match(new RegExp(EMAIL_PATTERN, 'g')) || [];
      let redactedValue = value;
      for (const email of emails) {
        const hash = await hashValue(email);
        redactedValue = redactedValue.replace(email, hash);
      }
      redacted[key] = redactedValue;
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Presets for common scenarios
 */
export const REDACTION_PRESETS = {
  /**
   * Production logging (strict redaction, keep emails for correlation)
   */
  production: {
    mode: 'hash' as RedactionMode,
    redactEmails: true,
    redactIPs: false,
  },

  /**
   * Development logging (mask secrets, keep emails visible)
   */
  development: {
    mode: 'mask' as RedactionMode,
    redactEmails: false,
    redactIPs: false,
    keepChars: 4,
  },

  /**
   * GDPR compliant (remove all PII)
   */
  gdpr: {
    mode: 'remove' as RedactionMode,
    redactEmails: true,
    redactIPs: true,
  },
};
