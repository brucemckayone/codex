<!--
  @component SubscribeCTA

  Full-bleed membership banner used once on the org landing page (between
  Articles and per-category sections). Wraps `<SubscribeButton>` so logged-in
  subscribers see a "Manage membership" state instead of "Subscribe" — no
  wrong-state flash because SubscribeButton hydrates from the localStorage-
  backed `subscriptionCollection` on mount.

  The banner has an atmospheric CSS gradient backdrop (BrandGradientBackdrop,
  aurora variant) that tints from the org's brand colour. Originally ran a
  full ShaderHero WebGL canvas per-instance (see git history), but three
  concurrent shaders on the landing page (Hero + Spotlight + CTA) burned
  GPU fill-rate; hero keeps its shader, the two secondary surfaces share
  the cheaper CSS replacement. The gradient veil keeps text legible.

  V2 overhaul (Agent SC, Phase 3):
    - Replaces 3-bullet row with a 3-col value-prop grid (icon + heading + desc)
    - Adds an optional social-proof strip (avatar stack + compact member count)
    - Adds a visible "From £X/mo" price + optional annual-save teaser
    - Adds an optional "You'll unlock:" preview strip of member-only content
    All new surfaces degrade gracefully when their data isn't provided so the
    banner still reads cleanly on orgs that haven't exposed pricing or
    membership counts server-side.
