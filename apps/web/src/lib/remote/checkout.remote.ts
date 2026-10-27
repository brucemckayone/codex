/**
 * Checkout Remote Functions
 *
 * Server-side functions for Stripe checkout flows.
 * Uses `form()` for progressive enhancement (works without JS).
 * Uses `command()` for SPA-style checkout with client-side redirect.
 */

import { isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { command, form, getRequestEvent } from '$app/server';
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Shared schema + helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared input shape for both the form and command checkout entry points.
 * One source of truth — drift between the two surfaces is impossible.
 */
const checkoutInputSchema = z.object({
  contentId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

type CheckoutInput = z.infer<typeof checkoutInputSchema>;

/**
 * A return URL the client sent, kept only on this request's own origin.
 * ecom-api allowlists the platform's domains, so another org's subdomain would
 * pass there and send the buyer to a page that isn't this one. Anything else
 * falls back to the default, with a warn naming the host only. Kept verbatim:
 * re-serialising it would encode Stripe's `{CHECKOUT_SESSION_ID}`.
 */
function sameOriginOr(
  sent: string | undefined,
  origin: string,
  fallback: string,
  field: 'successUrl' | 'cancelUrl'
): string {
  if (!sent) return fallback;
  const parsed = parseUrl(sent);
  if (parsed?.origin === origin) return sent;
  logger.warn('checkout: a return URL on another origin was replaced', {
    field,
    host: parsed?.host,
  });
  return fallback;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Calls the ecom-api checkout endpoint with sensible default URLs.
 * Both `createCheckout` (form) and `createCheckoutSession` (command) delegate
 * here so the request shape and default URL logic live in one place.
 *
 * The default return is the verifying success page (Codex-2hxff.22 WEB-03),
 * which records the purchase on arrival and confirms against our record. It
 * used to be `/library?purchase=success`, which nothing read: a buyer from
 * the player paywall landed on a library that might not have the item yet.
 */
async function createStripeCheckoutSession({
  contentId,
  successUrl,
  cancelUrl,
}: CheckoutInput): Promise<{ sessionUrl: string }> {
  const { platform, cookies, url } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const result = await api.checkout.create({
    contentId,
    successUrl: sameOriginOr(
      successUrl,
      url.origin,
      `${url.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      'successUrl'
    ),
    cancelUrl: sameOriginOr(
      cancelUrl,
      url.origin,
      `${url.origin}/content/${contentId}`,
      'cancelUrl'
    ),
  });

  return { sessionUrl: result.sessionUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Form (Progressive Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Stripe checkout session via form submission
 *
 * Uses form() because checkout should work without JS (critical path).
 * Redirects directly to Stripe Checkout page.
 *
 * Usage:
 * ```svelte
 * <form {...createCheckout}>
 *   <input type="hidden" name="contentId" value={contentId} />
 *   <button type="submit" disabled={createCheckout.pending}>
 *     {createCheckout.pending ? 'Processing...' : 'Buy Now'}
 *   </button>
 * </form>
 * ```
 */
export const createCheckout = form(checkoutInputSchema, async (input) => {
  try {
    const { sessionUrl } = await createStripeCheckoutSession(input);
    // Redirect to Stripe Checkout
    redirect(303, sessionUrl);
  } catch (error) {
    // SvelteKit redirect() throws - let it propagate
    if (isRedirect(error)) throw error;

    // The form shows fixed copy keyed on these (PreviewPlayer), never
    // `error`: the worker's message is written for developers.
    const status = error instanceof ApiError ? error.status : undefined;
    const code =
      error instanceof ApiError
        ? (detailsCodeOf(error.details) ?? error.code)
        : undefined;
    logger.warn('checkout: the paywall checkout was refused', { status, code });
    const message = error instanceof Error ? error.message : 'Checkout failed';
    return { success: false, error: message, status, code };
  }
});

/** The worker's own code, which most refusals put in `details.code`. */
function detailsCodeOf(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Command (SPA Style)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Stripe checkout session and return URL
 *
 * For SPA-style checkout where you want to handle the redirect client-side.
 * Returns the Stripe session URL for programmatic redirect.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { createCheckoutSession } from '$lib/remote/checkout.remote';
 *
 *   let loading = $state(false);
 *
 *   async function handleCheckout() {
 *     loading = true;
 *     try {
 *       const { sessionUrl } = await createCheckoutSession({ contentId });
 *       window.location.href = sessionUrl;
 *     } catch (error) {
 *       // Handle error
 *     } finally {
 *       loading = false;
 *     }
 *   }
 * </script>
 *
 * <button onclick={handleCheckout} disabled={loading}>
 *   {loading ? 'Loading...' : 'Buy Now'}
 * </button>
 * ```
 */
export const createCheckoutSession = command(checkoutInputSchema, (input) =>
  createStripeCheckoutSession(input)
);
