/**
 * Checkout Remote Functions
 *
 * Server-side functions for Stripe checkout flows.
 * Uses `form()` for progressive enhancement (works without JS).
 * Uses `command()` for SPA-style checkout with client-side redirect.
 */

import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { command, form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Form (Progressive Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

const checkoutFormSchema = z.object({
  contentId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

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
export const createCheckout = form(
  checkoutFormSchema,
  async ({ contentId, successUrl, cancelUrl }) => {
    const { platform, cookies, url } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.checkout.create({
        contentId,
        successUrl: successUrl || `${url.origin}/library?purchase=success`,
        cancelUrl: cancelUrl || `${url.origin}/content/${contentId}`,
      });

      // Redirect to Stripe Checkout
      redirect(303, result.data.sessionUrl);
    } catch (error) {
      // Return error for form display
      const message =
        error instanceof Error ? error.message : 'Checkout failed';
      return { success: false, error: message };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Command (SPA Style)
// ─────────────────────────────────────────────────────────────────────────────

const checkoutCommandSchema = z.object({
  contentId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

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
export const createCheckoutSession = command(
  checkoutCommandSchema,
  async ({ contentId, successUrl, cancelUrl }) => {
    const { platform, cookies, url } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const result = await api.checkout.create({
      contentId,
      successUrl: successUrl || `${url.origin}/library?purchase=success`,
      cancelUrl: cancelUrl || `${url.origin}/content/${contentId}`,
    });

    // Return URL for client-side redirect
    return { sessionUrl: result.data.sessionUrl };
  }
);
