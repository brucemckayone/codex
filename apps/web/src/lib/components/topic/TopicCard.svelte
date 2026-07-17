<!--
  @component TopicCard

  An image-led "Browse by topic" card: a cover photo (or brand-duotone gradient
  fallback when the category has no cover) under a legibility scrim, with the
  topic name — plus an optional glyph and blurb — anchored at the bottom.

  The whole card is a SINGLE stretched anchor (one tab stop, one focus ring),
  mirroring CreatorCarouselCard and the approved mockup. Because the card has no
  nested interactive element, no `::after` escape trick is needed — the `<a>`
  IS the card.

  Dual interaction contract:
    • It ALWAYS renders a real `href`, so with JS disabled — and for
      right-click / open-in-new-tab — it is a plain, deep-linkable navigation
      (WP-11 passes `?category=<slug>`).
    • When an `onselect` handler is supplied (WP-10 inline filtering), a plain
      left-click preventDefaults and calls `onselect(slug)` instead of
      navigating. Modifier / non-primary clicks fall through to the browser so
      new-tab intents against the real href are preserved.

  Legibility over any brand comes from WP-7's `--media-scrim` / `--media-glyph`
  tokens (theme-aware), so one card reads correctly on both dark and light orgs.

  @prop {string} name - Topic display name; the card's primary label + a11y name.
  @prop {string} slug - Topic slug; passed to `onselect` for inline filtering.
  @prop {string} href - Deep-link destination (real navigation / JS-off / new tab).
  @prop {string | null} [coverImageUrl] - md-variant CDN URL; null → gradient fallback.
  @prop {string | null} [icon] - Emoji glyph rendered as text above the name.
  @prop {string | null} [description] - Optional one-line blurb under the name.
  @prop {(slug: string) => void} [onselect] - Optional inline-filter hook (WP-10).
-->
<script lang="ts">
  interface Props {
    name: string;
    slug: string;
    href: string;
    coverImageUrl?: string | null;
    icon?: string | null;
    description?: string | null;
    onselect?: (slug: string) => void;
  }

  const {
    name,
    slug,
    href,
    coverImageUrl = null,
    icon = null,
    description = null,
    onselect,
  }: Props = $props();

  /**
   * Left-click with `onselect` set → filter inline instead of navigating.
   * With no `onselect`, or on a modifier / non-primary click, we do nothing and
   * let the browser follow `href` (new tab, background tab, plain nav, JS-off).
   */
  function handleClick(event: MouseEvent) {
    if (!onselect) return;
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onselect(slug);
  }
</script>

<a class="topic-card" {href} data-topic={slug} onclick={handleClick}>
  <div
    class="topic-card__media"
    class:topic-card__media--fallback={!coverImageUrl}
  >
    {#if coverImageUrl}
      <img src={coverImageUrl} alt="" loading="lazy" decoding="async" />
    {/if}
  </div>
  <div class="topic-card__scrim" aria-hidden="true"></div>
  <div class="topic-card__label">
    {#if icon}
      <span class="topic-card__icon" aria-hidden="true">{icon}</span>
    {/if}
    <h3 class="topic-card__name">{name}</h3>
    {#if description}
      <p class="topic-card__desc">{description}</p>
    {/if}
  </div>
</a>

<style>
  .topic-card {
    position: relative;
    display: flex;
    align-items: flex-end;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    text-decoration: none;
    transition:
      transform var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
  }

  .topic-card:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    border-color: var(--color-border-strong);
    box-shadow: var(--shadow-md);
  }

  .topic-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .topic-card__media {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .topic-card__media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--duration-slower) var(--ease-smooth);
  }

  .topic-card:hover .topic-card__media img {
    transform: scale(var(--card-image-hover-scale, 1.05));
  }

  /* No cover → soft brand duotone that re-themes per org and stays legible
     under the scrim on both light and dark backgrounds (each brand hue is
     mixed toward --color-surface so it never blows out). */
  .topic-card__media--fallback {
    background:
      radial-gradient(
        120% 120% at 28% 22%,
        color-mix(in oklab, var(--color-brand-primary) 55%, var(--color-surface)),
        transparent 68%
      ),
      linear-gradient(
        150deg,
        var(--color-surface-elevated),
        var(--color-surface) 55%,
        color-mix(in oklab, var(--color-brand-secondary) 45%, var(--color-surface))
      );
  }

  /* Bottom-anchored legibility scrim built from --media-scrim (WP-7) so the
     label keeps contrast over any cover on any brand. */
  .topic-card__scrim {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
      to top,
      var(--media-scrim),
      color-mix(in srgb, var(--media-scrim) 55%, transparent) 45%,
      transparent 80%
    );
  }

  .topic-card__label {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-4);
    /* Near-white, brand-tinted ink — never dark-on-dark over the scrim. */
    color: var(--media-glyph);
  }

  .topic-card__icon {
    font-size: var(--text-xl);
    line-height: var(--leading-tight);
  }

  .topic-card__name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    line-height: var(--leading-tight);
    color: var(--media-glyph);
  }

  .topic-card__desc {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: color-mix(in srgb, var(--media-glyph) 82%, transparent);
    /* One line — the blurb is a hint, not the headline. */
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (prefers-reduced-motion: reduce) {
    .topic-card,
    .topic-card__media img {
      transition: none;
    }

    .topic-card:hover,
    .topic-card:hover .topic-card__media img {
      transform: none;
    }
  }
</style>
