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
 * Calls the ecom-api checkout endpoint with sensible default URLs.
 * Both `createCheckout` (form) and `createCheckoutSession` (command) delegate
 * here so the request shape and default URL logic live in one place.
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
    successUrl: successUrl || `${url.origin}/library?purchase=success`,
    cancelUrl: cancelUrl || `${url.origin}/content/${contentId}`,
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

    // Return error for form display
    const message = error instanceof Error ? error.message : 'Checkout failed';
    return { success: false, error: message };
  }
});

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
