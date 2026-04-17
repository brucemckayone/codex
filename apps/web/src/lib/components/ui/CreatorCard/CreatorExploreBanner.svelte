<!--
  @component CreatorExploreBanner

  Editorial "feature spread" banner shown at the top of /explore
  when filtered by ?creator=<username>. Doubles as the creator's
  profile view — the filtered grid below it is their published work.

  Layout: asymmetric 40/60 split on desktop, stacked on mobile.
  - Left: tall portrait, cropped to 4:5 inside a squared frame
  - Right: eyebrow label → display name → italic pull-quote bio
           → hairline → meta row → social links → clear filter

  Styled exclusively with design tokens. Typography leans on the
  org's --font-heading / --font-body for per-org brand voice.
-->
<script lang="ts">
  import { getThumbnailUrl } from '$lib/utils/image';
  import { GlobeIcon, TwitterIcon, YoutubeIcon, InstagramIcon } from '$lib/components/ui/Icon';

  interface SocialLinks {
    website?: string;
    twitter?: string;
    youtube?: string;
    instagram?: string;
  }

  interface Props {
    name: string;
    avatarUrl: string | null;
    bio: string | null;
    role: string;
    contentCount: number;
    socialLinks: SocialLinks | null;
    onClear: () => void;
  }

  const {
    name,
    avatarUrl,
    bio,
    role,
    contentCount,
    socialLinks,
    onClear,
  }: Props = $props();

  const initial = $derived(name.charAt(0).toUpperCase());
  const socialEntries = $derived.by(() => {
    if (!socialLinks) return [];
    const out: Array<{ key: keyof SocialLinks; href: string; label: string }> = [];
    if (socialLinks.website) out.push({ key: 'website', href: socialLinks.website, label: 'Website' });
    if (socialLinks.twitter) out.push({ key: 'twitter', href: socialLinks.twitter, label: 'Twitter' });
    if (socialLinks.youtube) out.push({ key: 'youtube', href: socialLinks.youtube, label: 'YouTube' });
    if (socialLinks.instagram) out.push({ key: 'instagram', href: socialLinks.instagram, label: 'Instagram' });
    return out;
  });
</script>

