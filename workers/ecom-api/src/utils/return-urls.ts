/**
 * Return links in production (Codex-2hxff.79).
 *
 * Every ecom route that sends the buyer or creator to Stripe takes the links
 * Stripe sends them back to: checkout success and cancel, the billing
 * portal's return, Connect onboarding's return and refresh. Their schema
 * (`checkoutRedirectUrlSchema`) accepts the platform's domains plus localhost,
 * 127.0.0.1 and lvh.me, over http or https, in every environment, because it
 * cannot tell them apart and e2e returns to the development hosts. The worker
 * knows its environment, so it applies the production rule here.
 */

import { ENV_NAMES } from '@codex/constants';
import { ValidationError } from '@codex/service-errors';
import { isProductionRedirectUrl } from '@codex/validation';

/**
 * The environments whose return links may be on a development host or over
 * plain http: e2e runs on localhost and lvh.me. Any other value, a missing
 * one included, is treated as production, so a misconfigured worker refuses
 * rather than allows.
 */
const DEV_RETURN_ENVIRONMENTS: ReadonlySet<string> = new Set([
  ENV_NAMES.DEVELOPMENT,
  ENV_NAMES.TEST,
  ENV_NAMES.DEV_REMOTE,
  ENV_NAMES.STAGING,
]);

/**
 * In production, refuse a return link on localhost, 127.0.0.1 or lvh.me, or
 * over plain http, before anything is asked of Stripe. Call it with each of
 * the body's return-link fields, by name. The refusal is shaped as the
 * schema's own is: `Invalid request data`, one detail per refused field.
 */
export function refuseDevReturnUrls(
  environment: string | undefined,
  urls: Record<string, string>
): void {
  if (environment && DEV_RETURN_ENVIRONMENTS.has(environment)) return;
  const refused = Object.entries(urls).filter(
    ([, url]) => !isProductionRedirectUrl(url)
  );
  if (refused.length === 0) return;
  throw new ValidationError('Invalid request data', {
    details: refused.map(([field]) => ({
      path: `body.${field}`,
      message: 'Redirect URL must be https, on a trusted domain',
    })),
  });
}
