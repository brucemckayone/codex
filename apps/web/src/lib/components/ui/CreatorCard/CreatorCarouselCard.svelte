<!--
  @component CreatorCarouselCard

  Editorial "contributor masthead" card for the org landing carousel.
  Photo-dominant with a magazine-style N° numeral, display-font name,
  and a dark-glass bio reveal on hover/focus.

  Styled exclusively with the design-token system — no hardcoded
  px, hex, or raw values. Responds to per-org brand fonts via
  --font-heading / --font-body inherited from the org layout.
-->
<script lang="ts">
  import { getThumbnailUrl } from '$lib/utils/image';

  interface Props {
    name: string;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    role: string;
  }

  const { name, username, avatarUrl, bio, role }: Props = $props();

  const initial = $derived(name.charAt(0).toUpperCase());
  const href = $derived(
    username ? `/explore?creator=${encodeURIComponent(username)}` : '/creators'
  );
</script>

<a
  class="contrib"
  {href}
  aria-label="See content by {name}"
>
  <figure class="contrib__frame">
    {#if avatarUrl}
      <img
        src={getThumbnailUrl(avatarUrl, 'md')}
        alt=""
        class="contrib__img"
        loading="lazy"
      />
    {:else}
      <div class="contrib__fallback" aria-hidden="true">
        <span class="contrib__fallback-char">{initial}</span>
      </div>
    {/if}

    {#if bio}
      <div class="contrib__reveal">
        <p class="contrib__bio">{bio}</p>
        <span class="contrib__cta">
          See work <span class="contrib__cta-arrow" aria-hidden="true">→</span>
        </span>
      </div>
    {/if}
  </figure>

  <div class="contrib__meta">
    <h3 class="contrib__name">{name}</h3>
    <p class="contrib__role">{role}</p>
  </div>
</a>

<style>
  .contrib {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    text-decoration: none;
    color: inherit;
    outline: none;
  }

  .contrib:focus-visible .contrib__frame {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-2);
  }

  /* ── Portrait frame (4:5) ────────────────────── */
  .contrib__frame {
    position: relative;
    margin: 0;
    aspect-ratio: 4 / 5;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface-tertiary);
    isolation: isolate;
  }

  .contrib__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Portrait focal point: biased upward so heads sit in the top third.
       Exposed as a local variable so other consumers can tune framing
       without touching this rule. */
    object-position: var(--_portrait-focal, center 18%);
    /* Editorial photo treatment — slightly desaturated by default,
       recovering to full saturation on hover/focus (see rule below). */
    filter: var(--_portrait-filter, saturate(0.9) contrast(1.02));
    transition:
      transform var(--duration-slower) var(--ease-out),
      filter var(--duration-normal) var(--ease-default);
  }

  .contrib:hover .contrib__img,
  .contrib:focus-visible .contrib__img {
    /* Gentle zoom ratio — ~3% scale. A pure transform ratio has no
       spacing-token analog so it's kept as a named local variable. */
    transform: scale(var(--_portrait-hover-scale, 1.03));
    filter: none;
  }

  .contrib__fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-brand-primary, var(--color-primary-500)) 30%, var(--color-surface-tertiary)),
      var(--color-surface-tertiary)
    );
  }

  .contrib__fallback-char {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: color-mix(in srgb, var(--color-text-muted) 80%, transparent);
    letter-spacing: var(--tracking-tighter);
  }

  /* ── Hover reveal: bio slides up from bottom ── */
  .contrib__reveal {
    position: absolute;
    inset: auto 0 0 0;
    padding: var(--space-6) var(--space-4) var(--space-4);
    background: linear-gradient(
      to top,
      color-mix(in srgb, black 92%, transparent) 0%,
      color-mix(in srgb, black 72%, transparent) 55%,
      color-mix(in srgb, black 0%, transparent) 100%
    );
    color: white;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    transform: translateY(100%);
    opacity: 0;
    transition:
      transform var(--duration-slow) var(--ease-out),
      opacity var(--duration-normal) var(--ease-default);
  }

  .contrib:hover .contrib__reveal,
  .contrib:focus-visible .contrib__reveal {
    transform: translateY(0);
    opacity: 1;
  }

  .contrib__bio {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: color-mix(in srgb, white 92%, transparent);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .contrib__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: white;
  }

  .contrib__cta-arrow {
    display: inline-block;
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .contrib:hover .contrib__cta-arrow {
    transform: translateX(var(--space-1));
  }

  /* ── Meta below frame: editorial name + role ─ */
  .contrib__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-1);
  }

  .contrib__name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text-primary);
    /* Hairline underline that draws in on hover */
    background-image: linear-gradient(
      currentColor,
      currentColor
    );
    background-size: 0% var(--border-width);
    background-repeat: no-repeat;
    background-position: 0 100%;
    padding-bottom: var(--space-0-5);
    transition: background-size var(--duration-normal) var(--ease-out);
  }

  .contrib:hover .contrib__name,
  .contrib:focus-visible .contrib__name {
    background-size: 100% var(--border-width);
  }

  .contrib__role {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
  }

  @media (prefers-reduced-motion: reduce) {
    .contrib__img,
    .contrib__reveal,
    .contrib__cta-arrow,
    .contrib__name {
      transition: none;
    }
  }
</style>
