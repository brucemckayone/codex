import { DOMAINS } from '@codex/constants';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { ENV_HOSTS } from '@codex/urls';

/**
 * Configuration for the dev-only Cloudflare Custom Domain provisioner.
 *
 * The service is a no-op outside the `dev` deployed environment, so the
 * Cloudflare credentials are optional — missing creds just turn off the
 * provisioning step rather than failing the org-create flow.
 *
 * WP-6 (Codex-0hxw4) removed the `zoneName` config injection — the value
 * was always `DOMAINS.PROD` (`revelations.studio`), the single DNS zone
 * for the entire prod/staging/dev hierarchy. The hostname pattern is now
 * derived from `ENV_HOSTS.dev.orgHost(slug)` instead of string-templated
 * from injected config, keeping the dev domain string in lockstep with
 * the rest of the routing centralization.
 */
export interface DevDomainServiceConfig extends ServiceConfig {
  /** Cloudflare API token with `Workers Scripts: Edit` scope. */
  cloudflareApiToken?: string;
  /** Cloudflare account ID hosting the dev workers. */
  cloudflareAccountId?: string;
  /**
   * The name of the dev web worker that org subdomains should bind to.
   * For Codex this is `codex-web-dev`.
   */
  webWorkerName: string;
}

interface CloudflareWorkerDomain {
  id: string;
  hostname: string;
  service: string;
}

/**
 * The Cloudflare DNS zone hosting the dev hierarchy. `revelations.studio`
 * is the single parent zone for prod (`revelations.studio`), staging
 * (`*-staging.revelations.studio`), AND dev (`*.dev.revelations.studio`).
 * Sourced from `DOMAINS.PROD` so any future zone rename stays consistent
 * with the rest of `@codex/constants`.
 */
const CLOUDFLARE_ZONE_NAME = DOMAINS.PROD;

/**
 * Provisions and removes Cloudflare Workers Custom Domains for dev orgs.
 *
 * In the deployed `dev` environment, the free Cloudflare Universal SSL
 * does not auto-issue certs for hostnames at two levels deep (such as
 * `studio-alpha.dev.revelations.studio`). Workers Custom Domains DO get
 * per-hostname certs auto-issued at any depth, AND they bind the
 * hostname to a specific worker for routing — so we use them to cover
 * both TLS and routing in one call.
 *
 * The hook is fire-and-forget: org creation never blocks on (or fails
 * because of) Cloudflare API hiccups. Errors are logged via the
 * observability client and swallowed.
 *
 * Outside dev (production, staging, local development) every method is
 * a no-op — production org subdomains are first-level under
 * `revelations.studio` and are covered by the existing Universal SSL
 * wildcard with no additional work needed.
 */
export class DevDomainService extends BaseService {
  private readonly apiToken?: string;
  private readonly accountId?: string;
  private readonly webWorkerName: string;
  private cachedZoneId?: string;

  constructor(config: DevDomainServiceConfig) {
    super(config);
    this.apiToken = config.cloudflareApiToken;
    this.accountId = config.cloudflareAccountId;
    this.webWorkerName = config.webWorkerName;
  }

  /**
   * Ensure a Custom Domain exists for the given org slug bound to the
   * web worker. Idempotent: if the domain already exists this is a
   * silent no-op.
   */
  async ensureDevDomain(slug: string): Promise<void> {
    if (!this.shouldRun(slug, 'ensureDevDomain')) return;
    const hostname = this.hostnameFor(slug);
    try {
      const existing = await this.findDomain(hostname);
      if (existing) {
        this.obs.info('Dev custom domain already exists', { slug, hostname });
        return;
      }
      const zoneId = await this.resolveZoneId();
      await this.createDomain(hostname, this.webWorkerName, zoneId);
      this.obs.info('Dev custom domain created', { slug, hostname });
    } catch (error) {
      this.logCloudflareFailure('ensureDevDomain', error, { slug, hostname });
    }
  }

  /** Remove the Custom Domain for a given org slug, if it exists. */
  async removeDevDomain(slug: string): Promise<void> {
    if (!this.shouldRun(slug, 'removeDevDomain')) return;
    const hostname = this.hostnameFor(slug);
    try {
      const existing = await this.findDomain(hostname);
      if (!existing) return;
      await this.deleteDomain(existing.id);
      this.obs.info('Dev custom domain removed', { slug, hostname });
    } catch (error) {
      this.logCloudflareFailure('removeDevDomain', error, { slug, hostname });
    }
  }

  /**
   * Rename the Custom Domain when an org's slug changes. Removes the old
   * binding and creates a new one. Skips work if the slug is unchanged.
   */
  async renameDevDomain(oldSlug: string, newSlug: string): Promise<void> {
    if (oldSlug === newSlug) return;
    if (!this.isDevEnvironment()) return;
    await this.removeDevDomain(oldSlug);
    await this.ensureDevDomain(newSlug);
  }

  // ----- helpers --------------------------------------------------------

  private shouldRun(slug: string, methodName: string): boolean {
    if (!this.isDevEnvironment()) return false;
    if (!this.canCallCloudflare()) {
      this.obs.warn(
        `DevDomainService.${methodName} skipped — Cloudflare creds missing`,
        {
          slug,
          hasToken: Boolean(this.apiToken),
          hasAccountId: Boolean(this.accountId),
        }
      );
      return false;
    }
    return true;
  }

  private isDevEnvironment(): boolean {
    return this.environment === 'dev';
  }

  private canCallCloudflare(): boolean {
    return Boolean(this.apiToken && this.accountId);
  }

  /**
   * The Cloudflare Custom Domain hostname for a given org slug. Sourced
   * from `ENV_HOSTS.dev.orgHost` (since WP-6 / Codex-0hxw4) so the
   * pattern stays in lockstep with the rest of the routing layer —
   * change `ENV_HOSTS.dev.orgHost` in one place to update every hostname
   * derivation in the codebase.
   */
  private hostnameFor(slug: string): string {
    return ENV_HOSTS.dev.orgHost(slug);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
    };
  }

  private logCloudflareFailure(
    method: string,
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.obs.warn(`DevDomainService.${method} failed`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private async resolveZoneId(): Promise<string> {
    if (this.cachedZoneId) return this.cachedZoneId;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(CLOUDFLARE_ZONE_NAME)}`,
      { headers: this.headers() }
    );
    const body = (await res.json()) as {
      success: boolean;
      result?: Array<{ id: string }>;
      errors?: unknown;
    };
    const zoneId = body.result?.[0]?.id;
    if (!body.success || !zoneId) {
      throw new Error(
        `Failed to resolve zone id for ${CLOUDFLARE_ZONE_NAME}: ${JSON.stringify(body.errors ?? body)}`
      );
    }
    this.cachedZoneId = zoneId;
    return zoneId;
  }

  private async findDomain(
    hostname: string
  ): Promise<CloudflareWorkerDomain | null> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/domains`,
      { headers: this.headers() }
    );
    const body = (await res.json()) as {
      success: boolean;
      result?: CloudflareWorkerDomain[];
    };
    if (!body.success || !body.result) return null;
    return body.result.find((d) => d.hostname === hostname) ?? null;
  }

  private async createDomain(
    hostname: string,
    service: string,
    zoneId: string
  ): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/domains`,
      {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname,
          service,
          environment: 'production',
          zone_id: zoneId,
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Cloudflare custom-domain create failed (${res.status}): ${text.slice(0, 300)}`
      );
    }
  }

  private async deleteDomain(id: string): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/domains/${id}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Cloudflare custom-domain delete failed (${res.status}): ${text.slice(0, 300)}`
      );
    }
  }
}
