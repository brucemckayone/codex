<!--
  @component PreviewPlayer

  Plays an HLS preview clip with a 30-second time limit, and ends on the
  paywall's own words (Codex-2hxff.99; owner-approved mockup
  locked-with-preview.html, with its polish).

  The player is `PreviewPlayerCore` (controls, HLS lifecycle, keyboard);
  this is the content page's paywall over it, and the only part that knows
  about checkout. When the clip ends, the core swaps its controls for the
  end screen drawn here: "Preview ended", the lock's own line, the
  paywall's first action (`end`, from `describePreviewEnd`), and Watch
  preview again, which starts the clip over with the core's own replay.

  @prop {string} previewUrl - HLS preview manifest URL
  @prop {string} [poster] - Poster/thumbnail image URL
  @prop {string} contentId - Content ID for checkout form
  @prop {string} [contentTitle] - Content title for display
  @prop {PreviewEnd} end - What the end screen says and offers
  @prop {object} [follow] - Follow's state and handler, for a follow action
  @prop {boolean} [audio] - An audio item: "Listen to preview again"
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { createCheckout } from '$lib/remote/checkout.remote';
  import { page } from '$app/state';
  import SubscribeButton from '$lib/components/subscription/SubscribeButton.svelte';
  import { RotateCcwIcon } from '$lib/components/ui/Icon';
  import type { PreviewEnd } from './preview-end';
  import PreviewPlayerCore from './PreviewPlayerCore.svelte';

  const PREVIEW_TIME_LIMIT = 30;

  interface Props {
    previewUrl: string;
    poster?: string;
    contentId: string;
    contentTitle?: string;
    /**
     * The end screen's line and action, chosen as the paywall's gate chain
     * chooses (`describePreviewEnd`). Buy is offered only when it is the
     * paywall's own first action, so no caller can bring it back by
     * leaving something out (Codex-2hxff.14).
     */
    end: PreviewEnd;
    /** A follow action's state and handler: the page's own (`handleFollow`). */
    follow?: { following: boolean; busy: boolean; onfollow: () => void };
    /** When true, attempts muted autoplay after HLS init. Default: false */
    autoplay?: boolean;
    /** An audio item: the replay says "Listen", as the paywall does (C2-W4). */
    audio?: boolean;
  }

  const {
    previewUrl,
    poster,
    contentId,
    contentTitle,
    end,
    follow,
    autoplay = false,
    audio = false,
  }: Props = $props();

  let root = $state<HTMLElement | null>(null);
  let endScreen = $state<HTMLElement | null>(null);
  let previewEnded = $state(false);
  const titleId = $props.id();

  /**
   * The clip has ended. The core takes its controls away, so a viewer whose
   * focus was on them is given the end screen's first action; anyone else
   * keeps their place. The live line below says it either way.
   */
  async function handleEnded() {
    const hadFocus = root?.contains(document.activeElement) ?? false;
    previewEnded = true;
    if (!hadFocus) return;
    await tick();
    endScreen
      ?.querySelector<HTMLElement>('a[href], button:not(:disabled)')
      ?.focus();
  }

  /** Watch preview again: the core starts it over and focuses its play button. */
  function watchAgain(replay: () => void) {
    previewEnded = false;
    replay();
  }

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
</script>

<div class="preview-player" bind:this={root}>
  <PreviewPlayerCore
    src={previewUrl}
    {poster}
    title={contentTitle ?? m.player_preview_label()}
    start={autoplay ? 'muted' : 'paused'}
    limit={PREVIEW_TIME_LIMIT}
    badge
    controls
    onended={handleEnded}
    ended={endScreenSnippet}
  />
  <p class="sr-only" aria-live="polite">
    {previewEnded ? m.player_preview_ended() : ''}
  </p>
</div>

