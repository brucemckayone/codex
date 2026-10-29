import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServiceUrl, type EnvName } from '@codex/urls';
import { describe, expect, it } from 'vitest';

const SVELTE_CONFIG = resolve(__dirname, '../../../svelte.config.js');

/**
 * Guard test: the browser may open the studio's live media status socket
 * (Codex-dh31e).
 *
 * The socket goes from the page straight to media-api, so `connect-src`
 * governs it. Production shipped with only `https:` sources there, which CSP3
 * never lets match a `wss:` URL, and Chromium refused every socket: tiles sat
 * on "processing" until a reload. Before that, the R2 upload host was missing
 * the same way (Codex-xjdz7). Neither failure shows in CI unless something
 * checks the list, because no e2e opens the socket.
 */

/** connect-src's entries, parsed from the config's source like the other CSP tests. */
function connectSrc(): string[] {
  // Whole-line comments only: every source here contains `//` itself.
  const source = readFileSync(SVELTE_CONFIG, 'utf-8').replace(
    /^\s*\/\/.*$/gm,
    ''
  );
  const match = source.match(/['"]connect-src['"]\s*:\s*\[([^\]]*)\]/);
  if (!match) throw new Error('svelte.config.js declares no connect-src');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/** CSP3 §6.7.2.9 "scheme-part match": which source schemes cover a URL's. */
function schemeMatches(source: string, url: string): boolean {
  return (
    source === url ||
    (source === 'http' && url === 'https') ||
    (source === 'ws' && ['wss', 'http', 'https'].includes(url)) ||
    (source === 'wss' && url === 'https')
  );
}

/**
 * Whether a `scheme://host[:port]` source allows `url`: the subset of CSP3
 * host-source matching this config uses. Keywords such as 'self' are left
 * out, since the socket's host is never the page's own.
 */
function allows(source: string, url: URL): boolean {
  const parts = source.match(
    /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([^/:]+)(?::(\d+))?$/
  );
  if (!parts) return false;
  const [, scheme, wildcard, host, port] = parts;
  if (!schemeMatches(scheme, url.protocol.slice(0, -1))) return false;
  const hostMatches = wildcard
    ? url.hostname.endsWith(`.${host}`)
    : url.hostname === host;
  return hostMatches && (port ?? '') === url.port;
}

/** Where a studio tab opens its socket, as media-api's liveUrl() builds it. */
function socketUrl(env: EnvName): URL {
  const url = new URL('/api/media-status/live', buildServiceUrl('media', env));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

describe('CSP: the live media status socket (Codex-dh31e)', () => {
  it.each([
    'production',
    'staging',
    'dev',
    'development',
  ] as const)('connect-src allows the %s socket', (env) => {
    const url = socketUrl(env);
    expect(
      connectSrc().some((source) => allows(source, url)),
      `connect-src must allow ${url.href}: add a ${url.protocol}// source`
    ).toBe(true);
  });

  it('an https: source never covers a wss: URL (why the wss: entries exist)', () => {
    const url = new URL(
      'wss://media-api.revelations.studio/api/media-status/live'
    );
    expect(allows('https://*.revelations.studio', url)).toBe(false);
    expect(allows('wss://*.revelations.studio', url)).toBe(true);
  });
});
