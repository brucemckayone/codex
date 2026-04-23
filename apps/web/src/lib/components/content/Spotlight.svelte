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
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { BrandGradientBackdrop } from '$lib/components/ui/BrandGradient';
  import { PlayIcon, MusicIcon, FileTextIcon } from '$lib/components/ui/Icon';
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
</script>

<section
  class="spotlight"
  aria-labelledby={titleId}
  data-content-type={contentType}
  data-has-image={hasImage}
>
  <div class="spotlight__container">
    <article class="spotlight__card">
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
          <a class="spotlight__image" {href} tabindex="-1" aria-hidden="true">
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
       unobstructed. Avoids an awkward empty frame. */
    .spotlight[data-has-image='false'] .spotlight__card {
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

  /* Audio spotlight keeps a square feeling within the cinema rectangle —
     letterbox the 1:1 thumbnail with `object-fit: contain` on audio
     (album art is rarely croppable). */
  .spotlight[data-content-type='audio'] .spotlight__image-still {
    object-fit: contain;
    object-position: center;
    background: hsl(0 0% 0% / 0.35);
  }

  .spotlight__image-still {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    transition: transform var(--duration-slower) var(--ease-smooth);
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .spotlight__card:hover .spotlight__image-still {
    transform: scale(var(--card-image-hover-scale, 1.05));
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
    /* Cinematic scale — fluid between mobile (2.5rem) and desktop (5rem).
       Uses viewport-responsive `vw` so the title feels like a cover line,
       not a card headline. */
    font-size: clamp(2.5rem, 6vw, 5rem);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
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
    color: hsl(0 0% 100% / 0.85);
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
    .spotlight__image-still,
    .spotlight__cta {
      transition: none;
    }
  }
</style>
