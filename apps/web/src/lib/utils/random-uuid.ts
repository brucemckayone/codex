/**
 * An RFC 4122 version-4 UUID, wherever the page runs.
 *
 * `crypto.randomUUID` exists only in a SECURE context, and local dev and e2e
 * serve the studio over plain `http://*.lvh.me`, where it is undefined:
 * Chromium reports `isSecureContext === false` there (probed for
 * Codex-2hxff.66). `crypto.getRandomValues` is available in every context, so
 * the fallback builds the same v4 shape from 16 random bytes.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xx)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
