/**
 * Vitest setup file for @codex/image-processing
 */

// Polyfill 'self' if needed for wasm or similar
console.log('Running vitest setup for image-processing');
if (typeof self === 'undefined') {
  // @ts-expect-error
  global.self = global;
}
