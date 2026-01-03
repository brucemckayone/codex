/**
 * Vitest setup file for @codex/validation
 *
 * Polyfills browser globals needed by isomorphic-dompurify in Node.js test environment
 */

// Polyfill 'self' for isomorphic-dompurify (expects browser/Worker globals)
if (typeof self === 'undefined') {
  // @ts-expect-error
  global.self = global;
}
