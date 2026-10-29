<!--
  @component PreviewPlayer

  Plays an HLS preview clip with a 30-second time limit.
  Shows a CTA overlay when the preview ends or when access is locked.

  The player is `PreviewPlayerCore` (controls, HLS lifecycle, keyboard);
  this is the content page's paywall over it, and the only part that knows
  about checkout. The core's controls step aside while the overlay is up.

  @prop {string} previewUrl - HLS preview manifest URL
  @prop {string} [poster] - Poster/thumbnail image URL
  @prop {string} contentId - Content ID for checkout form
  @prop {string} [contentTitle] - Content title for display
  @prop {AccessState} accessState - Current access state
  @prop {boolean} canPurchase - Whether a purchase would open this content (`canBeSold`)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { createCheckout } from '$lib/remote/checkout.remote';
  import { page } from '$app/state';
  import type { AccessState } from './access-state';
  import PreviewPlayerCore from './PreviewPlayerCore.svelte';

  const PREVIEW_TIME_LIMIT = 30;

  interface Props {
    previewUrl: string;
    poster?: string;
    contentId: string;
    contentTitle?: string;
    accessState: AccessState;
    /**
     * Whether a one-off purchase would open this content — `canBeSold` from
     * `@codex/constants`. When false the overlay offers no Buy form, since
     * checkout refuses the item (Codex-2hxff.14). Required so that no caller
     * can bring the Buy button back by leaving it out.
     */
    canPurchase: boolean;
    /** When true, attempts muted autoplay after HLS init. Default: false */
    autoplay?: boolean;
  }

  const {
    previewUrl,
    poster,
    contentId,
    contentTitle,
    accessState,
    canPurchase,
    autoplay = false,
  }: Props = $props();

  let previewEnded = $state(false);
  let showCta = $derived(previewEnded || accessState.status === 'locked');

  // Buy returns the way the content page's own purchase form does (each
  // detail page's `buildSuccessUrl`), naming the piece so the success page's
  // Start Watching opens it. The checkout's default return names nothing, and
  // the creators host finds a piece by username and slug only (Codex-2hxff.22).
  // Off a detail page there is no slug, and the default stands.
  const successUrl = $derived.by(() => {
    const contentSlug = page.params?.contentSlug;
    if (!contentSlug) return undefined;
    const username = page.params?.username;
    const creator = username ? `&username=${encodeURIComponent(username)}` : '';
    return `${page.url.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=${encodeURIComponent(contentSlug)}${creator}`;
  });
  // Cancel at Stripe comes back here, as the detail page's form does
  // (`url.href`). The default, `/content/{id}`, matches no route on the
  // creators host (Codex-2hxff.78).
  const cancelUrl = $derived(page.url.href);

  // A refused Buy says so in plain words, never the worker's message (the
  // pricing page's rule, Codex-2hxff.69): already owned, then reload; a
  // failure a retry can fix, then the Buy button is the retry; anything else,
  // plainly, with no "try again". The remote logs it.
  const refusal = $derived.by(() => {
    const result = createCheckout.result;
    if (!result || result.success !== false || createCheckout.pending > 0) {
      return null;
    }
    if (result.code === 'ALREADY_PURCHASED') {
      return { message: m.checkout_refusal_owned(), reload: true };
    }
    const status = result.status;
    const retryable =
      status === undefined || status >= 500 || status === 408 || status === 429;
    return {
      message: retryable
        ? m.checkout_refusal_problem()
        : m.checkout_refusal_refused(),
      reload: false,
    };
  });

  const loginUrl = $derived(`/login?redirect=${encodeURIComponent(page.url.pathname)}`);

  const ctaReason = $derived<'auth_required' | 'purchase_required' | 'subscription_required' | 'higher_tier_required'>(
    accessState.status === 'locked' ? accessState.reason : 'purchase_required'
  );
</script>

<div class="preview-player">
  <PreviewPlayerCore
    src={previewUrl}
    {poster}
    title={contentTitle ?? m.player_preview_label()}
    start={autoplay ? 'muted' : 'paused'}
    limit={PREVIEW_TIME_LIMIT}
    badge
    controls={!showCta}
    onended={() => (previewEnded = true)}
  />

  <!-- CTA Overlay -->
  {#if showCta}
    <div class="preview-player__overlay" class:preview-player__overlay--visible={showCta}>
      <div class="preview-player__cta">
        {#if previewEnded}
          <p class="preview-player__cta-title">{m.player_preview_ended()}</p>
        {/if}

        <p class="preview-player__cta-description">
          {#if ctaReason === 'subscription_required'}
            {m.subscribe_cta_description()}
          {:else if ctaReason === 'higher_tier_required'}
            {m.upgrade_cta_description()}
          {:else if contentTitle}
            {m.purchase_cta_description()}
          {:else}
            {m.player_preview_cta()}
          {/if}
        </p>

        {#if ctaReason === 'auth_required'}
          <a href={loginUrl} class="preview-player__cta-button">
            {m.purchase_sign_in()}
          </a>
        {:else if ctaReason === 'subscription_required'}
          <a href="/pricing" class="preview-player__cta-button">
            {m.subscribe_cta_title()}
          </a>
        {:else if ctaReason === 'higher_tier_required'}
          <a href="/pricing" class="preview-player__cta-button">
            {m.upgrade_cta_title()}
          </a>
        {:else if canPurchase}
          <form {...createCheckout}>
            <input type="hidden" name="contentId" value={contentId} />
            {#if successUrl}
              <input type="hidden" name="successUrl" value={successUrl} />
            {/if}
            <input type="hidden" name="cancelUrl" value={cancelUrl} />
            <button
              type="submit"
              class="preview-player__cta-button"
              disabled={createCheckout.pending > 0}
            >
              {createCheckout.pending ? m.common_loading() : m.purchase_cta_title()}
            </button>
          </form>
          {#if refusal}
            <p class="preview-player__cta-refusal" role="alert">
              {refusal.message}
              {#if refusal.reload}
                <a href={cancelUrl} class="preview-player__cta-refusal-link">
                  {m.checkout_refusal_reload()}
                </a>
              {/if}
            </p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .preview-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: var(--color-surface-tertiary);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  /* CTA Overlay */
  .preview-player__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    z-index: 4;
    opacity: 0;
    transition:
      opacity var(--duration-slow) var(--ease-default),
      background var(--duration-slow) var(--ease-default);
    pointer-events: none;
  }

  .preview-player__overlay--visible {
    opacity: 1;
    background: var(--color-player-overlay);
    pointer-events: auto;
  }

  .preview-player__cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    padding: var(--space-6);
    max-width: 320px;
  }

  .preview-player__cta-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-player-text);
    margin: 0;
  }

  .preview-player__cta-description {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .preview-player__cta-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--space-10);
    padding-inline: var(--space-6);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-inverse);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .preview-player__cta-button:hover {
    background-color: var(--color-interactive-hover);
  }

  .preview-player__cta-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .preview-player__cta-button:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .preview-player__cta-refusal {
    font-size: var(--text-sm);
    color: var(--color-player-text);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .preview-player__cta-refusal-link {
    color: inherit;
    text-decoration: underline;
  }

  .preview-player__cta-refusal-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Responsive */
  @media (--below-sm) {
    .preview-player__cta {
      padding: var(--space-4);
    }

    .preview-player__cta-title {
      font-size: var(--text-base);
    }
  }
</style>
