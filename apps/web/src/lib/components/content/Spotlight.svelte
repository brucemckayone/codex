<!--
  @component Spotlight

  Hero-sized anchor section that features one content item. The shader
  backdrop sits INSIDE the content card — the card itself is the shader
  surface, with a soft legibility veil and the content (image, copy, CTA)
  layered on top. The section around the card keeps the page's natural
  background so we never stack two WebGL contexts one over the other.

  Used once per org landing page as the first anchor beat below the main
  hero. Reuses ShaderHero (which inherits the org's configured preset via
  CSS custom properties) so per-card shader selection is free.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { PlayIcon, MusicIcon, FileTextIcon } from '$lib/components/ui/Icon';
  import { ShaderHero } from '$lib/components/ui/ShaderHero';
  import type { ShaderPresetId } from '$lib/components/ui/ShaderHero/shader-config';
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
    mediaItem?: { durationSeconds?: number | null } | null;
    creator?: {
      username?: string | null;
      displayName?: string | null;
      avatar?: string | null;
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
  const creatorName = $derived(
    item.creator?.displayName ?? item.creator?.username ?? ''
  );

  const contentType = $derived(item.contentType ?? 'video');
  const ctaLabel = $derived(
    contentType === 'audio'
      ? 'Listen now'
      : contentType === 'written'
        ? 'Read now'
        : 'Watch now'
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

  /**
   * Pick a shader preset for the card's backdrop. Prefer the org's own
   * choice so the Spotlight feels continuous with the main hero; fall
   * back to `ether` when the org hasn't configured one so the card still
   * feels alive instead of collapsing to a flat pane.
   */
  const FALLBACK_PRESET: ShaderPresetId = 'ether';
  let resolvedPreset = $state<ShaderPresetId>(FALLBACK_PRESET);

  onMount(() => {
    if (!browser) return;
    const orgLayout = document.querySelector('.org-layout');
    if (!orgLayout) return;
    const orgPreset = getComputedStyle(orgLayout)
      .getPropertyValue('--brand-shader-preset')
      .trim();
    if (orgPreset && orgPreset !== 'none') {
      resolvedPreset = orgPreset as ShaderPresetId;
    }
  });
</script>

<section
  class="spotlight"
  aria-labelledby={titleId}
  data-content-type={contentType}
  data-has-image={hasImage}
>
  <div class="spotlight__container">
    <article class="spotlight__card">
      <!-- Shader fills the card. Positioned absolutely below the content
           layer. The card's border-radius clips the canvas so the shader
           appears naturally framed. -->
      <div class="spotlight__card-shader" aria-hidden="true">
        <ShaderHero preset={resolvedPreset} />
      </div>
      <div class="spotlight__card-veil" aria-hidden="true"></div>

      <!-- Content layer — always above the shader/veil -->
      <div class="spotlight__content">
        {#if hasImage && thumbnail}
          <a class="spotlight__image" {href} tabindex="-1" aria-hidden="true">
            <img
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
          </a>
        {/if}

        <div class="spotlight__body">
          <p class="spotlight__eyebrow">Editor&rsquo;s pick</p>

          <h2 class="spotlight__title" id={titleId}>
            <a class="spotlight__title-link" {href}>{item.title}</a>
          </h2>

          {#if description}
            <p class="spotlight__description">{description}</p>
          {/if}

          <div class="spotlight__meta">
            {#if creatorName}
              <div class="spotlight__creator">
                <Avatar class="spotlight__avatar">
                  <AvatarImage
                    src={item.creator?.avatar ?? undefined}
                    alt={creatorName}
                  />
                  <AvatarFallback>
                    {creatorName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span class="spotlight__creator-name">{creatorName}</span>
              </div>
            {/if}

            {#if durationSeconds}
              <span class="spotlight__chip">
                {formatDurationHuman(durationSeconds)}
              </span>
            {/if}
          </div>

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
     The card IS the shader surface. Everything else (thumbnail,
     body, CTA) layers on top. overflow:hidden + border-radius
     clips the shader to the card's shape. isolation:isolate
     creates a stacking context so z-index is local to the card.
     ───────────────────────────────────────────────────────────── */
  .spotlight__card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    max-width: calc(var(--space-24) * 10);
    margin-inline: auto;
    padding: var(--space-6);
    /* --color-player-border mixed at 50% alpha matches SubscribeCTA's
       panel border — both are rounded light-on-dark promotional
       surfaces so they share the same edge treatment. Using
       `--color-border` (semantic/theme-adaptive) would diverge on
       dark-theme orgs. */
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-player-border) 50%, transparent);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    isolation: isolate;
    min-height: calc(var(--space-24) * 4);
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      border-color var(--duration-fast) var(--ease-default);
  }

  @media (--breakpoint-md) {
    .spotlight__card {
      grid-template-columns: 1.1fr 1fr;
      gap: var(--space-8);
      padding: var(--space-8);
      min-height: calc(var(--space-24) * 5);
    }

    /* When the content item has no usable thumbnail, drop the image
       column entirely — body takes the full card width, the shader is
       unobstructed. Avoids an awkward empty frame. */
    .spotlight[data-has-image='false'] .spotlight__card {
      grid-template-columns: minmax(0, 1fr);
    }

    .spotlight[data-has-image='false'] .spotlight__body {
      max-width: 60ch;
      margin-inline: auto;
      text-align: center;
      align-items: center;
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

  /* Shader fills the card behind everything */
  .spotlight__card-shader {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .spotlight__card-shader :global(.shader-hero) {
    /* No extra filter — let the shader breathe. The veil above it handles
       legibility via a light backdrop-blur, not a saturation cut. */
  }

  /* Veil — sits between shader and content. The card uses a dedicated
     LIGHT-ON-DARK treatment (text in `--color-player-text`), so the veil
     establishes a consistent dark floor behind the copy regardless of
     which shader preset the org picked. A right-biased darken lives
     behind the copy column; the left stays brighter (and the transition
     pushed further out) to let the shader breathe around the thumbnail.
     Pairs visually with SubscribeCTA — both use the same dark-floor
     treatment so the two promotional surfaces read as siblings.
     `hsl(0 0% 0% / α)` matches the token pattern in player.css —
     expressing "neutral dark overlay at specific alpha" without inventing
     a new token family. */
  .spotlight__card-veil {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background:
      linear-gradient(
        90deg,
        hsl(0 0% 0% / 0.05) 0%,
        hsl(0 0% 0% / 0.20) 35%,
        hsl(0 0% 0% / 0.60) 70%,
        hsl(0 0% 0% / 0.70) 100%
      );
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  /* On narrow viewports the grid collapses to 1 col (image stacked above
     body); the right-biased veil would leave the image bottom dim. Fall
     back to a vertical darken that suits the stacked layout. */
  @media (--below-md) {
    .spotlight__card-veil {
      background: linear-gradient(
        180deg,
        hsl(0 0% 0% / 0.25) 0%,
        hsl(0 0% 0% / 0.60) 100%
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
    gap: inherit;
    align-items: center;
  }

  /* ── Image ─────────────────────────────────────────────────── */

  .spotlight__image {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-lg);
    /* No solid background — the shader behind the card shows through.
       A thin border (player-border: light-on-dark at ~20% alpha) keeps
       the frame visible without walling off the surface. The stacked
       outer drop (lifts the frame off the card) + inset well (recesses
       the image into the frame) reads as a framed photograph, not a
       hole cut into the card. Both shadow layers come from the token
       family — no raw values. */
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-player-border);
    display: block;
    text-decoration: none;
    box-shadow:
      var(--shadow-lg),
      var(--shadow-inner);
  }

  .spotlight__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--duration-slower) var(--ease-smooth);
    position: relative;
    z-index: 1;
  }


  .spotlight__card:hover .spotlight__image img {
    transform: scale(var(--card-image-hover-scale, 1.05));
  }

  /* Audio spotlight uses 1:1 album-art framing, mirroring ContentCard */
  .spotlight[data-content-type='audio'] .spotlight__image {
    aspect-ratio: 1 / 1;
    max-width: calc(var(--space-24) * 5);
    margin-inline: auto;
  }

  /* ── Body / typography ─────────────────────────────────────── */

  .spotlight__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    justify-content: center;
    min-width: 0;
  }

  .spotlight__eyebrow {
    margin: 0;
    font-family: var(--font-body, var(--font-sans));
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    /* Brand tint on dark veil reads as a promotional flag. Mix with the
       player-text token (always white at :root, org-overridable) so the
       tint stays readable on dark-brand orgs where --color-text-inverse
       would have flipped to dark. */
    color: color-mix(in srgb, var(--color-interactive) 65%, var(--color-player-text) 35%);
    line-height: var(--leading-tight);
  }

  .spotlight__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-3xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    /* Fixed light text — the shader behind the card can be any colour and
       the org theme may be dark, so we lean on `--color-player-text`
       (always-light inverse chrome token) and the veil to supply contrast. */
    color: var(--color-player-text);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (--breakpoint-md) {
    .spotlight__title {
      font-size: var(--text-4xl);
    }
  }

  .spotlight__title-link {
    color: inherit;
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .spotlight__title-link:hover {
    /* Lift the brand tint on hover — soft, not a flash. */
    color: color-mix(in srgb, var(--color-interactive) 45%, var(--color-player-text) 55%);
  }

  .spotlight__title-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }

  .spotlight__description {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    /* Secondary light text — player-text-secondary is pre-tuned to the
       right opacity step below the crisp title. Paired with the veil's
       55–65% darken on the right, meets WCAG AA against any shader. */
    color: var(--color-player-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Meta (creator + duration) ─────────────────────────────── */

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
    color: var(--color-player-text-secondary);
  }

  .spotlight__chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    /* Light text + translucent dark pill — player-surface tokens give
       consistent chrome regardless of shader or theme. */
    color: var(--color-player-text);
    background: var(--color-player-surface);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    border: var(--border-width) var(--border-style)
      var(--color-player-border);
    border-radius: var(--radius-full);
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
    outline-offset: 2px;
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
    .spotlight__image img,
    .spotlight__cta {
      transition: none;
    }
  }
</style>