<section class="feature" aria-labelledby="creator-feature-name">
  <!-- Portrait column -->
  <div class="feature__portrait">
    <div class="feature__frame">
      {#if avatarUrl}
        <img
          src={getThumbnailUrl(avatarUrl, 'lg')}
          alt="Portrait of {name}"
          class="feature__img"
          loading="eager"
        />
      {:else}
        <div class="feature__fallback" aria-hidden="true">
          <span class="feature__fallback-char">{initial}</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Vertical fold — decorative rule between the two columns,
       drawn by the grid itself. aria-hidden because it's purely visual. -->
  <div class="feature__fold" aria-hidden="true"></div>

  <!-- Content column -->
  <div class="feature__content">
    <p class="feature__eyebrow">Featured contributor</p>

    <h2 id="creator-feature-name" class="feature__name">{name}</h2>

    {#if role}
      <p class="feature__role">{role}</p>
    {/if}

    <hr class="feature__rule" aria-hidden="true" />

    {#if bio}
      <blockquote class="feature__bio">
        <span class="feature__bio-quote" aria-hidden="true">&ldquo;</span>
        <p class="feature__bio-text">{bio}</p>
      </blockquote>
    {/if}

    <div class="feature__footer">
      <dl class="feature__meta">
        <div class="feature__meta-item">
          <dt>Works</dt>
          <dd>{contentCount}</dd>
        </div>
      </dl>

      {#if socialEntries.length > 0}
        <ul class="feature__social">
          {#each socialEntries as s (s.key)}
            <li>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="{name} on {s.label}"
                class="feature__social-link"
              >
                {#if s.key === 'website'}
                  <GlobeIcon size={16} />
                {:else if s.key === 'twitter'}
                  <TwitterIcon size={16} />
                {:else if s.key === 'youtube'}
                  <YoutubeIcon size={16} />
                {:else}
                  <InstagramIcon size={16} />
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <button type="button" class="feature__clear" onclick={onClear}>
      <span aria-hidden="true">←</span> Back to all contributors
    </button>
  </div>
</section>

<style>
  /*
    Three-column grid: portrait (2fr), fold rule (hairline), content (3fr).
    The fold is a real grid column — a vertical hairline stretched with
    ::before — so we never need an absolute `left: 40%`. Fold width picks
    up --border-width so a "thick rule" skin only needs to swap that token.
  */
  .feature {
    display: grid;
    grid-template-columns: minmax(0, 2fr) var(--border-width) minmax(0, 3fr);
    column-gap: var(--space-10);
    padding: var(--space-10) var(--space-8);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    position: relative;
    overflow: hidden;
  }

  .feature__fold {
    grid-column: 2;
    align-self: stretch;
    margin-block: var(--space-2);
    background: color-mix(in srgb, var(--color-border) 50%, transparent);
  }

  /* ── Portrait column ──────────────────────── */
  .feature__portrait {
    display: flex;
    align-items: flex-start;
  }

  .feature__frame {
    width: 100%;
    aspect-ratio: 4 / 5;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface-tertiary);
  }

  .feature__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Portrait focal point: biased upward so heads sit in the top third */
    object-position: var(--_portrait-focal, center 18%);
    /* Editorial photo treatment — gentle desaturation recovers on hover
       inside the carousel card; here we keep it subtle and still. */
    filter: var(--_portrait-filter, saturate(0.95) contrast(1.02));
  }

  .feature__fallback {
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

  .feature__fallback-char {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: color-mix(in srgb, var(--color-text-muted) 80%, transparent);
  }

  /* ── Content column ──────────────────────── */
  .feature__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .feature__eyebrow {
    margin: 0;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
  }

  .feature__name {
    margin: 0;
    font-family: var(--font-heading);
    /* Fluid display ramp: anchored to typography tokens top and bottom,
       scales with viewport width in between. The vw component is the
       fluid ramp-rate; no token exists for this primitive. */
    font-size: clamp(var(--text-3xl), var(--_fluid-name, 4vw), var(--text-4xl));
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text-primary);
  }

  .feature__role {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .feature__rule {
    margin: var(--space-2) 0;
    width: var(--space-12);
    height: 0;
    border: none;
    border-top: var(--border-width-thick) var(--border-style) var(--color-text-primary);
    opacity: var(--opacity-80);
  }

  /* ── Pull-quote bio ──────────────────────── */
  .feature__bio {
    margin: 0;
    position: relative;
    padding-left: var(--space-8);
    /* Override the global blockquote rule from base.css — the decorative
       oversized quote glyph is our treatment, not a brand-color left bar. */
    border-left: none;
    color: inherit;
    font-style: normal;
  }

  .feature__bio-quote {
    position: absolute;
    top: calc(-1 * var(--space-4));
    left: 0;
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    line-height: 1;
    color: var(--color-text-primary);
    /* Dim the quote glyph so it acts as a decorative mark, not body copy */
    opacity: var(--opacity-30);
    user-select: none;
  }

  .feature__bio-text {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-lg);
    font-style: italic;
    font-weight: var(--font-normal);
    line-height: var(--leading-relaxed);
    color: var(--color-text-primary);
    max-width: 52ch;
  }

  /* ── Footer: meta + social ────────────────── */
  .feature__footer {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    flex-wrap: wrap;
    padding-top: var(--space-2);
    margin-top: var(--space-2);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .feature__meta {
    display: flex;
    gap: var(--space-6);
    margin: 0;
  }

  .feature__meta-item {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .feature__meta-item dt {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
  }

  .feature__meta-item dd {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }

  .feature__social {
    display: flex;
    list-style: none;
    margin: 0;
    padding: 0;
    gap: var(--space-2);
  }

  .feature__social-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .feature__social-link:hover {
    background: var(--color-surface-tertiary);
    color: var(--color-text-primary);
  }

  /* ── Clear filter — understated text link ── */
  .feature__clear {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    background: transparent;
    border: none;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: var(--space-1);
    transition:
      color var(--duration-fast) var(--ease-default),
      text-decoration-color var(--duration-fast) var(--ease-default);
    margin-top: var(--space-2);
  }

  .feature__clear:hover {
    color: var(--color-text-primary);
    text-decoration-color: currentColor;
  }

  .feature__clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
    border-radius: var(--radius-xs);
  }

  /* ── Responsive: stack on narrow viewports ── */
  @media (--below-md) {
    .feature {
      /* Collapse to a single column: portrait stacks above content,
         fold rule hides — the hairline only reads horizontally here. */
      grid-template-columns: 1fr;
      gap: var(--space-6);
      padding: var(--space-6) var(--space-5);
    }

    .feature__fold {
      display: none;
    }

    .feature__portrait {
      /* Cap the portrait width on mobile so it doesn't eat the viewport.
         Composed from space tokens: 18 × 1rem density unit = 18rem. */
      max-width: calc(var(--space-24) * 3);
    }

    .feature__name {
      font-size: clamp(var(--text-2xl), var(--_fluid-name-mobile, 7vw), var(--text-3xl));
    }

    .feature__bio-text {
      font-size: var(--text-base);
    }
  }
</style>