{#snippet endScreenSnippet(replay: () => void)}
  {@const action = end.action}
  <div
    class="preview-player__overlay"
    role="group"
    aria-labelledby={titleId}
    bind:this={endScreen}
    data-testid="preview-end"
    data-action={action.kind}
  >
    <div class="preview-player__cta">
      <p class="preview-player__cta-title" id={titleId}>{m.player_preview_ended()}</p>
      {#if end.line}
        <p class="preview-player__cta-description">{end.line}</p>
      {/if}

      {#if action.kind === 'plan'}
        <!-- The paywall's own button, Manage plan left in the paywall. -->
        <div class="preview-player__cta-plan">
          <SubscribeButton
            organizationId={action.organizationId}
            isAuthenticated
            subscribeHref={action.subscribeHref}
            upgradeRequired={action.upgradeRequired}
            changePlan={action.changePlan}
            size="xl"
            showBadge={false}
            showManage={false}
          />
        </div>
      {:else if action.kind === 'link'}
        <a href={action.href} class="preview-player__cta-button">{action.label}</a>
      {:else if action.kind === 'follow' && follow}
        <button
          type="button"
          class="preview-player__cta-button"
          onclick={follow.onfollow}
          disabled={follow.following || follow.busy}
        >
          {follow.following ? m.org_following() : m.org_follow()}
        </button>
      {:else if action.kind === 'buy'}
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
            {createCheckout.pending ? m.common_loading() : action.label}
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

      <div class="preview-player__cta-more">
        {#if end.signIn}
          <a href={end.signIn.href} class="preview-player__cta-link">{end.signIn.label}</a>
        {/if}
        <button
          type="button"
          class="preview-player__cta-replay"
          onclick={() => watchAgain(replay)}
        >
          <RotateCcwIcon size={14} aria-hidden="true" />
          {audio ? m.player_preview_listen_again() : m.player_preview_watch_again()}
        </button>
      </div>
    </div>
  </div>
{/snippet}

<style>
  .preview-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: var(--color-surface-tertiary);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  /*
   * The core's end layer, under the words: the last frame shows through one
   * uniform veil over the whole frame, never a patch behind the words, with a
   * blur (owner polish (b)). The veil is the midpoint of the two player
   * overlay tokens, so an org that tunes them (Fine-tune › Control and Heavy
   * Overlay) tunes it too (W3). By default they are 0.6 and 0.8 black, so it
   * computes to 0.7 black (oklab(0 0 0 / 0.7) in Chrome, the approved veil):
   * 0.6 gives the line 4.4:1 over a white frame, 0.8 hides the frame. The
   * veil alone carries the contrast (the title 8.5:1, the line 6.2:1 over
   * white), so without backdrop-filter it is the flat-panel fallback.
   */
  .preview-player :global(.player .player__ended) {
    padding: 0;
    background: color-mix(
      in oklab,
      var(--color-player-overlay),
      var(--color-player-overlay-heavy)
    );
    -webkit-backdrop-filter: blur(var(--blur-md));
    backdrop-filter: blur(var(--blur-md));
  }

  .preview-player__overlay {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 100%;
    block-size: 100%;
  }

  /* (a) The button is the focus: the title and its line grouped, clear space
     before it. (d) A fade and rise as it appears. */
  .preview-player__cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-6);
    max-width: 22rem;
    animation: preview-end-in var(--duration-slower) var(--ease-smooth) both;
  }

  @keyframes preview-end-in {
    from {
      opacity: 0;
      translate: 0 var(--space-2);
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  /* With reduced motion it simply appears: the tokens already collapse the
     duration, and the movement goes too. */
  @media (prefers-reduced-motion: reduce) {
    .preview-player__cta {
      animation: none;
    }
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
    margin: var(--space-2) 0 0;
    line-height: var(--leading-normal);
  }

  /* The paywall's own Button (xl, 48px) for a plan; the same look here for
     a link, Follow and Buy. The interactive pair is the brand's primary on
     an org page, with the org brand's own ink rule. */
  .preview-player__cta-plan,
  .preview-player__cta form {
    margin-top: var(--space-4);
  }

  .preview-player__cta-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--space-12);
    margin-top: var(--space-4);
    padding-inline: var(--space-6);
    font-family: inherit;
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-on-interactive);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .preview-player__cta form .preview-player__cta-button {
    margin-top: 0;
  }

  .preview-player__cta-button:hover {
    background-color: var(--color-interactive-hover);
    color: var(--color-on-interactive-hover);
  }

  .preview-player__cta-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-0-5);
  }

  .preview-player__cta-button:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .preview-player__cta-refusal {
    font-size: var(--text-sm);
    color: var(--color-player-text);
    margin: var(--space-2) 0 0;
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

  /* (c) Watch preview again, quiet, on its own row under the action; Sign in
     shares it when there is one. */
  .preview-player__cta-more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-1) var(--space-4);
    margin-top: var(--space-2);
  }

  .preview-player__cta-description + .preview-player__cta-more {
    margin-top: var(--space-4);
  }

  .preview-player__cta-link {
    font-size: var(--text-sm);
    color: var(--color-player-text);
    text-decoration: underline;
  }

  .preview-player__cta-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-0-5);
  }

  /* 24px tall: WCAG 2.2 target size (AA). A 44px row does not fit a 201px
     player under the action. */
  .preview-player__cta-replay {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    block-size: var(--space-6);
    padding-inline: var(--space-2);
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-player-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
  }

  .preview-player__cta-replay:hover {
    color: var(--color-player-text);
    background: var(--color-player-surface-hover);
  }

  .preview-player__cta-replay:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-0-5);
  }

  /* Responsive: 201px tall at 390px, so the block padding gives way first. */
  @media (--below-sm) {
    .preview-player__cta {
      padding: var(--space-2) var(--space-4);
    }

    .preview-player__cta-title {
      font-size: var(--text-base);
    }
  }
</style>
