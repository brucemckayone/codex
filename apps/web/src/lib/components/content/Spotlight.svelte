<!--
  @component Spotlight

  Cinematic feature spread — the first anchor beat on the org landing page.
  A single content item presented at near-full-viewport scale, with an
  asymmetric 60/40 split: image column on the left, glass-panel body column
  on the right (md+). Below `--breakpoint-md` the layout collapses to a
  stacked image-on-top presentation.

  Originally ran a full ShaderHero WebGL canvas here, then a single
  BrandGradientBackdrop atmospheric card; now evolved into a cinematic
  split-screen feature spread that reads more like an editorial cover than
  a product card. The `BrandGradientBackdrop` is retained as the atmospheric
  backdrop — it fills the full card, and both columns layer on top.

  Fixed-white text is used for the body column because it sits on a dark
  glass veil where `--color-player-*` tokens cannot be trusted (orgs can
  rebind them to brand colours via the brand editor, collapsing legibility).
  See `feedback_player_tokens_for_dark_overlays.md` for the full rationale.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { Avatar, AvatarFallback } from '$lib/components/ui/Avatar';
  import { BrandGradientBackdrop } from '$lib/components/ui/BrandGradient';
  import AudioWaveform from '$lib/components/ui/ContentCard/AudioWaveform.svelte';
  import {
    PlayIcon,
    MusicIcon,
    FileTextIcon,
    FilmIcon,
  } from '$lib/components/ui/Icon';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';
  import { formatDurationHuman } from '$lib/utils/format';
  import { extractPlainText } from '@codex/validation';

  interface SpotlightItem {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    thumbnailUrl?: string | null;
    contentType?: 'video' | 'audio' | 'written' | null;
    /**
     * Publication metadata — all optional so callers that haven't wired
     * the full content payload still render the core layout. Each row
     * guards on its own field, no placeholders appear for missing data.
     *
     * `publishedAt` / `viewCount` / `tags` come straight from the Content
     * schema (see `packages/database/src/schema/content.ts`). They arrive
     * as string (SSR JSON serialise) or Date (runtime) — the derivations
     * below handle both.
     */
    publishedAt?: string | Date | null;
    viewCount?: number | null;
    tags?: string[] | null;
    mediaItem?: {
      durationSeconds?: number | null;
      /**
       * Resolved CDN URL for the 30-second HLS preview clip. The public
       * content API surfaces this on `mediaItem` (see PublicContentItem in
       * `@codex/content`). Used to power hover/focus preview playback on
       * video content — lazy-attached on first hover to avoid burning
       * bandwidth on every landing-page visit.
       */
      hlsPreviewUrl?: string | null;
    } | null;
    creator?: {
      name?: string | null;
    } | null;
  }

  interface Props {
    item: SpotlightItem;
  }

  const { item }: Props = $props();

  const titleId = $derived(`spotlight-${item.id}`);
  const href = $derived(buildContentUrl(page.url, { id: item.id, slug: item.slug }));
  const thumbnail = $derived(item.thumbnailUrl ?? null);
  const description = $derived(
    item.description ? extractPlainText(item.description) : ''
  );
  const durationSeconds = $derived(item.mediaItem?.durationSeconds ?? null);
  const creatorName = $derived(item.creator?.name ?? '');

  const contentType = $derived(item.contentType ?? 'video');
  const ctaLabel = $derived(
    contentType === 'audio'
      ? 'Listen now'
      : contentType === 'written'
        ? 'Read now'
        : 'Watch now'
  );

  // ── Publication metadata ──────────────────────────────────────
  // Each derivation returns `null` when its source field is missing —
  // the template guards with `{#if}` so no placeholder appears for
  // absent data. Dates are serialised as strings through SSR; normalise
  // via `new Date()` before passing to the formatter.
  const publishedLabel = $derived.by(() => {
    if (!item.publishedAt) return null;
    const date = item.publishedAt instanceof Date
      ? item.publishedAt
      : new Date(item.publishedAt);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  });

  // Only surface view counts > 0 — a zero-view anchor piece reads as
  // noise on a fresh post. Compact notation (`1.2K`, `3.4M`) keeps the
  // meta row tight.
  const viewsLabel = $derived.by(() => {
    const count = item.viewCount;
    if (typeof count !== 'number' || count <= 0) return null;
    const formatted = new Intl.NumberFormat('en-GB', {
      notation: 'compact',
    }).format(count);
    return `${formatted} views`;
  });

  // Cap tag strip at 3 so it complements rather than dominates. Filter
  // defensively — the DB column is `jsonb`, so malformed rows could in
  // theory surface null / non-string entries.
  const topTags = $derived(
    Array.isArray(item.tags)
      ? item.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .slice(0, 3)
      : []
  );

  // Track which thumbnails failed to load (by URL). Derive `hasImage` so
  // swapping `item.thumbnailUrl` (e.g. via prop change) automatically
  // re-evaluates without an $effect writing back to $state (antipattern).
  // Keyed on URL rather than a boolean so a later success-URL swap can
  // still render without clearing the set.
  const failedThumbnails = $state(new Set<string>());
  const hasImage = $derived(
    !!thumbnail && !failedThumbnails.has(thumbnail)
  );

  // When a typed item arrives without a usable thumbnail, fill the image
  // column with a per-type signature instead of letting the grid collapse
  // to a single column over a flat brand gradient. Audio gets the
  // AudioWaveform tile; video gets a live HLS preview when one is
  // available, otherwise a static FilmIcon. Written content has no image
  // fallback — it canonically falls through to the body-text-led layout
  // (mirrors ContentCard's behaviour where the thumb is hidden entirely
  // for thumbless articles). Each signature is FNV-1a-deterministic or
  // static, so SSR and client hydration produce identical markup.
  const hasAudioSignature = $derived(!hasImage && contentType === 'audio');
  const hasVideoSignature = $derived(!hasImage && contentType === 'video');

  // ── Preview media on hover/focus ───────────────────────────────
  // Only video content with a resolved preview URL is eligible. Audio and
  // written content types fall back to thumbnail-only — audio gets a
  // `:hover` brightness nudge via CSS (see `.spotlight__image-still`
  // brightness filter below); written is static.
  //
  // The `<video>` element is kept in the DOM but with NO `src` attribute
  // until the user actually hovers/focuses — this avoids burning bandwidth
  // on every page render. After the first attach, the source persists so
  // subsequent hovers don't re-download.
  //
  // Reduced-motion users get no hover preview and no cross-fade; the
  // `@media (prefers-reduced-motion: reduce)` block below kills both.
  const previewUrl = $derived(item.mediaItem?.hlsPreviewUrl ?? null);
  const canPreview = $derived(contentType === 'video' && !!previewUrl);
  let previewAttached = $state(false);
  let previewActive = $state(false);
  let previewEl = $state<HTMLVideoElement | null>(null);

  // ── Slide-active preview activation ────────────────────────────
  // When the spotlight is wrapped in a Carousel, the user expects the
  // currently-visible slide's preview to autoplay (not just on hover) —
  // this is the "auto-playing HLS preview when slide is active" behaviour
  // confirmed in the plan. An IntersectionObserver on the card element
  // fires `slideActive=true` once ≥60% of the card is in the viewport,
  // and `previewVisible` ORs that with the existing hover/focus state so
  // both pathways work. Threshold 0.6 (not 0.5) avoids ambiguous mid-snap
  // states where two slides briefly each show ~50%.
  //
  // Reduced-motion users opt out of slide-active activation entirely —
  // the IO is never bound. They can still trigger preview on explicit
  // hover/focus, which is a deliberate gesture rather than ambient motion.
  let cardEl = $state<HTMLElement | null>(null);
  let slideActive = $state(false);

  $effect(() => {
    if (!canPreview || !cardEl) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        slideActive = entry.intersectionRatio >= 0.6;
        if (slideActive) {
          previewAttached = true;
          queueMicrotask(() => {
            previewEl?.play().catch(() => {});
          });
        } else if (!previewActive) {
          // Only pause when the user isn't ALSO hovering — hover takes
          // precedence over carousel-active so hover-then-scroll keeps
          // the preview running.
          previewEl?.pause();
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(cardEl);
    return () => observer.disconnect();
  });

  // Combined visibility — preview shows when either the user is actively
  // engaging (hover/focus) OR the carousel has paged the slide into view.
  // Both pathways gate on `canPreview`, so audio/article never reach this
  // and `<video>` is only rendered for video content.
  const previewVisible = $derived(
    canPreview && (previewActive || slideActive)
  );

  function handlePreviewEnter() {
    if (!canPreview) return;
    previewAttached = true;
    previewActive = true;
    // `play()` queues until `canplay`. Ignore the promise rejection —
    // autoplay policies can block muted playback on some platforms, and
    // when that happens the still stays visible (the cross-fade is gated
    // on `data-visible=true` but opacity only lifts when `previewActive`
    // is set — which we already set above).
    queueMicrotask(() => {
      previewEl?.play().catch(() => {});
    });
  }

  function handlePreviewLeave() {
    if (!canPreview) return;
    previewActive = false;
    // Pause (don't unload) so returning to the card snaps back quickly.
    // The browser keeps the buffered preview in memory while the card
    // is still mounted. Skip the pause when slide-active is true — the
    // carousel still considers this the visible slide, so the preview
    // should keep playing even after the cursor leaves.
    if (!slideActive) {
      previewEl?.pause();
    }
  }
</script>

<section
  class="spotlight"
  aria-labelledby={titleId}
  data-content-type={contentType}
  data-has-image={hasImage}
  data-has-audio-fallback={hasAudioSignature}
  data-has-video-fallback={hasVideoSignature}
>
  <div class="spotlight__container">
    <article
      class="spotlight__card"
      bind:this={cardEl}
      onpointerenter={handlePreviewEnter}
      onpointerleave={handlePreviewLeave}
      onfocusin={handlePreviewEnter}
      onfocusout={handlePreviewLeave}
    >
      <!-- Brand gradient backdrop fills the card. Positioned absolutely
           below the content layer. The card's border-radius clips the
           gradient so it appears naturally framed. Cheap CSS replacement
           for the earlier ShaderHero — see component docblock for why. -->
      <BrandGradientBackdrop
        variant="spotlight"
        class="spotlight__card-shader"
      />
      <div class="spotlight__card-veil" aria-hidden="true"></div>

      <!-- Content layer — always above the shader/veil -->
      <div class="spotlight__content">
        {#if hasImage && thumbnail}
          <a
            class="spotlight__image"
            {href}
            tabindex="-1"
            aria-hidden="true"
            data-preview-active={previewVisible}
            data-audio-overlay={contentType === 'audio'}
          >
            <img
              class="spotlight__image-still"
              src={thumbnail}
              srcset={getThumbnailSrcset(thumbnail)}
              sizes={DEFAULT_SIZES}
              alt=""
              loading="eager"
              decoding="async"
              onerror={() => {
                if (thumbnail) failedThumbnails.add(thumbnail);
              }}
            />

            {#if canPreview}
              <!-- Lazy-attached preview video. Element stays mounted so the
                   cross-fade has a target, but `src` only sets once the
                   user hovers OR the carousel pages this slide into view —
                   avoids prefetching ~2MB of HLS for every landing-page
                   visit. The `preload="none"` + no-src-pre-activation combo
                   keeps the idle network silent. -->
              <video
                bind:this={previewEl}
                class="spotlight__preview-video"
                src={previewAttached ? (previewUrl ?? undefined) : undefined}
                loop
                muted
                playsinline
                preload="none"
                aria-hidden="true"
                tabindex="-1"
                data-visible={previewVisible}
              ></video>
            {/if}

            {#if contentType === 'audio'}
              <!--
                Audio-with-thumbnail overlay. The thumbnail becomes
                atmospheric backdrop (object-fit: cover + dimming gradient
                via CSS) and the waveform overlays as the primary type
                signal. Same `currentColor` (fixed white) treatment as the
                no-thumb fallback so the bars stay legible against any
                photo. Without this, the thumb sat letterboxed in a sea
                of black — see commit history / image-backdrop iteration
                for context.
              -->
              <div class="spotlight__waveform" aria-hidden="true">
                <AudioWaveform id={item.id} variant="thumb" />
              </div>
              <span class="spotlight__type-chip">
                <MusicIcon size={14} aria-hidden="true" />
                <span>Audio</span>
              </span>
            {/if}
          </a>
        {:else if hasAudioSignature}
          <!--
            Audio-without-thumbnail fallback. Mirrors the structure of the
            image column (anchor + absolutely-positioned visual + label) so
            the 60/40 grid keeps its rhythm. The waveform inherits
            `currentColor` from `.spotlight__image--audio`, which is bound
            to a fixed-white token — `--color-player-*` is unsafe here for
            the same reason the body column uses fixed white (see
            feedback_player_tokens_for_dark_overlays). The `MUSIC` chip is
            decorative reinforcement; the eyebrow + CTA already announce
            audio semantically.
          -->
          <a
            class="spotlight__image spotlight__image--audio"
            {href}
            tabindex="-1"
            aria-hidden="true"
          >
            <div class="spotlight__waveform" aria-hidden="true">
              <AudioWaveform id={item.id} variant="thumb" />
            </div>
            <span class="spotlight__type-chip">
              <MusicIcon size={14} aria-hidden="true" />
              <span>Audio</span>
            </span>
          </a>
        {:else if hasVideoSignature}
          <!--
            Video-without-thumbnail fallback. Two sub-branches:
            (1) `canPreview` — render the same lazy `<video>` element used
                in the thumbnailed path. The IntersectionObserver above
                attaches the source on slide-active or hover. The element
                stretches to fill the column (`object-fit: cover`) so the
                fallback reads cinematically rather than letterboxed.
            (2) No previewUrl — render a static FilmIcon centred over the
                same brand radial gradient as the audio fallback, with a
                "WATCH" chip in the bottom-left. FilmIcon is the codebase's
                canonical motion-cell signature (used in studio media
                library, content kind-lines).
            Both sub-branches preserve the 60/40 grid via the
            `data-has-video-fallback='true'` attribute on `<section>`.
          -->
          <a
            class="spotlight__image spotlight__image--video"
            {href}
            tabindex="-1"
            aria-hidden="true"
            data-preview-active={previewVisible}
          >
            <!-- Static FilmIcon "still" — always rendered for video
                 fallback, even when canPreview is true. The preview video
                 (when present) crossfades over this still on slide-active
                 or hover; crossfading back leaves the FilmIcon visible
                 instead of an empty column. Mirrors the thumb + video
                 crossfade pattern in the thumbnailed branch. -->
            <span class="spotlight__video-icon" aria-hidden="true">
              <FilmIcon size={48} />
            </span>
            {#if canPreview}
              <video
                bind:this={previewEl}
                class="spotlight__preview-video"
                src={previewAttached ? (previewUrl ?? undefined) : undefined}
                loop
                muted
                playsinline
                preload="none"
                aria-hidden="true"
                tabindex="-1"
                data-visible={previewVisible}
              ></video>
            {/if}
            <span class="spotlight__type-chip">
              <PlayIcon size={14} aria-hidden="true" />
              <span>Watch</span>
            </span>
          </a>
        {/if}

        <div class="spotlight__body">
          <div class="spotlight__body-inner">
            <p class="spotlight__eyebrow">Editor&rsquo;s pick</p>

            <h2 class="spotlight__title" id={titleId}>
              <a class="spotlight__title-link" {href}>{item.title}</a>
            </h2>

            {#if description}
              <p class="spotlight__description">{description}</p>
            {/if}

            {#if topTags.length > 0}
              <ul class="spotlight__tags" aria-label="Tags">
                {#each topTags as tag (tag)}
                  <li class="spotlight__chip spotlight__chip--tag">{tag}</li>
                {/each}
              </ul>
            {/if}

            {#if creatorName || publishedLabel || durationSeconds || viewsLabel}
              <div class="spotlight__meta">
                {#if creatorName}
                  <div class="spotlight__creator">
                    <Avatar class="spotlight__avatar">
                      <AvatarFallback>
                        {creatorName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span class="spotlight__creator-name">{creatorName}</span>
                  </div>
                {/if}

                {#if publishedLabel}
                  <span class="spotlight__meta-item">{publishedLabel}</span>
                {/if}

                {#if durationSeconds}
                  <span class="spotlight__chip">
                    {formatDurationHuman(durationSeconds)}
                  </span>
                {/if}

                {#if viewsLabel}
                  <span class="spotlight__meta-item">{viewsLabel}</span>
                {/if}
              </div>
            {/if}

            <a class="spotlight__cta" {href}>
              {#if contentType === 'audio'}
                <MusicIcon size={20} />
              {:else if contentType === 'written'}
                <FileTextIcon size={20} />
              {:else}
                <PlayIcon size={20} />
              {/if}
              <span>{ctaLabel}</span>
            </a>
          </div>
        </div>
      </div>
    </article>
  </div>
</section>

<style>
  .spotlight {
    position: relative;
    display: grid;
    place-items: center;
    padding-block: var(--space-12);
    padding-inline: var(--space-4);
  }

  .spotlight__container {
    width: 100%;
    max-width: var(--container-max, 1280px);
    margin-inline: auto;
  }

  /* ── Card ─────────────────────────────────────────────────────
     Cinematic min-height — `min(80vh, 720px)` keeps the spread
     viewport-responsive but caps it at 720px on tall displays so
     it doesn't swallow the rest of the page on ultrawides.
     Stacked layout below md (image on top, body below). 60/40
     split above md via `3fr 2fr` — the 3fr image column gives the
     thumbnail its full cinema rectangle.
     ───────────────────────────────────────────────────────────── */
  .spotlight__card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    max-width: calc(var(--space-24) * 10);
    margin-inline: auto;
    /* Fixed-alpha white border at 10% — matches SubscribeCTA's panel so
       the two promotional surfaces read as a pair. Using `--color-border`
       would drift with theme + org brand; using `--color-player-border`
       would drift with org `--brand-player-border` overrides. */
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.1);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    isolation: isolate;
    min-height: min(80vh, 720px);
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      border-color var(--duration-fast) var(--ease-default);
  }

  @media (--breakpoint-md) {
    .spotlight__card {
      /* 60/40 split — image claims the larger rectangle, body column
         the tighter reading space. `minmax(0, ...)` on both tracks
         prevents long titles from blowing out the body column. */
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    }

    /* When the content item has no usable thumbnail, drop the image
       column entirely — body takes the full card width, the shader is
       unobstructed. Avoids an awkward empty frame.
       Exception: audio AND video items render their own type signature
       into the image column (see `.spotlight__image--audio` /
       `.spotlight__image--video`), so the 60/40 split must survive even
       though `data-has-image='false'`. Written items intentionally fall
       through and become full-width text-led — the article identity in
       this codebase is text-as-media (mirrors ContentCard's display:none
       on .cc__thumb for thumbless articles). */
    .spotlight[data-has-image='false']:not([data-has-audio-fallback='true']):not(
        [data-has-video-fallback='true']
      )
      .spotlight__card {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .spotlight__card:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    box-shadow:
      var(--shadow-xl),
      0 0 0 var(--border-width-thick)
        color-mix(in srgb, var(--color-interactive) 24%, transparent);
    border-color: color-mix(in srgb, var(--color-interactive) 32%, transparent);
  }

  /* Brand gradient backdrop sits behind veil + content. BrandGradientBackdrop
     already supplies `position: absolute; inset: 0; pointer-events: none;
     overflow: hidden`, so we only need to pin its stacking context inside
     the card. Class is forwarded onto the component's root div, so we target
     the forwarded class via :global() to reach it from this scoped style. */
  :global(.spotlight__card-shader) {
    z-index: 0;
  }

  /* Veil — sits between shader and content. The card uses a dedicated
     LIGHT-ON-DARK treatment (fixed white text), so the veil establishes
     a consistent dark floor behind the copy regardless of which shader
     preset the org picked. `hsl(0 0% 0% / α)` matches the token pattern
     in player.css — expressing "neutral dark overlay at specific alpha"
     without inventing a new token family. */
  .spotlight__card-veil {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    /* Narrow-viewport default — vertical darken, matches the stacked layout */
    background: linear-gradient(
      180deg,
      hsl(0 0% 0% / 0.25) 0%,
      hsl(0 0% 0% / 0.60) 100%
    );
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  @media (--breakpoint-md) {
    /* Split-screen veil — keeps the image column relatively clear so the
       photograph breathes, then darkens sharply into the right column
       where the glass panel lives. The glass panel's own backdrop blur
       stacks with this for the rich "dark-cinema" look. */
    .spotlight__card-veil {
      background: linear-gradient(
        90deg,
        hsl(0 0% 0% / 0.15) 0%,
        hsl(0 0% 0% / 0.25) 55%,
        hsl(0 0% 0% / 0.55) 100%
      );
    }
  }

  /* Content sits above shader + veil */
  .spotlight__content {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    gap: 0;
    align-items: stretch;
  }

  /* ── Image column ──────────────────────────────────────────────
     Fills the column — no aspect-ratio lock, no border-radius on
     stacked (md-below) view, so the image meets the card edge.
     On md+ it takes the full cinema rectangle on the left.
     ────────────────────────────────────────────────────────────── */
  .spotlight__image {
    position: relative;
    overflow: hidden;
    background: transparent;
    display: block;
    text-decoration: none;
    /* Default (stacked) — reserve some vertical space but let the body
       decide the final height. Acceptable because the card's min-height
       pushes the image past this minimum. */
    min-height: calc(var(--space-24) * 4);
  }

  @media (--breakpoint-md) {
    .spotlight__image {
      min-height: 0;
      height: 100%;
    }
  }

  /* Audio thumbnail behaviour: image becomes atmospheric backdrop, the
     waveform overlay carries the type signal. We deliberately do NOT
     letterbox here — podcast thumbs are often 16:9 photos that turn
     into a thin band of pixels in a black sea when contained. Cover
     fills the column; the dimming gradient + waveform overlay do the
     work of "this is audio, not a tiny photo". */
  .spotlight__image[data-audio-overlay='true']::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    /* Soft radial vignette darkens the image centre so the waveform
       has guaranteed contrast regardless of what the photo contains.
       Edge tones stay legible too — we don't fully blanket the image. */
    background: radial-gradient(
      ellipse at center,
      hsl(0 0% 0% / 0.55) 0%,
      hsl(0 0% 0% / 0.35) 60%,
      hsl(0 0% 0% / 0.45) 100%
    );
  }

  .spotlight__image[data-audio-overlay='true'] .spotlight__image-still {
    /* Mute the photo's saturation/brightness so colours don't fight the
       white waveform on top. Recovers slightly on hover (audio-row
       pattern) so the image still has interactive warmth. */
    filter: saturate(0.7) brightness(0.85);
  }

  /* When the waveform overlays a thumbnail, fix its colour to white +
     position it on top of both image and vignette. The fallback (no
     thumb) variant uses the same .spotlight__waveform class but its
     parent .spotlight__image--audio sets the colour and place-items
     centring; here we have to do the centring ourselves because the
     image is positioned absolutely beneath. */
  .spotlight__image[data-audio-overlay='true'] .spotlight__waveform {
    position: absolute;
    inset: 0;
    margin: auto;
    z-index: 3;
    /* 60/55% matches the no-thumb fallback so the waveform reads at the
       same scale across both states. */
    width: min(60%, 24rem);
    height: 50%;
    color: hsl(0 0% 100%);
  }

  .spotlight__image-still {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    transition:
      transform var(--duration-slower) var(--ease-smooth),
      filter var(--duration-default) var(--ease-default);
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .spotlight__card:hover .spotlight__image-still {
    transform: scale(var(--card-image-hover-scale, 1.05));
  }

  /* Audio hover — soften the dim, warm the photo, and lift the waveform
     scale slightly. Composing all three filters means the hover state
     keeps the "image as backdrop, waveform as subject" hierarchy — we
     never let the photo jump back to full saturation under the bars. */
  .spotlight__image[data-audio-overlay='true']:hover .spotlight__image-still,
  .spotlight__card:hover .spotlight__image[data-audio-overlay='true'] .spotlight__image-still {
    filter: saturate(0.85) brightness(0.95);
  }

  .spotlight__image[data-audio-overlay='true']:hover .spotlight__waveform,
  .spotlight__card:hover .spotlight__image[data-audio-overlay='true'] .spotlight__waveform {
    transform: scale(1.03);
  }

  /* ── Audio fallback (no thumbnail) ─────────────────────────────
     Replaces the missing album-art tile with a waveform signature so
     the spotlight still reads as audio rather than an empty gradient
     panel. Fixed-white currentColor for parity with the body column —
     see feedback_player_tokens_for_dark_overlays. The `radial-gradient`
     adds a soft brand glow under the waveform so the frame doesn't read
     as a flat colour-block on dark-branded orgs (see
     feedback_css_gradient_dark_brand for why pure brand-mix gradients
     can collapse to invisible). */
  .spotlight__image--audio {
    display: grid;
    place-items: center;
    color: hsl(0 0% 100%);
    background:
      radial-gradient(
        ellipse at center,
        color-mix(
          in oklab,
          var(--color-brand-primary, var(--color-primary-500)) 18%,
          transparent
        ),
        transparent 70%
      );
  }

  .spotlight__waveform {
    position: relative;
    z-index: 1;
    width: min(70%, 28rem);
    height: 55%;
    /* Soft drop-shadow lifts the bars off the gradient on light shaders. */
    filter: drop-shadow(0 var(--space-1) var(--space-3) hsl(0 0% 0% / 0.35));
    transition: transform var(--duration-slow) var(--ease-smooth);
  }

  .spotlight__card:hover .spotlight__waveform {
    transform: scale(1.03);
  }

  /* ── Video fallback (no thumbnail, with or without preview URL) ──
     Same atmospheric backdrop as the audio fallback — radial brand glow
     over a fixed-white-text surface — so the two type fallbacks read as
     one family. The static FilmIcon stands in as the "still" image; if
     the item has an HLS preview URL, the preview-video element overlays
     this and crossfades on slide-active/hover (see .spotlight__preview-
     video below). When no preview URL exists, the FilmIcon alone is the
     full audio-equivalent waveform-tile signature. */
  .spotlight__image--video {
    display: grid;
    place-items: center;
    color: hsl(0 0% 100%);
    background:
      radial-gradient(
        ellipse at center,
        color-mix(
          in oklab,
          var(--color-brand-primary, var(--color-primary-500)) 18%,
          transparent
        ),
        transparent 70%
      );
  }

  .spotlight__video-icon {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--space-16);
    height: var(--space-16);
    color: hsl(0 0% 100% / 0.5);
    /* Soft drop-shadow lifts the icon off the gradient on light shaders,
       matching the audio waveform's elevation cue. */
    filter: drop-shadow(0 var(--space-1) var(--space-3) hsl(0 0% 0% / 0.35));
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      color var(--duration-default) var(--ease-default);
  }

  .spotlight__card:hover .spotlight__video-icon {
    transform: scale(1.04);
    color: hsl(0 0% 100% / 0.7);
  }

  /* Decorative chip mirrors the spotlight body's meta chips so the type
     fallback feels of-a-piece with the rest of the card. Sits in the
     bottom-left of the image column, identical placement to where a
     duration chip would be on a video card. Shared between audio and
     video fallbacks — both render the same chip shape with their own
     icon + label ("Audio" / "Watch"). */
  .spotlight__type-chip {
    position: absolute;
    z-index: 3;
    bottom: var(--space-4);
    left: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: hsl(0 0% 100%);
    background: hsl(0 0% 0% / 0.45);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.12);
    border-radius: var(--radius-full);
    line-height: var(--leading-tight);
  }

  /* ── Preview video (hover/focus only, video contentType) ───────
     Crossfades over the still once `data-visible=true` lands. Stays
     mounted and `preload=none` so first-frame decode cost happens at
     hover time, not page load. The reduced-motion block below kills
     the fade entirely. */
  .spotlight__preview-video {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-slow) var(--ease-smooth);
  }

  .spotlight__preview-video[data-visible='true'] {
    opacity: 1;
  }

  /* ── Body column (glass panel, md+) ────────────────────────────
     Below md it's a plain column on top of the dark veil — no glass
     framing needed, since the card already reads as the panel.
     At md+ it becomes a glass-veil inset block, letting the image
     column breathe at its full cinema rectangle.
     ────────────────────────────────────────────────────────────── */
  .spotlight__body {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: var(--space-8) var(--space-6);
  }

  @media (--breakpoint-md) {
    .spotlight__body {
      padding: var(--space-6);
    }

    /* Glass panel — only painted on md+ where the split-screen reveals
       the atmospheric backdrop behind it. The inset margin pulls the
       panel away from the card edge so the gradient peeks around it,
       reinforcing the "feature spread" feel. */
    .spotlight__body::before {
      content: '';
      position: absolute;
      inset: var(--space-4);
      background: hsl(0 0% 0% / 0.35);
      backdrop-filter: blur(var(--blur-xl));
      -webkit-backdrop-filter: blur(var(--blur-xl));
      border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.08);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      pointer-events: none;
      z-index: 0;
    }

    .spotlight__body-inner {
      position: relative;
      z-index: 1;
      padding: var(--space-6);
    }
  }

  .spotlight[data-has-image='false'] .spotlight__body {
    max-width: 60ch;
    margin-inline: auto;
    text-align: center;
  }

  .spotlight[data-has-image='false'] .spotlight__body-inner {
    align-items: center;
  }

  .spotlight__body-inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    justify-content: center;
    min-width: 0;
    width: 100%;
  }

  .spotlight__eyebrow {
    margin: 0;
    font-family: var(--font-body, var(--font-sans));
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    /* Brand tint lifted against fixed white — can't mix against
       `--color-player-text` because orgs can rebind that token to a
       brand colour via `--brand-player-text`, collapsing the mix to a
       single hue that may match the shader behind the card. */
    color: color-mix(in srgb, var(--color-interactive) 65%, hsl(0 0% 100%) 35%);
    line-height: var(--leading-tight);
  }

  .spotlight__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    /* Cinematic scale — fluid between mobile (2rem) and desktop (3.5rem).
       Scaled down from the original 6vw/5rem spec because the title lives
       in the 40% body column on desktop (≈500px wide); 5rem on a single
       unbreakable word (org-generated test slugs like "geargaegaerg")
       overflowed the column. Still reads as a cover line, not a card. */
    font-size: clamp(2rem, 3.2vw, 3.5rem);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    /* Force long unbreakable words (test data + real-world long titles)
       to wrap mid-word rather than overflow the column. `overflow-wrap`
       is the modern spelling; `word-break: break-word` is legacy Safari. */
    overflow-wrap: anywhere;
    word-break: break-word;
    hyphens: auto;
    /* Fixed white — shader backdrop + dark veil make this a promotional
       light-on-dark poster where the title MUST stay white regardless of
       org brand. Can't rely on `--color-player-text` here because
       org-brand.css lets orgs rebind it via `--brand-player-text`
       (of-blood-and-bones sets it to their brand red, which matches the
       shader and renders the title invisible). Same reasoning as the
       `hsl(0 0% 0% / α)` veil — an explicit neutral is the right tool
       when the cascade can't guarantee legibility. */
    color: hsl(0 0% 100%);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .spotlight__title-link {
    color: inherit;
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .spotlight__title-link:hover {
    /* Lift the brand tint on hover — soft, not a flash. Mix against fixed
       white for the same reason as the eyebrow (player-text is
       org-overridable). */
    color: color-mix(in srgb, var(--color-interactive) 45%, hsl(0 0% 100%) 55%);
  }

  .spotlight__title-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }

  .spotlight__description {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    /* Secondary white at 80% alpha — same reason as the title: fixed
       neutral because the org-overridable player-text family can collapse
       to brand colours that don't contrast against the shader. */
    color: hsl(0 0% 100% / 0.8);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Tags ──────────────────────────────────────────────────── */

  .spotlight__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  /* ── Meta (creator + date + duration + views) ──────────────── */

  .spotlight__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-1);
  }

  .spotlight__creator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  :global(.spotlight__avatar) {
    height: var(--space-8);
    width: var(--space-8);
    font-size: var(--text-xs);
  }

  .spotlight__creator-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: hsl(0 0% 100% / 0.85);
  }

  /* Non-chip meta rows (date, views) — lighter weight than the duration
     pill so the eye lands on the duration when it's present. */
  .spotlight__meta-item {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    color: hsl(0 0% 100% / 0.65);
  }

  .spotlight__chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    /* White chip chrome — explicit fixed values because the player-*
       tokens are org-overridable (see title comment above). */
    color: hsl(0 0% 100%);
    background: hsl(0 0% 100% / 0.1);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    border: var(--border-width) var(--border-style)
      hsl(0 0% 100% / 0.2);
    border-radius: var(--radius-full);
  }

  /* Tag chips — nudge the casing + tracking so the strip reads as a
     metadata row, not a button group. Same chip chrome as the duration
     pill so the meta level reads as a consistent rail. */
  .spotlight__chip--tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    font-size: calc(var(--text-xs) * 0.9);
  }

  /* ── CTA (anchor styled as primary button) ─────────────────── */

  .spotlight__cta {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: 0 var(--space-6);
    height: var(--space-12);
    font-family: var(--font-sans);
    /* Bumped to semibold + text-lg so text-on-brand reaches WCAG AA
       large-text threshold (3:1). `--color-text-on-brand` is the
       luminance-clamped token that auto-inverts against --brand-color —
       it already accounts for dark vs light brand palettes. */
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    text-decoration: none;
    white-space: nowrap;
    box-shadow: var(--shadow-md);
    transition:
      background-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default),
      box-shadow var(--duration-fast) var(--ease-default);
  }

  .spotlight__cta:hover {
    background: var(--color-interactive-hover);
    transform: translateY(calc(-1 * var(--space-0-5)));
    box-shadow: var(--shadow-lg);
  }

  .spotlight__cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Reveal motion ─────────────────────────────────────────── */

  @media (prefers-reduced-motion: no-preference) {
    .spotlight__card {
      opacity: 0;
      transform: translateY(var(--space-4));
      animation: spotlight-in var(--duration-slower) var(--ease-out) 120ms forwards;
    }
  }

  @keyframes spotlight-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spotlight__card,
    .spotlight__image-still,
    .spotlight__preview-video,
    .spotlight__cta {
      transition: none;
    }

    /* Respect reduced-motion — no hover preview, no cross-fade.
       The video element stays in the DOM (so its bind:this still
       lands) but the opacity rule above never lifts. */
    .spotlight__preview-video[data-visible='true'] {
      opacity: 0;
    }
  }
</style>