-->
<script lang="ts">
  import SubscribeButton from '$lib/components/subscription/SubscribeButton.svelte';
  import { BrandGradientBackdrop } from '$lib/components/ui/BrandGradient';
  import {
    Avatar,
    AvatarImage,
    AvatarFallback,
  } from '$lib/components/ui/Avatar';
  import {
    LibraryIcon,
    TrendingUpIcon,
    UsersIcon,
  } from '$lib/components/ui/Icon';
  import { getInitials } from '$lib/utils/format';

  interface ValueProp {
    /** Rendered icon component (24px). Defaults chosen when grid is undefined. */
    icon: 'library' | 'new-releases' | 'community';
    heading: string;
    description: string;
  }

  interface MemberAvatar {
    src?: string | null;
    name: string;
  }

  interface PreviewItem {
    id: string;
    title: string;
    thumbnail?: string | null;
    href?: string;
  }

  interface Props {
    organizationId: string;
    orgName: string;
    isAuthenticated: boolean;
    /** Optional headline override — defaults to "Join {orgName}". */
    headline?: string;
    /** Short subtitle under the headline. */
    tagline?: string;
    /**
     * 3-cell value-prop grid. When undefined, a sensible default trio is
     * rendered ("Unlimited library", "New every week", "Support creators").
     * The caller can supply a custom trio — must contain exactly three cells
     * or the grid will look under-filled at md+.
     */
    valueProps?: [ValueProp, ValueProp, ValueProp];
    /**
     * Starting price in the smallest currency unit (pence for GBP).
     * When present, the banner shows "From £X/mo" above the CTA. When
     * absent, the CTA falls back to the `meta` microcopy (e.g. "Cancel
     * anytime") for orgs whose pricing hasn't been wired through yet.
     */
    startingPriceCents?: number;
    /** ISO-4217 currency code — defaults to GBP. */
    currency?: string;
    /** Monthly price in minor units — required for the annual-save teaser. */
    monthlyPriceCents?: number;
    /** Annual price in minor units — required for the annual-save teaser. */
    annualPriceCents?: number;
    /**
     * Total member count for social proof (e.g. 2_341). Absent = social
     * proof strip hidden. Formatted with Intl compact notation.
     */
    memberCount?: number;
    /**
     * Up to 5 avatars rendered as an overlapping stack left of the count.
     * Absent = stack hidden; text-only proof still shows if memberCount
     * is present.
     */
    memberAvatars?: MemberAvatar[];
    /**
     * Optional preview strip of member-only content ("You'll unlock:").
     * Rendered below the CTA as a horizontally-scrolling row of compact
     * 16:9 tiles. Absent / empty = strip hidden.
     */
    previewContent?: PreviewItem[];
    /** Secondary microcopy under the CTA — used when no price is passed. */
    meta?: string;
    /** Destination for unauthenticated users clicking the CTA. */
    subscribeHref?: string;
  }

  const DEFAULT_VALUE_PROPS: [ValueProp, ValueProp, ValueProp] = [
    {
      icon: 'library',
      heading: 'Full library access',
      description: 'Every video, audio, and article in one membership.',
    },
    {
      icon: 'new-releases',
      heading: 'New every week',
      description: 'Fresh releases delivered as soon as they ship.',
    },
    {
      icon: 'community',
      heading: 'Back the creators',
      description: 'Direct support keeps new work coming.',
    },
  ];

  const {
    organizationId,
    orgName,
    isAuthenticated,
    headline,
    tagline = 'Everything on the platform, one membership.',
    valueProps = DEFAULT_VALUE_PROPS,
    startingPriceCents,
    currency = 'GBP',
    monthlyPriceCents,
    annualPriceCents,
    memberCount,
    memberAvatars,
    previewContent,
    meta = 'Cancel anytime',
    subscribeHref = '/pricing',
  }: Props = $props();

  const effectiveHeadline = $derived(headline ?? `Join ${orgName}`);

  // ── Derived: price string ──────────────────────────────────────────
  // Format the starting price as "From £X/mo" using Intl for correct
  // currency symbol + locale grouping. minimumFractionDigits=0 keeps the
  // headline tight for whole-pound amounts; falls back to decimals when
  // the org sets a non-whole price (e.g. £9.99/mo).
  const priceLabel = $derived.by(() => {
    if (startingPriceCents == null) return null;
    const minor = startingPriceCents;
    const major = minor / 100;
    const hasFraction = minor % 100 !== 0;
    const formatter = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    });
    return formatter.format(major);
  });

  // ── Derived: annual-save teaser ───────────────────────────────────
  // Only rendered when BOTH monthly and annual prices are provided AND
  // the annual price is a strict discount vs 12 × monthly. Shows the
  // integer saving percentage rounded down so we never overstate.
  const annualSavingPercent = $derived.by(() => {
    if (monthlyPriceCents == null || annualPriceCents == null) return null;
    if (monthlyPriceCents <= 0 || annualPriceCents <= 0) return null;
    const fullYear = monthlyPriceCents * 12;
    if (annualPriceCents >= fullYear) return null;
    const saved = fullYear - annualPriceCents;
    const pct = Math.floor((saved / fullYear) * 100);
    return pct > 0 ? pct : null;
  });

  // ── Derived: compact member count ─────────────────────────────────
  // Intl compact notation collapses 2341 → "2.3K". Avoids a fake
  // trailing "+" — authentic numbers read stronger than rounded marketing
  // claims, and we deliberately hide the strip entirely when memberCount
  // is undefined rather than faking one.
  const memberCountLabel = $derived.by(() => {
    if (memberCount == null || memberCount <= 0) return null;
    const formatter = new Intl.NumberFormat('en-GB', { notation: 'compact' });
    return formatter.format(memberCount);
  });

  // ── Derived: visible avatar subset ────────────────────────────────
  // Stack caps at 5; CSS handles the visual overlap via negative margin.
  const displayedAvatars = $derived(
    memberAvatars && memberAvatars.length > 0
      ? memberAvatars.slice(0, 5)
      : null
  );

  // ── Derived: preview strip ────────────────────────────────────────
  // Caller passes up to 5 items; we cap at 5 defensively even if more
  // come through (long rows would crowd the panel at md+).
  const displayedPreview = $derived(
    previewContent && previewContent.length > 0
      ? previewContent.slice(0, 5)
      : null
  );

  // Show the price row only when there's something to render — otherwise
  // fall back to the legacy meta microcopy so the CTA isn't orphaned.
  const showPriceRow = $derived(priceLabel != null);
  const showMetaFallback = $derived(!showPriceRow && !!meta);
</script>

