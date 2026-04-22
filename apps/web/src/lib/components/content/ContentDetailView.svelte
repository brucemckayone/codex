<!--
  @component ContentDetailView

  Shared content detail view used by both org and creator content detail pages.
  Handles player/preview rendering, metadata display, a single-gate CTA chain,
  "What you'll get" benefits, and the written-article body. The related-content
  grid is rendered by the page wrappers via the shared RelatedContent component.

  The purchase form and creator attribution are passed as snippets to allow
  page-specific customization (form actions, creator link styling).

  @prop {ContentWithRelations} content - The content item with all relations
  @prop {string | null} contentBodyHtml - Rendered HTML for written content body
  @prop {boolean} hasAccess - Whether the current user has full access
  @prop {string | null} streamingUrl - HLS streaming URL (null if no access)
  @prop {object | null} progress - Playback progress data
  @prop {boolean} isAuthenticated - Whether the user is logged in
  @prop {{ sessionUrl?: string; checkoutError?: string; info?: string; alreadyOwned?: boolean; retryCount?: number } | null} formResult - Form action result
  @prop {boolean} purchasing - Whether a purchase is in flight
  @prop {string} creatorName - Display name for the creator
  @prop {string} titleSuffix - Suffix for the page title
  @prop {Snippet} [creatorAttribution] - Custom creator attribution line
  @prop {Snippet} [purchaseForm] - Purchase form with use:enhance
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  // PreviewPlayer must stay statically imported: it imports from
  // $lib/remote/checkout.remote, and SvelteKit's experimental remote
  // functions plugin can't resolve *.remote.ts through a dynamic
  // import boundary (Expected to find metadata for remote file).
  // VideoPlayer and AudioPlayer are heavy but don't touch remote
  // files, so they're dynamically loaded further down.
  import { PreviewPlayer, deriveAccessState } from '$lib/components/player';
  import SubscribeButton from '$lib/components/subscription/SubscribeButton.svelte';
  import { formatPrice, formatDurationHuman } from '$lib/utils/format';
  import { PriceBadge } from '$lib/components/ui/PriceBadge';
  import { LockIcon, CheckIcon, XIcon, PlayIcon } from '$lib/components/ui/Icon';
  import { AccessRevokedOverlay } from '$lib/components/AccessRevokedOverlay';
  import type { AccessRevocationReason } from '$lib/server/content-detail';
  import ProseContent from '$lib/components/editor/ProseContent.svelte';
  import { StructuredData } from '$lib/components/seo';
  import { toast } from '$lib/components/ui/Toast';
  import { followingStore } from '$lib/client/following.svelte';
  import { followOrganization } from '$lib/remote/org.remote';
  import { MediaLiveRegion } from '$lib/components/media-a11y';
  import { extractPlainText } from '@codex/validation';
  import type { ContentWithRelations } from '$lib/types';

  /**
   * Extended content type that includes runtime-resolved media fields.
   * The public content API resolves R2 keys to full CDN URLs (thumbnailUrl,
   * hlsPreviewUrl) that don't exist on the base MediaItem schema type.
   *
   * `captions` is the list of `<track>` entries forwarded to VideoPlayer (Ref 05 §Media
   * Elements §2). Back-end delivery is pending but the prop wiring + empty-array default
   * below mean captions flow through automatically the moment the API starts emitting them.
   */
  type CaptionTrack = {
    src: string;
    srclang: string;
    label: string;
    default?: boolean;
  };
  type ContentDetail = ContentWithRelations & {
    mediaItem?: (ContentWithRelations['mediaItem'] extends infer M
      ? M extends object
        ? M & {
            thumbnailUrl?: string | null;
            hlsPreviewUrl?: string | null;
            captions?: CaptionTrack[] | null;
          }
        : M
      : never) | null;
  };

  /**
   * Form action result shape. Codex-mmju5: `info` + `alreadyOwned` carry the
   * 409 happy-path ("you already own this") so it renders as an info banner
   * with a Play-now CTA rather than a red error. `retryCount` drives the
   * 3-attempt escalation copy (Codex-8aibi).
   */
  type FormResult = {
    sessionUrl?: string;
    checkoutError?: string;
    info?: string;
    alreadyOwned?: boolean;
    retryCount?: number;
  };

  interface Props {
    content: ContentDetail;
    contentBodyHtml: string | null;
    hasAccess: boolean;
    streamingUrl: string | null;
    waveformUrl?: string | null;
    /**
     * HLS quality variants that finished transcoding for this content's
     * media item (e.g. `['1080p', '720p', '480p', '360p']`). Null when the
     * stream has no variant manifest (written content, pre-transcode, legacy
     * items). Forwarded to `VideoPlayer` to populate its quality menu.
     */
    readyVariants?: string[] | null;
    /**
     * ISO 8601 expiry of the signed streaming URL. Forwarded through to the
     * player so it can pre-emptively refresh before the URL dies (Codex-1ywzr).
     * The component itself doesn't consume it — we just forward it to children
     * without mutation.
     */
    streamingExpiresAt?: string | null;
    progress: {
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
    } | null;
    isAuthenticated: boolean;
    formResult: FormResult | null;
    purchasing: boolean;
    creatorName: string;
    titleSuffix: string;
    /** Whether this content requires a subscription tier */
    requiresSubscription?: boolean;
    /** Whether the user has an active subscription to this org */
    hasSubscription?: boolean;
    /** Whether the user's tier is high enough for this content */
    subscriptionCoversContent?: boolean;
    /** True while the access check is still resolving (skeleton state) */
    accessLoading?: boolean;
    /**
     * Reason the user's previously-granted access was revoked — drives the
     * contextual `AccessRevokedOverlay` over the player (Codex-zdf2u).
     * Null on grant, generic 403, or any non-revocation denial.
     */
    revocationReason?: AccessRevocationReason | null;
    /**
     * Called after the user successfully reactivates their subscription from
     * the overlay. Wire this to an `invalidate()` so the server load reruns
     * and either grants access or surfaces the next gate.
     */
    onaccessrestored?: () => void;
    creatorAttribution?: Snippet;
    purchaseForm?: Snippet;
  }

  const {
    content,
    contentBodyHtml,
    hasAccess,
    streamingUrl,
    waveformUrl,
    readyVariants = null,
    streamingExpiresAt,
    progress,
    isAuthenticated,
    formResult,
    purchasing: _purchasing,
    creatorName,
    titleSuffix,
    requiresSubscription,
    hasSubscription,
    subscriptionCoversContent,
    accessLoading = false,
    revocationReason = null,
    onaccessrestored,
    creatorAttribution,
    purchaseForm,
  }: Props = $props();

  // Show the overlay only when the user lost access they previously had —
  // never for first-time paywall encounters (those render the purchase /
  // subscribe gates below). A non-null revocation reason is the signal.
  const showRevokedOverlay = $derived(!hasAccess && !!revocationReason);

  // Checkout-error dismiss state (Codex-8aibi). Resets whenever a fresh
  // formResult identity lands, so a new error shows even if the previous
  // one was dismissed.
  let errorDismissed = $state(false);
  let lastResultSeen: FormResult | null = null;
  $effect(() => {
    if (formResult !== lastResultSeen) {
      errorDismissed = false;
      lastResultSeen = formResult;
    }
  });

  function displayPrice(cents: number | null): string {
    if (!cents) return m.content_price_free();
    return formatPrice(cents);
  }

  let cinemaMode = $state(false);

  const contentTypeBadge = $derived(
    content.contentType === 'video'
      ? m.content_type_video()
      : content.contentType === 'audio'
        ? m.content_type_audio()
        : m.content_type_article()
  );

  const description = $derived(extractPlainText(content.description));

  /**
   * Short description — first sentence or first ~160 chars, whichever is
   * shorter. Lifted above the gate CTAs so browsers see what the content is
   * about BEFORE the sales pitch. Codex-8i22f.
   */
  const shortDescription = $derived.by<string | null>(() => {
    if (!description) return null;
    if (description.length <= 160) return description;
    const firstSentenceEnd = description.search(/[.!?](\s|$)/);
    if (firstSentenceEnd > 0 && firstSentenceEnd < 200) {
      return description.slice(0, firstSentenceEnd + 1);
    }
    // Fallback: hard-cut at word boundary near 160 chars.
    const cut = description.slice(0, 160);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + '…';
  });

  /** When description is short enough to fit entirely in the lede above, skip
   *  the full "About" section below to avoid duplicate copy. */
  const descriptionFullyShownAbove = $derived(
    !!description && description.length <= 160
  );

  const thumbnailUrl = $derived(content.mediaItem?.thumbnailUrl ?? undefined);
  const duration = $derived(content.mediaItem?.durationSeconds ?? 0);
  const priceCents = $derived(content.priceCents ?? null);
  const isPaid = $derived(!!priceCents && priceCents > 0);
  const isFree = $derived(!priceCents || priceCents === 0);
  const needsPurchase = $derived(!hasAccess && isPaid && !requiresSubscription);
  const needsSubscription = $derived(
    !hasAccess && requiresSubscription && !subscriptionCoversContent
  );
  const isFollowersOnly = $derived(
    !hasAccess && content.accessType === 'followers'
  );
  const isTeamOnly = $derived(
    !hasAccess && content.accessType === 'team'
  );

  // Follow state — read from the localStorage-backed store hydrated by the
  // org layout on mount. `$derived` makes the button reactive to optimistic
  // updates without a page reload.
  const isAlreadyFollowing = $derived(
    content.organizationId
      ? followingStore.get(content.organizationId)
      : false
  );
  let followInFlight = $state(false);

  async function handleFollow() {
    const orgId = content.organizationId;
    if (!orgId || followInFlight) return;
    followInFlight = true;
    // Optimistic update — flips the button to "Following" immediately.
    // The server load then re-runs, re-awaits the access check, and the
    // body HTML lands in the payload this time — so the article unlocks
    // without a manual refresh. `'app:auth'` is the narrowest dep the
    // content-detail load declares (see onaccessrestored for the revoke
    // counterpart). Writing to `followingStore` only flips the button copy;
    // it's the invalidate() that triggers the body to render.
    followingStore.set(orgId, true);
    try {
      await followOrganization(orgId);
      await invalidate('app:auth');
    } catch (error) {
      followingStore.set(orgId, false);
      toast.error(
        m.org_follow(),
        error instanceof Error ? error.message : undefined
      );
    } finally {
      followInFlight = false;
    }
  }

  const previewUrl = $derived(content.mediaItem?.hlsPreviewUrl ?? undefined);
  const accessState = $derived(
    deriveAccessState({
      hasAccess,
      hasPreview: !!previewUrl,
      isAuthenticated,
      requiresSubscription,
      hasSubscription,
      subscriptionCoversContent,
    })
  );

  /**
   * Live-region announcement for screen readers when the access state flips
   * (unlock, preview start, locked, loading). Short and polite — AT will
   * announce on every change without being disruptive. Codex-jo819 O3.
   */
  const accessAnnouncement = $derived.by<string>(() => {
    if (accessLoading) return '';
    if (accessState.status === 'unlocked') return 'Content unlocked.';
    if (accessState.status === 'preview') return 'Preview playing.';
    if (accessState.status === 'locked') {
      if (isFollowersOnly) return 'Follow to unlock this content.';
      if (isTeamOnly) return 'Team-only content.';
      if (needsSubscription) return 'Subscription required.';
      if (!isAuthenticated) return 'Sign in required.';
      return 'Purchase required.';
    }
    return '';
  });

  // Content-type-aware primary benefit
  const primaryBenefit = $derived(
    content.contentType === 'video'
      ? m.content_detail_benefit_hd_video()
      : content.contentType === 'audio'
        ? m.content_detail_benefit_hq_audio()
        : m.content_detail_benefit_full_article()
  );

  // Free content shown to an unauthenticated visitor: the body is already
  // readable (server-side policy) but the media stream still needs a signed
  // URL, which needs auth. Swap the "Purchase to watch" lock copy for a
  // sign-in prompt so we don't claim there's a paywall where there isn't.
  const isFreeSigninPrompt = $derived(isFree && !isAuthenticated);

  const lockCtaText = $derived.by<string>(() => {
    if (isFreeSigninPrompt) {
      return content.contentType === 'audio'
        ? m.content_detail_signin_listen_cta()
        : m.content_detail_signin_watch_cta();
    }
    return m.content_detail_purchase_cta();
  });

  const lockCtaSubtext = $derived.by<string>(() => {
    if (isFreeSigninPrompt) {
      return content.contentType === 'audio'
        ? m.content_detail_signin_listen_description()
        : m.content_detail_signin_watch_description();
    }
    return m.content_detail_purchase_cta_description();
  });

  /**
   * Body-lock copy, branched by the real reason the body is gated.
   * Codex-jdmp6 — previously generic purchase copy for every gate.
   */
  const bodyLockText = $derived.by<string>(() => {
    if (isFollowersOnly) return m.followers_only_cta_description();
    if (isTeamOnly) return m.team_only_cta_description();
    if (needsSubscription) {
      return hasSubscription
        ? m.upgrade_cta_description()
        : m.subscribe_cta_description();
    }
    if (!isAuthenticated) return m.checkout_signin_to_purchase();
    return m.content_detail_purchase_cta_description();
  });

  /**
   * Paywall teaser paragraphs for written content — first ~400 chars of body
   * as PLAIN TEXT, split into paragraph chunks for rendering. Using plain
   * text (not HTML) keeps us safe from truncated-tag XSS without needing
   * {@html}. Codex-79g3m.
   */
  const bodyTeaserParagraphs = $derived.by<string[] | null>(() => {
    if (!contentBodyHtml) return null;
    const plain = extractPlainText(contentBodyHtml);
    if (!plain) return null;
    const chunks = plain.split(/\n{2,}/).slice(0, 3);
    const teaser = chunks.join('\n\n').slice(0, 400).trim();
    if (!teaser) return null;
    return teaser.split(/\n{2,}/);
  });

  // ── Lazy-loaded player components ──────────────────────────────
  // VideoPlayer (+ media-chrome + HLS) and AudioPlayer are loaded only
  // when their content type is shown. Written-article content pages
  // ship neither. Saves significant JS on the critical path for
  // non-AV content.
  //
  // PreviewPlayer is NOT lazy-loaded — it imports from
  // $lib/remote/checkout.remote, and SvelteKit's experimental remote
  // functions plugin can't resolve *.remote.ts through a dynamic
  // import boundary. It stays statically imported above.
  type VideoPlayerModule = typeof import('$lib/components/VideoPlayer/VideoPlayer.svelte').default;
  type AudioPlayerModule = typeof import('$lib/components/AudioPlayer').AudioPlayer;

  let VideoPlayer = $state<VideoPlayerModule | null>(null);
  let AudioPlayer = $state<AudioPlayerModule | null>(null);

  $effect(() => {
    if (!browser) return;
    if (content.contentType === 'video' && !VideoPlayer) {
      void import('$lib/components/VideoPlayer/VideoPlayer.svelte').then(
        (mod) => { VideoPlayer = mod.default; }
      );
    }
    if (content.contentType === 'audio' && !AudioPlayer) {
      void import('$lib/components/AudioPlayer').then(
        (mod) => { AudioPlayer = mod.AudioPlayer; }
      );
    }
  });

  // ── SEO ─────────────────────────────────────────────────────────
  // Canonical URL — stable across query params (streaming URLs,
  // session IDs etc should not affect the canonical identity).
  const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);

  // og:type varies by content type: Facebook's spec distinguishes
  // video.other, music.song, and article. Better signal for social
  // shares than the generic 'website' default.
  const ogType = $derived(
    content.contentType === 'video'
      ? 'video.other'
      : content.contentType === 'audio'
        ? 'music.song'
        : 'article'
  );

  // Duration in ISO 8601 format for VideoObject/AudioObject. Schema.org
  // expects e.g. "PT1H30M45S"; we format from raw seconds. Drop zero
  // components except when everything is zero (unlikely but safe).
  const iso8601Duration = $derived.by(() => {
    if (!duration || duration <= 0) return undefined;
    const total = Math.floor(duration);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const parts =
      (hours ? `${hours}H` : '') +
      (minutes ? `${minutes}M` : '') +
      (seconds || (!hours && !minutes) ? `${seconds}S` : '');
    return `PT${parts}`;
  });

  // Content publication date — prefer publishedAt, fall back to createdAt.
  // Values may arrive as ISO strings (post-JSON-serialization over the
  // network) or Date objects (in-process). Normalise to an ISO string.
  const publishedDate = $derived.by<string | undefined>(() => {
    const c = content as unknown as {
      publishedAt?: string | Date | null;
      createdAt?: string | Date | null;
    };
    const raw = c.publishedAt ?? c.createdAt;
    if (!raw) return undefined;
    if (typeof raw === 'string') return raw;
    if (raw instanceof Date) return raw.toISOString();
    return undefined;
  });

  // Schema.org JSON-LD — picks the right type per content kind for
  // richer SERP rendering (video thumbnails, article snippets, etc).
  const contentSchema = $derived.by<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {
      '@context': 'https://schema.org',
      name: content.title,
      url: canonicalUrl,
      ...(description && { description }),
      ...(thumbnailUrl && { thumbnailUrl, image: thumbnailUrl }),
      ...(publishedDate && { uploadDate: publishedDate, datePublished: publishedDate }),
      ...(creatorName && {
        author: { '@type': 'Person', name: creatorName },
      }),
      ...(iso8601Duration && { duration: iso8601Duration }),
    };

    if (content.contentType === 'video') {
      return { ...base, '@type': 'VideoObject' };
    }
    if (content.contentType === 'audio') {
      return { ...base, '@type': 'AudioObject' };
    }
    // 'written' → Article
    return { ...base, '@type': 'Article', headline: content.title };
  });
