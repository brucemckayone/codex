/**
 * E2E Vitest Setup
 * Polyfills required for packages that depend on browser/Worker globals
 */

// Polyfill 'self' for isomorphic-dompurify (expects browser/Worker globals)
// Required by @codex/validation which imports isomorphic-dompurify for SVG sanitization
if (typeof self === 'undefined') {
  // @ts-expect-error - Polyfilling browser global for Node.js test environment
  global.self = global;
}
