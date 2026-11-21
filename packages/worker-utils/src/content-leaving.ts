/**
 * The leaving notice's sweep (Codex-a6ofh.6.4), both workers' halves:
 * - media-api's maintenance run asks content-api for one tick, with worker
 *   HMAC (`WorkerContentLeavingSweeper`);
 * - content-api's emails link each piece's page, built from the environment
 *   NAME (`leavingNoticeLinkFor`).
 */

import { LEAVING_SWEEP_CALL_TIMEOUT_MS } from '@codex/constants';
import type { LeavingNoticeLinker } from '@codex/content';
import type { ObservabilityClient } from '@codex/observability';
import { workerFetch } from '@codex/security';
import { InternalServiceError } from '@codex/service-errors';
import type { ContentLeavingSweeper } from '@codex/transcoding';
import { buildOrgUrlFromEnv, buildPlatformUrl, isEnvName } from '@codex/urls';
import {
  type ContentLeavingSweepReport,
  contentLeavingSweepReportSchema,
} from '@codex/validation';
import { contentApiUrlFor, refusesForGood } from './content-ready';

/** content-api's route for it: its mount and this caller share the path. */
export const CONTENT_LEAVING_SWEEP_ROUTE = '/internal/content/leaving-sweep';

export class WorkerContentLeavingSweeper implements ContentLeavingSweeper {
  constructor(
    private readonly contentApiUrl: string,
    private readonly workerSecret: string,
    private readonly obs?: ObservabilityClient,
    private readonly timeoutMs = LEAVING_SWEEP_CALL_TIMEOUT_MS
  ) {}

  /**
   * One tick, awaited for content-api's report. Throws on any other answer,
   * at error first for a refusal no retry cures (a secret, route or contract
   * fault stops every owner's emails, not a blip), and on a 2xx without a
   * report.
   */
  async sweep(): Promise<ContentLeavingSweepReport> {
    const response = await workerFetch(
      `${this.contentApiUrl}${CONTENT_LEAVING_SWEEP_ROUTE}`,
      {
        method: 'POST',
        body: '{}',
        // A hung tick must reject (the next hour's tick takes over: its
        // claims wait out their lease), not hold the maintenance run.
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      this.workerSecret
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = (body as { error?: { code?: unknown } } | undefined)?.error
        ?.code;
      if (refusesForGood(response.status)) {
        this.obs?.error('Leaving sweep call refused by content-api', {
          status: response.status,
          code: typeof code === 'string' ? code : undefined,
        });
      }
      throw new InternalServiceError(
        `content-api answered ${response.status}`,
        {
          status: response.status,
        }
      );
    }
    const report = contentLeavingSweepReportSchema.safeParse(
      (body as { data?: unknown } | undefined)?.data
    );
    if (!report.success) {
      throw new InternalServiceError(
        'content-api answered the leaving sweep without a report',
        { status: response.status }
      );
    }
    return report.data;
  }
}

/**
 * media-api's sweeper: none without the shared secret, which signs the call
 * (the caller logs its absence). content-api's URL comes from the
 * environment's name alone (`contentApiUrlFor`).
 */
export function contentLeavingSweeperFor(
  env: { ENVIRONMENT?: string; WORKER_SHARED_SECRET?: string },
  obs?: ObservabilityClient
): ContentLeavingSweeper | undefined {
  if (!env.WORKER_SHARED_SECRET) return undefined;
  return new WorkerContentLeavingSweeper(
    contentApiUrlFor(env),
    env.WORKER_SHARED_SECRET,
    obs
  );
}

/**
 * The page a leaving email links, from the environment's NAME, never a
 * configured host (staging's single-label hosts, Codex-a9kn0), as the
 * media-ready emails build theirs: an org piece on its org's subdomain, a
 * personal one under its creator's handle on `creators`, and, for a creator
 * with no handle, the owner's library on the platform. Null for an
 * environment links are not built for.
 */
export function leavingNoticeLinkFor(
  environment: string | undefined
): LeavingNoticeLinker {
  if (!environment || !isEnvName(environment)) return () => null;
  return ({ slug, organizationSlug, creatorUsername }) => {
    if (organizationSlug) {
      return buildOrgUrlFromEnv(
        environment,
        organizationSlug,
        `/content/${slug}`
      );
    }
    if (creatorUsername) {
      return buildOrgUrlFromEnv(
        environment,
        'creators',
        `/@${creatorUsername}/content/${slug}`
      );
    }
    return buildPlatformUrl(
      new URL(buildOrgUrlFromEnv(environment, 'creators')),
      '/library'
    );
  };
}