</script>

<svelte:head>
  <title>{content.title} | {titleSuffix}</title>
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={content.title} />
  {#if description}
    <meta name="description" content={description} />
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:type" content={ogType} />
  <meta property="og:url" content={canonicalUrl} />
  {#if thumbnailUrl}
    <meta property="og:image" content={thumbnailUrl} />
    <!-- LCP: thumbnail is the hero on content pages (video poster,
         audio cover, or article header image). Preload prioritises
         it in the critical chain so the above-fold paint is faster. -->
    <link rel="preload" as="image" href={thumbnailUrl} fetchpriority="high" />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={content.title} />
  {#if description}
    <meta name="twitter:description" content={description} />
  {/if}
</svelte:head>

<StructuredData data={contentSchema} />

<!--
  Root is an <article> (Codex-jo819 O1) — this is the semantic owner of the
  content page. The nested live region announces access-state transitions to
  AT without visual noise (O3).
-->
<article class="content-detail" data-access={hasAccess ? 'full' : 'preview'}>
  <div
    class="content-detail__player-status sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {accessAnnouncement}
  </div>

  <!-- Video Player / Preview — renders FIRST (hero position) -->
  {#if content.contentType === 'video'}
  <div class="content-detail__player" class:content-detail__player--cinema={cinemaMode} data-content-type="video" tabindex="-1">
    {#if showRevokedOverlay}
      <!-- Revoked overlay sits over the poster / preview so the user sees
           "why" without losing the thumbnail context (Codex-zdf2u). -->
      {#if thumbnailUrl}
        <img
          class="content-detail__preview-image"
          src={thumbnailUrl}
          alt={m.content_thumbnail_alt({ title: content.title })}
        />
      {/if}
      <AccessRevokedOverlay
        reason={revocationReason}
        organizationId={content.organizationId ?? undefined}
        onreactivated={onaccessrestored}
      />
    {:else if hasAccess && streamingUrl}
      {#if VideoPlayer}
        <VideoPlayer
          src={streamingUrl}
          contentId={content.id}
          initialProgress={progress?.positionSeconds ?? 0}
          poster={thumbnailUrl}
          captions={content.mediaItem?.captions ?? []}
          expiresAt={streamingExpiresAt ?? null}
          readyVariants={readyVariants ?? null}
          {cinemaMode}
          oncinemachange={(v) => (cinemaMode = v)}
        />
      {:else}
        <div class="content-detail__player-skeleton">
          <div class="skeleton skeleton--player"></div>
        </div>
      {/if}
    {:else if previewUrl && accessState.status === 'preview'}
      <svelte:boundary>
        <PreviewPlayer
          previewUrl={previewUrl}
          poster={thumbnailUrl}
          contentId={content.id}
          contentTitle={content.title}
          {accessState}
          autoplay={true}
        />
        {#snippet failed(_error, _reset)}
          <div class="content-detail__preview">
            {#if thumbnailUrl}
              <img
                class="content-detail__preview-image"
                src={thumbnailUrl}
                alt={m.content_thumbnail_alt({ title: content.title })}
              />
            {/if}
            <div class="content-detail__preview-overlay">
              <div class="content-detail__preview-cta">
                <p class="content-detail__cta-text">{lockCtaText}</p>
                <p class="content-detail__cta-subtext">{lockCtaSubtext}</p>
              </div>
            </div>
          </div>
        {/snippet}
      </svelte:boundary>
    {:else if accessLoading}
      <div class="content-detail__player-skeleton">
        <div class="skeleton skeleton--player"></div>
      </div>
    {:else}
      <div class="content-detail__preview">
        {#if thumbnailUrl}
          <img
            class="content-detail__preview-image"
            src={thumbnailUrl}
            alt={m.content_thumbnail_alt({ title: content.title })}
          />
        {/if}
        <div class="content-detail__preview-overlay">
          <div class="content-detail__preview-cta">
            <LockIcon size={40} class="content-detail__lock-icon" stroke-width="1.5" />
            <p class="content-detail__cta-text">{lockCtaText}</p>
            <p class="content-detail__cta-subtext">{lockCtaSubtext}</p>
          </div>
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- Content Info Section (title, meta, creator) -->
  <div class="content-detail__info">
    <div class="content-detail__header">
      <h1 class="content-detail__title">{content.title}</h1>
      <div class="content-detail__meta">
        <span class="content-detail__badge">{contentTypeBadge}</span>
        {#if duration > 0}
          <span class="content-detail__duration">
            {m.content_duration()}: {formatDurationHuman(duration)}
          </span>
        {/if}
        {#if hasAccess && isPaid}
          <PriceBadge amount={priceCents} purchased={true} />
        {/if}
      </div>
    </div>

    {#if creatorAttribution}
      {@render creatorAttribution()}
    {:else if creatorName}
      <p class="content-detail__creator">
        {m.content_detail_by_creator({ creator: creatorName })}
      </p>
    {/if}

    <!--
      Short description (lede) — lifted above the gate CTAs so browsers see
      what the content IS before the sales pitch. Codex-8i22f.
    -->
    {#if shortDescription}
      <p class="content-detail__short-description">{shortDescription}</p>
    {/if}

    {#if progress?.completed}
      <span class="content-detail__completed-badge">{m.content_progress_completed()}</span>
    {/if}

    <!--
      Audio Player — positioned below title/meta, above purchase/about.
      Codex-066ye: for LOCKED audio content we render a symmetric locked-state
      card mirroring the video preview overlay (thumbnail + lock overlay + CTA
      copy), instead of leaving the audio slot empty above the fold.
    -->
    {#if content.contentType === 'audio'}
      <div class="content-detail__player content-detail__player--audio" data-content-type="audio" tabindex="-1">
        {#if showRevokedOverlay}
          <div class="content-detail__audio-locked">
            {#if thumbnailUrl}
              <img
                class="content-detail__audio-locked-image"
                src={thumbnailUrl}
                alt={m.content_thumbnail_alt({ title: content.title })}
              />
            {/if}
            <AccessRevokedOverlay
              reason={revocationReason}
              organizationId={content.organizationId ?? undefined}
              onreactivated={onaccessrestored}
            />
          </div>
        {:else if hasAccess && streamingUrl}
          {#if AudioPlayer}
            <AudioPlayer
              src={streamingUrl}
              contentId={content.id}
              initialProgress={progress?.positionSeconds ?? 0}
              waveformUrl={waveformUrl}
              poster={thumbnailUrl}
              title={content.title}
              shaderPreset={content.shaderPreset ?? null}
              expiresAt={streamingExpiresAt ?? null}
            />
          {:else}
            <div class="audio-player-skeleton">
              <div class="skeleton skeleton--audio"></div>
            </div>
          {/if}
        {:else if accessLoading}
          <div class="audio-player-skeleton">
            <div class="skeleton skeleton--audio"></div>
          </div>
        {:else}
          <!-- Locked audio preview card (Codex-066ye) -->
          <div class="content-detail__audio-locked">
            {#if thumbnailUrl}
              <img
                class="content-detail__audio-locked-image"
                src={thumbnailUrl}
                alt={m.content_thumbnail_alt({ title: content.title })}
              />
            {/if}
            <div class="content-detail__audio-locked-overlay">
              <LockIcon size={32} class="content-detail__lock-icon" stroke-width="1.5" />
              <p class="content-detail__cta-text">{lockCtaText}</p>
              <p class="content-detail__cta-subtext">{lockCtaSubtext}</p>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!--
      Unified gate-CTA chain (Codex-ledjq). Previously FIVE parallel {#if}
      blocks — overlapping conditions (e.g. follower-gated + paid content)
      would render two CTAs stacked. The {:else if} chain now guarantees
      exactly ONE gate renders. Each gate is a <section> labelled by its
      price amount span (Codex-jo819 O2).
    -->
    {#if !accessLoading}
      {#if isTeamOnly}
        <section class="content-detail__purchase" aria-labelledby="purchase-label-team">
          <div class="content-detail__price">
            <span id="purchase-label-team" class="content-detail__price-amount">{m.team_only_cta_title()}</span>
            <span class="content-detail__price-label">{m.team_only_cta_description()}</span>
          </div>
        </section>
      {:else if isFollowersOnly}
        <section class="content-detail__purchase" aria-labelledby="purchase-label-followers">
          <div class="content-detail__price">
            <span id="purchase-label-followers" class="content-detail__price-amount">{m.followers_only_cta_title()}</span>
            <span class="content-detail__price-label">{m.followers_only_cta_description()}</span>
          </div>

          {#if isAuthenticated}
            <button
              class="content-detail__purchase-btn"
              onclick={handleFollow}
              disabled={isAlreadyFollowing || followInFlight}
            >
              {isAlreadyFollowing ? m.org_following() : m.org_follow()}
            </button>
          {:else}
            <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
              {m.checkout_signin_to_purchase()}
            </a>
          {/if}
        </section>
      {:else if needsSubscription}
        <section class="content-detail__purchase" aria-labelledby="purchase-label-sub">
          <div class="content-detail__price">
            <span id="purchase-label-sub" class="content-detail__price-amount">
              {hasSubscription ? m.upgrade_cta_title() : m.subscribe_cta_title()}
            </span>
            <span class="content-detail__price-label">
              {hasSubscription ? m.upgrade_cta_description() : m.subscribe_cta_description()}
            </span>
          </div>

          {#if isAuthenticated && content.organizationId}
            <!--
              State-aware CTA (Codex-g5vbp). Renders:
                no sub          → Subscribe → pricing
                active + upgrade→ "Upgrade to Watch" + Manage plan
                cancelling      → "Ends {date}" badge + Reactivate + Manage
                past_due        → "Payment failed" badge + Update payment + Manage
                paused          → "Paused" badge + Resume (interactive — Codex-7h4vo) + Manage
              The component reads live state from subscriptionCollection and
              handles its own optimistic reactivate + Stripe portal redirect.
            -->
            <SubscribeButton
              organizationId={content.organizationId}
              {isAuthenticated}
              subscribeHref={`/pricing?returnTo=${encodeURIComponent(page.url.pathname)}`}
              upgradeRequired={hasSubscription ?? false}
              class="content-detail__subscribe-button"
            />
          {:else if !isAuthenticated}
            <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
              {m.checkout_signin_to_purchase()}
            </a>
          {/if}

          {#if isPaid}
            <span class="content-detail__or-divider">or purchase for {displayPrice(priceCents)}</span>
            {#if isAuthenticated && purchaseForm}
              {@render purchaseForm()}
            {/if}
          {/if}
        </section>
      {:else if needsPurchase}
        <section class="content-detail__purchase" aria-labelledby="purchase-label-buy">
          <div class="content-detail__price">
            <span id="purchase-label-buy" class="content-detail__price-amount">{displayPrice(priceCents)}</span>
            <span class="content-detail__price-label">{m.content_detail_purchase_cta_description()}</span>
          </div>

          <!-- MediaLiveRegion widened beyond media surfaces: checkout errors announce
               to AT via the region's nested role="alert" (escalated aria-live=
               "assertive") while the visible banner keeps the existing styling for
               sighted users. The visible banner intentionally has NO role so AT
               doesn't hear the error twice. Codex-wuye8. -->
          <MediaLiveRegion
            error={formResult?.checkoutError ?? null}
            class="content-detail__purchase-error-region"
          >
            {#if formResult?.info || formResult?.alreadyOwned}
              <!-- 409 "already own" → info banner with Play-now CTA (Codex-mmju5) -->
              <div class="content-detail__purchase-info" aria-hidden="true">
                <CheckIcon size={18} class="content-detail__purchase-info-icon" />
                <p class="content-detail__purchase-info-text">
                  {formResult?.info ?? 'You already have access to this content.'}
                </p>
                <a
                  href={page.url.pathname}
                  class="content-detail__purchase-info-action"
                >
                  <PlayIcon size={14} />
                  Play now
                </a>
              </div>
            {:else if formResult?.checkoutError && !errorDismissed}
              <!-- Error banner with dismiss + 3-retry escalation (Codex-8aibi) -->
              <div class="content-detail__purchase-error" aria-hidden="true">
                <div class="content-detail__purchase-error-body">
                  <p class="content-detail__purchase-error-text">{formResult.checkoutError}</p>
                  {#if (formResult?.retryCount ?? 0) >= 3}
                    <p class="content-detail__purchase-error-escalation">
                      Still stuck? <a href="mailto:support@codex.example?subject=Checkout%20help">Contact support</a>.
                    </p>
                  {/if}
                </div>
                <button
                  type="button"
                  class="content-detail__purchase-error-dismiss"
                  onclick={() => (errorDismissed = true)}
                  aria-label="Dismiss error"
                >
                  <XIcon size={14} />
                </button>
              </div>
            {/if}
          </MediaLiveRegion>

          {#if isAuthenticated && purchaseForm}
            {@render purchaseForm()}
          {:else if !isAuthenticated}
            <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
              {m.checkout_signin_to_purchase()}
            </a>
          {/if}

          <!-- What you'll get -->
          <div class="content-detail__benefits">
            <h2 class="content-detail__benefits-heading">{m.content_detail_benefits_heading()}</h2>
            <ul class="content-detail__benefits-list">
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{primaryBenefit}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_lifetime_access()}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_progress_tracking()}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_any_device()}</span>
              </li>
            </ul>
          </div>
        </section>
      {:else if isFree && !isAuthenticated}
        <!--
          Free content + unauthenticated visitor. Body is already readable via
          the public-access policy; the CTA here lets them sign in to play
          the media stream (which still requires auth). Authenticated free
          visitors see no gate — they already have full access.
        -->
        <section class="content-detail__purchase" aria-labelledby="purchase-label-free">
          <div class="content-detail__price">
            <span id="purchase-label-free" class="content-detail__price-amount content-detail__price-amount--free">{m.content_price_free()}</span>
          </div>
          <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
            {content.contentType === 'audio'
              ? m.content_detail_signin_listen_cta()
              : m.content_detail_signin_watch_cta()}
          </a>

          <!-- What you'll get (free content) -->
          <div class="content-detail__benefits">
            <h2 class="content-detail__benefits-heading">{m.content_detail_benefits_heading()}</h2>
            <ul class="content-detail__benefits-list">
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{primaryBenefit}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_lifetime_access()}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_progress_tracking()}</span>
              </li>
              <li class="content-detail__benefits-item">
                <CheckIcon size={16} class="content-detail__benefits-icon" />
                <span>{m.content_detail_benefit_any_device()}</span>
              </li>
            </ul>
          </div>
        </section>
      {/if}
    {/if}

    <!--
      Full "About" section — skipped when the short lede above already
      showed the entire description (avoids duplicate copy). Codex-8i22f.
    -->
    {#if description && !descriptionFullyShownAbove}
      <div class="content-detail__description">
        <h2 class="content-detail__description-heading">{m.content_detail_about()}</h2>
        <p>{description}</p>
      </div>
    {/if}

    {#if contentBodyHtml}
      {#if hasAccess}
        <div class="content-detail__body">
          <ProseContent html={contentBodyHtml} />
        </div>
      {:else if accessLoading}
        <div class="content-detail__body content-detail__body--locked">
          <div class="content-detail__body-skeleton">
            <div class="skeleton skeleton--body-line"></div>
            <div class="skeleton skeleton--body-line skeleton--body-line--short"></div>
          </div>
        </div>
      {:else}
        <!--
          Paywall-masked teaser (Codex-79g3m). Renders the first ~400 chars of
          body with a bottom fade hand-off to the lock CTA — users see real
          value before the purchase ask, instead of a tiny lock box alone.
        -->
        <div class="content-detail__body content-detail__body--locked">
          {#if bodyTeaserParagraphs}
            <div class="content-detail__body-teaser" aria-hidden="true">
              {#each bodyTeaserParagraphs as paragraph, i (i)}
                <p>{paragraph}</p>
              {/each}
            </div>
          {/if}
          <div class="content-detail__body-lock">
            <LockIcon size={24} class="content-detail__body-lock-icon" />
            <p class="content-detail__body-lock-text">{bodyLockText}</p>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</article>

<style>
  .content-detail {
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) var(--space-8);
  }

  /*
    Mobile: reserve bottom padding to clear the fixed MobileBottomNav
    (height = --space-16; see apps/web/src/lib/components/layout/MobileNav/
    MobileBottomNav.svelte). Without this the final CTA or lock card is
    occluded by the nav bar. Codex-ki3m5.
  */
  @media (--below-md) {
    .content-detail {
      padding-bottom: calc(var(--space-16) + env(safe-area-inset-bottom, 0px));
    }
  }

  /* Player / Preview */
  .content-detail__player {
    position: relative;
    width: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-tertiary);
    aspect-ratio: 16 / 9;
    margin-bottom: var(--space-6);
  }

  /* tabindex="-1" lets the page load programmatically move focus here after
     access is granted (e.g. subscribe/follow flow completes). A visible focus
     ring for keyboard users satisfies WCAG 2.4.7 — R14 of the design system. */
  .content-detail__player:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Cinema mode — break out to fill the main content area (viewport minus
     sidebar). Uses --app-sidebar-width (Codex-4g697) so the calc stays
     correct if the rail resizes. The token collapses to 0 below md via
     a media query in layout.css, so no mobile override is needed here. */
  .content-detail__player--cinema {
    --cinema-width: calc(100vw - var(--app-sidebar-width));
    width: var(--cinema-width);
    max-width: none;
    margin-inline: calc(var(--cinema-width) / -2 + 50%);
    border-radius: 0;
    transition:
      border-radius var(--duration-fast) var(--ease-default);
  }

  /* Audio player — sits inline within the info section, not as a hero.
     `min-height` is pinned to `--player-height-audio` so the skeleton →
     live-player swap doesn't shift layout (Codex-qlvth). */
  .content-detail__player--audio {
    aspect-ratio: unset;
    background: transparent;
    margin-bottom: var(--space-4);
    margin-top: var(--space-2);
    min-height: var(--player-height-audio);
  }

  .audio-player-skeleton {
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  /* Skeleton height matches the live AudioPlayer so the skeleton → player
     swap doesn't CLS (Codex-qlvth). The player body composes to ~12rem:
     body padding (2 × --space-5) + waveform (--space-24) + controls row. */
  .skeleton--audio {
    width: 100%;
    height: var(--player-height-audio);
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer calc(var(--duration-slower) * 3) infinite;
    border-radius: var(--radius-lg);
  }

  /* Locked audio preview card (Codex-066ye) — mirrors the video preview
     overlay at the height of the live audio player so the layout doesn't
     collapse above the fold when no stream is available yet. */
  .content-detail__audio-locked {
    position: relative;
    width: 100%;
    min-height: var(--player-height-audio);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-tertiary);
  }

  .content-detail__audio-locked-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .content-detail__audio-locked-overlay {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-6) var(--space-4);
    color: var(--color-text-inverse);
    text-align: center;
    background: linear-gradient(
      to top,
      var(--color-player-overlay-heavy) 0%,
      var(--color-player-overlay) 50%,
      var(--color-player-surface-hover) 100%
    );
  }

  .content-detail__preview {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .content-detail__preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .content-detail__preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      to top,
      var(--color-player-overlay-heavy) 0%,
      var(--color-player-overlay) 50%,
      var(--color-player-surface-hover) 100%
    );
  }

  .content-detail__preview-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-inverse);
    text-align: center;
    padding: var(--space-6);
  }

  :global(.content-detail__lock-icon) {
    opacity: var(--opacity-90);
    margin-bottom: var(--space-1);
    animation: lock-pulse calc(var(--duration-slower) * 4) ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.content-detail__lock-icon) {
      animation: none;
    }
  }

  @keyframes lock-pulse {
    0%, 100% { opacity: var(--opacity-90); }
    50% { opacity: var(--opacity-60); }
  }

  .content-detail__cta-text {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin: 0;
  }

  .content-detail__cta-subtext {
    font-size: var(--text-sm);
    opacity: var(--opacity-80);
    margin: 0;
    max-width: 280px;
  }

  /* Info Section */
  .content-detail__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Two-state layout: preview state has tighter spacing above purchase card */
  .content-detail[data-access="preview"] .content-detail__purchase {
    margin-top: var(--space-2);
  }

  /* Full-access state: more relaxed spacing */
  .content-detail[data-access="full"] .content-detail__info {
    gap: var(--space-5);
  }

  .content-detail__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Fluid title typography (Codex-27w37) — replaces the breakpoint-md jump
     from text-2xl → text-3xl with a continuous clamp so the title scales
     smoothly across viewports instead of snapping at 768px. The token
     endpoints themselves are already clamps, so we pin the floor and
     ceiling and let the middle term interpolate. At ~720px viewport the
     clamp sits near text-2xl's ceiling; at ~1280px it lands at
     text-3xl's ceiling (40px). */
  .content-detail__title {
    font-size: clamp(var(--text-2xl), 2vw + 1rem, var(--text-3xl));
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-snug);
  }

  .content-detail__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .content-detail__badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    background: var(--color-brand-primary-subtle);
    color: var(--color-interactive-active);
    text-transform: var(--text-transform-label, uppercase);
    letter-spacing: var(--tracking-wider);
  }

  .content-detail__duration {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .content-detail__creator {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Short description lede (Codex-8i22f) — sits above the gate CTAs */
  .content-detail__short-description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin: 0;
  }

  /* Creator link styles (used by creator page snippet) */
  :global(.content-detail__creator-link) {
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  :global(.content-detail__creator-link:hover) {
    color: var(--color-interactive);
  }

  .content-detail__completed-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    background: var(--color-success-100);
    color: var(--color-success-700);
    width: fit-content;
  }

  /* Purchase Section (now a <section> — Codex-jo819 O2) */
  .content-detail__purchase {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .content-detail__price {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .content-detail__price-amount {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .content-detail__price-amount--free {
    color: var(--color-success-600);
  }

  .content-detail__price-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Checkout error banner (Codex-8aibi) — dismiss button + optional escalation
     helper after 3 consecutive failures. */
  .content-detail__purchase-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-error-50);
    border: var(--border-width) var(--border-style)
      var(--color-error-200, var(--color-border));
    border-radius: var(--radius-md);
  }

  .content-detail__purchase-error-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .content-detail__purchase-error-text {
    font-size: var(--text-sm);
    color: var(--color-error-600);
    margin: 0;
  }

  .content-detail__purchase-error-escalation {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .content-detail__purchase-error-escalation a {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .content-detail__purchase-error-escalation a:hover {
    color: var(--color-interactive-hover);
  }

  .content-detail__purchase-error-escalation a:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .content-detail__purchase-error-dismiss {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .content-detail__purchase-error-dismiss:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  .content-detail__purchase-error-dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Info banner (409 "already owned" happy-path — Codex-mmju5) */
  .content-detail__purchase-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-info-50, var(--color-surface-secondary));
    border: var(--border-width) var(--border-style)
      var(--color-info-200, var(--color-border));
    border-radius: var(--radius-md);
    flex-wrap: wrap;
  }

  :global(.content-detail__purchase-info-icon) {
    color: var(--color-info-600, var(--color-success-600));
    flex-shrink: 0;
  }

  .content-detail__purchase-info-text {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--color-text);
    margin: 0;
  }

  .content-detail__purchase-info-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    text-decoration: none;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .content-detail__purchase-info-action:hover {
    color: var(--color-interactive-hover);
    background: var(--color-surface-secondary);
  }

  .content-detail__purchase-info-action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .content-detail__or-divider {
    display: block;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-2) 0;
  }

  :global(.content-detail__purchase-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
    background: var(--color-brand-accent);
    color: var(--color-text-inverse);
    text-decoration: none;
    width: 100%;
  }

  :global(.content-detail__purchase-btn:hover:not(:disabled)) {
    background: var(--color-brand-accent-hover);
  }

  :global(.content-detail__purchase-btn:disabled) {
    opacity: var(--opacity-70);
    cursor: not-allowed;
  }

  :global(.content-detail__purchase-btn:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .content-detail__purchase-btn--link {
    text-align: center;
  }

  /* Benefits section — heading promoted to <h2> so page heading order
     stays unbroken (h1 title → h2 benefits/about/description). Codex-jo819 O6. */
  .content-detail__benefits {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__benefits-heading {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-3);
  }

  .content-detail__benefits-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .content-detail__benefits-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  :global(.content-detail__benefits-icon) {
    color: var(--color-success-600);
    flex-shrink: 0;
  }

  /* Description ("About") */
  .content-detail__description {
    margin-top: var(--space-2);
  }

  .content-detail__description-heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }

  .content-detail__description p {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin: 0;
    white-space: pre-line;
  }

  /* Article body (written content) */
  .content-detail__body {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .content-detail__body--locked {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /*
    Paywall teaser mask (Codex-79g3m). Shows the first ~400 chars of the
    body fading into the lock CTA below. mask-image is Baseline-widely
    available; -webkit- prefix kept for older Safari cohorts (Ref 02).
  */
  .content-detail__body-teaser {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-height: calc(var(--space-24) + var(--space-16));
    overflow: hidden;
    -webkit-mask-image: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 1) 40%,
      rgba(0, 0, 0, 0) 100%
    );
    mask-image: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 1) 40%,
      rgba(0, 0, 0, 0) 100%
    );
  }

  .content-detail__body-teaser p {
    margin: 0 0 var(--space-3);
  }

  .content-detail__body-teaser p:last-child {
    margin-bottom: 0;
  }

  .content-detail__body-lock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-4);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  :global(.content-detail__body-lock-icon) {
    color: var(--color-text-muted);
    opacity: var(--opacity-70);
  }

  .content-detail__body-lock-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 320px;
    line-height: var(--leading-relaxed);
  }

  /* Skeleton loading states (access check pending) */
  .content-detail__player-skeleton {
    width: 100%;
    height: 100%;
  }

  .skeleton--player {
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer calc(var(--duration-slower) * 3) infinite;
  }

  .content-detail__body-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
  }

  .skeleton--body-line {
    height: var(--text-base);
    border-radius: var(--radius-sm);
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer calc(var(--duration-slower) * 3) infinite;
    width: 100%;
  }

  .skeleton--body-line--short {
    width: 60%;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Keyframe animations run at full amplitude under reduced-motion because
     motion.css only collapses --duration-* tokens, not @keyframes bodies
     (Ref 05 §Media §5). Silencing only the three shimmers here — not a
     blanket `*` rule — keeps the lock-pulse signal for users who still need
     to see that content is loading. Codex-9xh1k. */
  @media (prefers-reduced-motion: reduce) {
    .skeleton--audio,
    .skeleton--player,
    .skeleton--body-line {
      animation: none;
    }
  }

  /* Responsive — title size is fluid via clamp() above, so no breakpoint
     override is needed here (Codex-27w37). */
  @media (--breakpoint-md) {
    .content-detail {
      padding: var(--space-6) var(--space-6) var(--space-10);
    }

    :global(.content-detail__purchase-btn) {
      width: auto;
    }
  }
</style>