<section class="subscribe-cta" aria-labelledby="subscribe-cta-title">
  <div class="subscribe-cta__panel">
    <div class="subscribe-cta__backdrop" aria-hidden="true">
      <!-- Brand gradient aurora — cheap CSS replacement for the earlier
           ShaderHero. See component docblock for why we swapped. The
           forwarded class pins z-index inside the backdrop wrapper. -->
      <BrandGradientBackdrop
        variant="aurora"
        class="subscribe-cta__gradient"
      />
      <div class="subscribe-cta__veil"></div>
    </div>

    <div class="subscribe-cta__body">
      <p class="subscribe-cta__eyebrow">Membership</p>

      <h2 class="subscribe-cta__title" id="subscribe-cta-title">
        {effectiveHeadline}
      </h2>

      {#if tagline}
        <p class="subscribe-cta__tagline">{tagline}</p>
      {/if}

      <!-- ── Social proof strip ──────────────────────────────────────
           Rendered only when the caller passes memberCount. The avatar
           stack (capped at 5) is optional on top; the text reads well
           without it on orgs that only surface a count. -->
      {#if memberCountLabel}
        <div class="subscribe-cta__proof" aria-label="Members">
          {#if displayedAvatars}
            <ul class="subscribe-cta__avatar-stack" aria-hidden="true">
              {#each displayedAvatars as avatar, i (i)}
                <li class="subscribe-cta__avatar-slot">
                  <Avatar
                    src={avatar.src ?? undefined}
                    class="subscribe-cta__avatar"
                  >
                    {#if avatar.src}
                      <AvatarImage src={avatar.src} alt="" />
                    {/if}
                    <AvatarFallback>{getInitials(avatar.name)}</AvatarFallback>
                  </Avatar>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="subscribe-cta__proof-text">
            Join <strong class="subscribe-cta__proof-count"
              >{memberCountLabel}</strong
            >
            {memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>
      {/if}

      <!-- ── Value-prop grid ─────────────────────────────────────────
           3-col desktop, 1-col mobile. Icons use color-mix against fixed
           white (not --color-player-text) because the banner is a
           promotional dark surface — see feedback_player_tokens_for_dark_overlays. -->
      <ul class="subscribe-cta__props" role="list">
        {#each valueProps as prop, i (i)}
          <li class="subscribe-cta__prop">
            <span class="subscribe-cta__prop-icon" aria-hidden="true">
              {#if prop.icon === 'library'}
                <LibraryIcon size={24} />
              {:else if prop.icon === 'new-releases'}
                <TrendingUpIcon size={24} />
              {:else if prop.icon === 'community'}
                <UsersIcon size={24} />
              {/if}
            </span>
            <span class="subscribe-cta__prop-heading">{prop.heading}</span>
            <span class="subscribe-cta__prop-description"
              >{prop.description}</span
            >
          </li>
        {/each}
      </ul>

      <!-- ── Price row ───────────────────────────────────────────────
           Only rendered when a starting price is passed in via props.
           Keeps the banner honest — if the org hasn't wired pricing up,
           we fall back to the legacy meta microcopy rather than faking
           a number. -->
      {#if showPriceRow}
        <div class="subscribe-cta__price-row">
          <p class="subscribe-cta__price">
            <span class="subscribe-cta__price-prefix">From</span>
            <span class="subscribe-cta__price-amount">{priceLabel}</span>
            <span class="subscribe-cta__price-suffix">/mo</span>
          </p>
          {#if annualSavingPercent}
            <p class="subscribe-cta__price-teaser">
              Or save {annualSavingPercent}% with annual
            </p>
          {/if}
        </div>
      {/if}

      <div class="subscribe-cta__actions">
        <!-- Brand-tinted glow anchors the primary CTA. Sits behind the
             SubscribeButton with a radial gradient of --color-interactive at
             low opacity so the button reads as the dominant focal point
             without being caged in a hard ring. Decorative only. -->
        <span class="subscribe-cta__cta-glow" aria-hidden="true"></span>
        <SubscribeButton
          {organizationId}
          {isAuthenticated}
          {subscribeHref}
          size="lg"
          showBadge={true}
        />
      </div>

      {#if showMetaFallback}
        <p class="subscribe-cta__meta">{meta}</p>
      {/if}

      <!-- ── Preview content strip ───────────────────────────────────
           Small horizontal row of member-only content thumbnails. Uses
           a lightweight inline primitive rather than ContentCard so the
           tiles read as visually subordinate to the CTA (they are a
           teaser, not a browse surface). Links out to each item so
           keyboard users can jump directly into the preview detail. -->
      {#if displayedPreview}
        <div class="subscribe-cta__preview">
          <p class="subscribe-cta__preview-lede">You'll unlock:</p>
          <ul class="subscribe-cta__preview-list" role="list">
            {#each displayedPreview as item (item.id)}
              <li class="subscribe-cta__preview-item">
                <svelte:element
                  this={item.href ? 'a' : 'div'}
                  class="subscribe-cta__preview-tile"
                  href={item.href}
                >
                  <span class="subscribe-cta__preview-thumb">
                    {#if item.thumbnail}
                      <img
                        src={item.thumbnail}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    {/if}
                  </span>
                  <span class="subscribe-cta__preview-title">{item.title}</span>
                </svelte:element>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  /* ── Section ────────────────────────────────────────────────
     Outer full-bleed shell. Breaks out of the parent container so the
     banner can host a rounded INNER panel that sits inside a gutter.
     The panel (not the section) carries the shader, veil, shadow, and
     rounded edges — this pairs visually with Spotlight which is itself
     a rounded promotional card. */
  .subscribe-cta {
    position: relative;
    /* Escape the parent's max-width by breaking out to full viewport
       width. `calc(100vw - scrollbar)` isn't bulletproof on all browsers
       but margin-inline negative works because the parent `.content-area`
       is centered with max-width. */
    width: 100vw;
    margin-inline: calc(50% - 50vw);
    padding-block: var(--space-12);
    padding-inline: var(--space-6);
    display: grid;
    place-items: center;
    /* Banner is a dedicated light-on-dark promotional poster — the dark
       radial veil is always rendered behind the text, so text MUST be
       white regardless of org branding. Can't use `--color-player-text`:
       org-brand.css lets orgs rebind it via `--brand-player-text`
       (of-blood-and-bones sets it to their brand red, which matches the
       shader and renders the text invisible). Fixed `hsl(0 0% 100%)`
       follows the same explicit-neutral pattern as the veil itself. */
    color: hsl(0 0% 100%);
  }

  /* ── Panel ──────────────────────────────────────────────────
     Inner rounded promotional surface. Pairs with Spotlight's outer card:
     same --radius-xl corners, same --shadow-xl depth, same hover lift,
     same border family (player-border at ~50% alpha so the edge reads
     without walling off the shader surface behind it). */
  .subscribe-cta__panel {
    position: relative;
    width: 100%;
    max-width: var(--container-max, 1280px);
    margin-inline: auto;
    padding-block: calc(var(--space-16) + var(--space-4));
    padding-inline: var(--space-6);
    display: grid;
    place-items: center;
    overflow: hidden;
    isolation: isolate;
    text-align: center;
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.1);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      border-color var(--duration-fast) var(--ease-default);
  }

  .subscribe-cta__panel:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    box-shadow:
      var(--shadow-xl),
      0 0 0 var(--border-width-thick)
        color-mix(in srgb, var(--color-interactive) 24%, transparent);
    border-color: color-mix(in srgb, var(--color-interactive) 32%, transparent);
  }

  /* ── Backdrop ───────────────────────────────────────────────
     Shader + veil. Fills the panel so the rounded corners clip the
     canvas naturally. Always renders so anon + signed-in users get
     the same mood on first paint (SubscribeButton handles the state
     logic). */
  .subscribe-cta__backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  /* The veil DARKENS the shader (not brightens it). Shaders can be any
     colour — bright yellows, pastels, high-saturation pinks — so the dark
     floor gives a consistent legibility surface for the light text that
     sits above. A radial gradient puts the darkest spot behind the CTA
     column, letting edges fade back into the shader. Uses `hsl(0 0% 0% / α)`
     directly (same pattern as player.css) so the veil stays dark in both
     light- and dark-theme orgs — semantic surface tokens flip with theme
     and would LIGHTEN the shader on dark themes, inverting the intent. */
  .subscribe-cta__veil {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse 60% 80% at 50% 50%,
        hsl(0 0% 0% / 0.72) 0%,
        hsl(0 0% 0% / 0.55) 60%,
        hsl(0 0% 0% / 0.30) 100%
      );
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
  }

  /* ── Body ───────────────────────────────────────────────────
     Centered column for the headline stack; the value-prop grid and
     preview strip sit below and widen past this column so 3-col grids
     have room to breathe. The grid + preview opt out of this max-width
     via their own max-width: 100% on a sub-wrapper below. */
  .subscribe-cta__body {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    max-width: calc(var(--space-24) * 8);
    margin-inline: auto;
  }

  .subscribe-cta__eyebrow {
    margin: 0;
    font-family: var(--font-body, var(--font-sans));
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    /* Lift the brand colour above the dark veil — mix with fixed white
       so the tint survives orgs that rebind `--color-player-text` via
       their branding. */
    color: color-mix(in srgb, var(--color-interactive) 55%, hsl(0 0% 100%) 45%);
    line-height: var(--leading-tight);
  }

  .subscribe-cta__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    font-size: clamp(var(--text-3xl), 4vw, var(--text-4xl));
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    /* Fixed white — see rationale on .subscribe-cta above. */
    color: hsl(0 0% 100%);
  }

  .subscribe-cta__tagline {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    /* 80% white — secondary hierarchy below the crisp title. */
    color: hsl(0 0% 100% / 0.8);
    max-width: 42ch;
  }

  /* ── Social proof ───────────────────────────────────────────
     A tight row between tagline and the value-prop grid. Avatar stack
     (when provided) sits left of the count; both degrade gracefully
     when the data is absent. */
  .subscribe-cta__proof {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-1);
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    background: hsl(0 0% 100% / 0.08);
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.12);
  }

  .subscribe-cta__avatar-stack {
    display: inline-flex;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .subscribe-cta__avatar-slot {
    display: inline-flex;
    /* Overlap stack — each avatar after the first pulls left so they
       nest. The border isolates each circle from its neighbour under
       the veil so they don't fuse into a single blob. */
    margin-inline-start: calc(-1 * var(--space-2));
  }

  .subscribe-cta__avatar-slot:first-child {
    margin-inline-start: 0;
  }

  /* Override Avatar default size + pin a white ring so overlap reads
     as distinct portraits instead of a merged shape. :global so it
     hits the wrapped Avatar root. */
  .subscribe-cta__avatar-slot :global(.subscribe-cta__avatar) {
    width: var(--space-7);
    height: var(--space-7);
    border: calc(var(--border-width) * 2) solid hsl(0 0% 100% / 0.8);
    box-shadow: 0 1px 2px hsl(0 0% 0% / 0.35);
  }

  .subscribe-cta__proof-text {
    margin: 0;
    font-size: var(--text-xs);
    color: hsl(0 0% 100% / 0.85);
    letter-spacing: var(--tracking-wide);
  }

  .subscribe-cta__proof-count {
    font-weight: var(--font-semibold);
    color: hsl(0 0% 100%);
  }

  /* ── Value-prop grid ────────────────────────────────────────
     3-col on md+, 1-col stacked on mobile. Transparent cells (no card
     chrome) — the grid sits flat on the veil so it reads as one beat
     rather than a floating sub-panel. Wider than the body column so
     3 cells fit without cramping. */
  .subscribe-cta__props {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    width: 100%;
    max-width: calc(var(--space-24) * 10);
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  .subscribe-cta__prop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-2);
  }

  .subscribe-cta__prop-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-md);
    /* Tint the icon mark from brand, clamped against fixed white so it
       survives orgs that rebind player tokens. Same rationale as eyebrow. */
    color: color-mix(in srgb, var(--color-interactive) 60%, hsl(0 0% 100%) 40%);
    background: hsl(0 0% 100% / 0.06);
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.1);
  }

  .subscribe-cta__prop-heading {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: hsl(0 0% 100%);
    line-height: var(--leading-tight);
  }

  .subscribe-cta__prop-description {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: hsl(0 0% 100% / 0.75);
    max-width: 24ch;
  }

  /* ── Price row ──────────────────────────────────────────────
     Sits immediately above the CTA so the price is the last thing the
     user reads before committing. "From" and "/mo" dim back to 65%
     so the monetary figure stays the visual anchor. */
  .subscribe-cta__price-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .subscribe-cta__price {
    margin: 0;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    font-family: var(--font-heading, var(--font-sans));
    color: hsl(0 0% 100%);
  }

  .subscribe-cta__price-prefix,
  .subscribe-cta__price-suffix {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: hsl(0 0% 100% / 0.65);
    letter-spacing: var(--tracking-wide);
  }

  .subscribe-cta__price-amount {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
  }

  .subscribe-cta__price-teaser {
    margin: 0;
    font-size: var(--text-xs);
    color: hsl(0 0% 100% / 0.75);
    letter-spacing: var(--tracking-wide);
  }

  /* ── Actions ────────────────────────────────────────────────
     SubscribeButton renders its own styling; this wrapper positions
     the brand glow behind it. */
  .subscribe-cta__actions {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  /* Brand-tinted glow sits DIRECTLY behind the SubscribeButton to anchor
     the primary CTA. Radial gradient of --color-interactive (the org's
     brand colour) at low opacity — subtle, not a dominant ring. The
     gradient is sized wider than the button so the soft edge fades into
     the veil rather than cutting off. Decorative only. */
  .subscribe-cta__cta-glow {
    position: absolute;
    inset: 50% auto auto 50%;
    width: calc(var(--space-24) * 4);
    height: calc(var(--space-24) * 2);
    transform: translate(-50%, -50%);
    background: radial-gradient(
      ellipse 60% 60% at 50% 50%,
      color-mix(in srgb, var(--color-interactive) 25%, transparent) 0%,
      color-mix(in srgb, var(--color-interactive) 12%, transparent) 55%,
      transparent 100%
    );
    pointer-events: none;
    z-index: -1;
    filter: blur(var(--blur-md));
  }

  .subscribe-cta__meta {
    margin: 0;
    font-size: var(--text-xs);
    color: hsl(0 0% 100% / 0.65);
    letter-spacing: var(--tracking-wide);
  }

  /* ── Preview content strip ──────────────────────────────────
     Light inline primitive (not ContentCard) so the teaser reads as
     subordinate to the CTA. Scrolls horizontally on overflow so the
     row stays single-line regardless of title length. */
  .subscribe-cta__preview {
    width: 100%;
    margin-top: var(--space-6);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .subscribe-cta__preview-lede {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: hsl(0 0% 100% / 0.65);
  }

  .subscribe-cta__preview-list {
    list-style: none;
    margin: 0;
    padding: var(--space-1) 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    width: 100%;
  }

  .subscribe-cta__preview-item {
    flex: 0 0 auto;
  }

  .subscribe-cta__preview-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    width: calc(var(--space-24) * 1.5);
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    padding: var(--space-1);
    transition:
      background-color var(--duration-fast) var(--ease-default),
      transform var(--duration-normal) var(--ease-smooth);
  }

  .subscribe-cta__preview-tile:is(a):hover,
  .subscribe-cta__preview-tile:is(a):focus-visible {
    background: hsl(0 0% 100% / 0.08);
    transform: translateY(calc(-1 * var(--space-0-5)));
  }

  .subscribe-cta__preview-tile:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .subscribe-cta__preview-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: hsl(0 0% 100% / 0.08);
    border: var(--border-width) var(--border-style) hsl(0 0% 100% / 0.1);
  }

  .subscribe-cta__preview-thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .subscribe-cta__preview-title {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: hsl(0 0% 100% / 0.9);
    line-height: var(--leading-snug);
    /* Clamp to 1 line — the teaser is a preview, not a browse row */
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    text-align: center;
  }

  /* ── Reveal motion ─────────────────────────────────────────── */

  @media (prefers-reduced-motion: no-preference) {
    .subscribe-cta__body {
      opacity: 0;
      transform: translateY(var(--space-4));
      animation: subscribe-in var(--duration-slower) var(--ease-out) 100ms forwards;
    }
  }

  @keyframes subscribe-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Reduced motion: disable hover lift + transition. The panel stays
     rooted and static, matching Spotlight's reduced-motion rule. */
  @media (prefers-reduced-motion: reduce) {
    .subscribe-cta__panel {
      transition: none;
    }

    .subscribe-cta__panel:hover {
      transform: none;
    }

    .subscribe-cta__preview-tile:is(a):hover,
    .subscribe-cta__preview-tile:is(a):focus-visible {
      transform: none;
    }
  }

  /* ── Desktop — 3-col grid + wider panel ─────────────────────
     At md+ the value-prop grid becomes a 3-col row and the preview
     strip lines up in a single horizontal row. Nothing else changes
     shape — the panel already has enough padding on desktop. */
  @media (--breakpoint-md) {
    .subscribe-cta__props {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .subscribe-cta__preview-list {
      flex-wrap: nowrap;
      overflow-x: auto;
      justify-content: center;
    }

    .subscribe-cta__preview-tile {
      width: calc(var(--space-24) * 1.6);
    }
  }

  /* ── Mobile ─────────────────────────────────────────────────
     Keep the rounded corners on narrow screens but reduce the inner
     padding so the panel doesn't look over-stuffed. The outer section
     already provides a small inline gutter — we only tweak the panel's
     breathing room here, not its edge-to-edge reach. */
  @media (--below-md) {
    .subscribe-cta {
      padding-block: var(--space-8);
      padding-inline: var(--space-4);
    }

    .subscribe-cta__panel {
      padding-block: calc(var(--space-12) + var(--space-2));
      padding-inline: var(--space-5);
    }

    /* Tighter stack gaps on mobile — the extra preview + price rows
       otherwise add vertical height that hurts first-paint density. */
    .subscribe-cta__body {
      gap: var(--space-3);
    }

    .subscribe-cta__props {
      gap: var(--space-5);
      margin-top: var(--space-2);
    }

    .subscribe-cta__preview-tile {
      width: calc(var(--space-24) * 1.3);
    }
  }
</style>
