/**
 * Vitest setup file for @codex/platform-settings
 *
 * Polyfills browser globals needed by isomorphic-dompurify (imported via @codex/validation)
 */

// Polyfill 'self' for isomorphic-dompurify
if (typeof self === 'undefined') {
  // @ts-expect-error
  global.self = global;
}
