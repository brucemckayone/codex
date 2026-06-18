import type { EnvName, HostInfo } from './types';

/**
 * Parse a hostname into structured route info.
 *
 * Detects env from TLD pattern. Returns `env: null` for unknown hosts
 * (custom domains, IPs, etc.) — workers should pass env explicitly when
 * building URLs from non-routable contexts.
 *
 * Backward-compat note: the `subdomain` field returns the LITERAL first-level
 * label as `extractSubdomain` did historically. For staging hosts, that means
 * the suffix `-staging` is preserved (e.g. `codex-staging.revelations.studio`
 * yields `subdomain: 'codex-staging'`). The `env` field is the canonical
 * env-detection signal.
 */
export function parseHost(host: string): HostInfo {
  const colonIdx = host.indexOf(':');
  // Normalize to lowercase. DNS hostnames are case-insensitive (RFC 4343),
  // and routing-layer comparisons MUST behave the same regardless of how the
  // request's Host header is cased. SvelteKit lowercases the URL.hostname
  // before the reroute hook fires, but Hono passes raw Host through — so
  // doing this once at the parse boundary future-proofs every consumer.
  const hostNoPort = (
    colonIdx >= 0 ? host.slice(0, colonIdx) : host
  ).toLowerCase();
  const port = colonIdx >= 0 ? host.slice(colonIdx + 1) : null;

  // Single-apex envs: bare apex OR `{single-label}.apex`. Nested subdomains
  // (more than one label before apex) collapse to `subdomain: null`. Order
  // matters — `.dev.revelations.studio` MUST be checked before the broader
  // `.revelations.studio` block below.
  const apexMatch =
    matchApex(hostNoPort, 'lvh.me', 'development') ??
    matchApex(hostNoPort, 'localhost', 'development') ??
    matchApex(hostNoPort, 'dev.revelations.studio', 'dev');
  if (apexMatch) {
    return { ...apexMatch, port, nipApex: null };
  }

  // nip.io — LAN testing via embedded IP. Pattern:
  //   (subdomain.)?<a.b.c.d>.nip.io
  if (hostNoPort.endsWith('nip.io')) {
    const m = hostNoPort.match(/^(?:(.+?)\.)?(\d+\.\d+\.\d+\.\d+\.nip\.io)$/);
    const nipApex = m?.[2];
    if (m && nipApex) {
      const sub = m[1];
      const subClean = sub && !sub.includes('.') ? sub : null;
      return {
        env: 'development',
        baseDomain: nipApex,
        subdomain: subClean,
        port,
        nipApex,
      };
    }
  }

  // *.revelations.studio (prod + staging, both single-level).
  // Staging uses suffix pattern (foo-staging.revelations.studio), NOT depth.
  if (hostNoPort === 'revelations.studio') {
    return {
      env: 'production',
      baseDomain: 'revelations.studio',
      subdomain: null,
      port,
      nipApex: null,
    };
  }
  const rsMatch = hostNoPort.match(/^([^.]+)\.revelations\.studio$/);
  const rsSub = rsMatch?.[1];
  if (rsSub) {
    const isStaging = rsSub === 'staging' || rsSub.endsWith('-staging');
    return {
      env: isStaging ? 'staging' : 'production',
      baseDomain: 'revelations.studio',
      subdomain: rsSub,
      port,
      nipApex: null,
    };
  }

  // Unknown host — env=null; callers must pass env explicitly to URL builders.
  return {
    env: null,
    baseDomain: hostNoPort,
    subdomain: null,
    port,
    nipApex: null,
  };
}

/**
 * Match a host against a single-apex env (bare apex OR one-label subdomain).
 * Returns `null` when the host does not belong to this apex, so the caller
 * can fall through to the next candidate.
 */
function matchApex(
  hostNoPort: string,
  apex: string,
  env: EnvName
): { env: EnvName; baseDomain: string; subdomain: string | null } | null {
  if (hostNoPort === apex) {
    return { env, baseDomain: apex, subdomain: null };
  }
  const suffix = `.${apex}`;
  if (hostNoPort.endsWith(suffix)) {
    const sub = hostNoPort.slice(0, -suffix.length);
    // `sub` must be a non-empty single label. Reject empty (malformed
    // leading-dot host like `.lvh.me`) and reject nested (multi-label
    // like `foo.bar.lvh.me`). Matches the historical `extractSubdomain`
    // semantics in apps/web/src/lib/utils/subdomain.ts.
    return {
      env,
      baseDomain: apex,
      subdomain: sub && !sub.includes('.') ? sub : null,
    };
  }
  return null;
}
