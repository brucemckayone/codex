/**
 * Where an agreement email sends its recipient (Codex-2hxff.20 AGR-10;
 * docs/payments/agreements.md §Emails).
 *
 * The two sides live on different hosts:
 *   - the owner manages agreements in their organisation's Studio, on the
 *     org subdomain (`/studio/monetisation/revenue-share`);
 *   - a creator negotiates in the creator Studio, on the `creators`
 *     subdomain (`/studio/negotiations/<proposalId>`, which takes any
 *     proposal id in the thread, or the `/studio/negotiations` list).
 *
 * Every link used to be `${WEB_APP_URL}/studio/negotiations/...` for both
 * sides: the apex host has no `studio/` route, so every link was dead.
 *
 * Built from the env name with `buildOrgUrlFromEnv`, never from a request
 * or `WEB_APP_URL` host: on staging `parseHost` reports the PRODUCTION apex,
 * so a host-derived link would send a staging recipient to production (the
 * Codex-a9kn0 trap, `@codex/urls` `buildPlatformUrl`).
 */

import { ENV_NAMES } from '@codex/constants';
import { buildOrgUrlFromEnv, type EnvName } from '@codex/urls';

/** The owner's page for every agreement in their organisation. */
const OWNER_AGREEMENTS_PATH = '/studio/monetisation/revenue-share';

/** The creator's negotiations list; a thread lives under it. */
const CREATOR_NEGOTIATIONS_PATH = '/studio/negotiations';

/** The subdomain the creator Studio is served on. */
const CREATORS_SUBDOMAIN = 'creators';

export type AgreementEmailRecipient =
  | { side: 'owner'; orgSlug: string }
  /** `proposalId` null: no thread to open (a decline, or an agreement whose
      accepted proposal link is missing), so the link opens the list. */
  | { side: 'creator'; proposalId: string | null };

const ENV_NAME_VALUES: readonly string[] = Object.values(ENV_NAMES);

/** Whether a runtime `ENVIRONMENT` string is one `@codex/urls` can route. */
export function isEnvName(value: string): value is EnvName {
  return ENV_NAME_VALUES.includes(value);
}

/** The absolute link an agreement email gives this recipient. */
export function buildAgreementEmailLink(
  env: EnvName,
  recipient: AgreementEmailRecipient
): string {
  if (recipient.side === 'owner') {
    return buildOrgUrlFromEnv(env, recipient.orgSlug, OWNER_AGREEMENTS_PATH);
  }
  const path = recipient.proposalId
    ? `${CREATOR_NEGOTIATIONS_PATH}/${recipient.proposalId}`
    : CREATOR_NEGOTIATIONS_PATH;
  return buildOrgUrlFromEnv(env, CREATORS_SUBDOMAIN, path);
}
