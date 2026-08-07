<!--
  @component CreatorCard

  Displays a creator's profile. Three variants:
  - default: horizontal card with avatar, name, bio, social links
  - compact: minimal row layout for lists
  - showcase: one cell of a creators contact sheet

  ## The showcase variant is a contact-sheet cell, not a hero

  It used to be a 3:4 photo-dominant card that measured 444×858 in a two-column
  grid — twelve creators made a 5,700px page and one creator per screen on
  mobile. It is now a compact square cell so a directory reads as a directory:
  many people at once, uniform rows, one glance.

  Three things were deliberately REMOVED rather than restyled:

  - **The content thumbnail strip.** Three 16:9 stills under a portrait make the
    card read as a content card with an author attached — and on a somatic-
    practice org one of those stills is itself a face, competing with the
    portrait. Stills belong in the drawer, where they already live.
  - **The per-type badges.** They were derived from `recentContent`, which the
    service caps at four rows, so a creator with 22 videos rendered "4". The card
    now states the true `contentCount` or says nothing.
  - **The owner's featured treatment.** It swapped `aspect-ratio` 3:4 → 4:5,
    which put sibling names 36px out of alignment in the same row (measured
    nameTop 747 vs 783). Role belongs in the drawer's badge, not in geometry.

  Every text row reserves its height, so the cell has a deterministic size and
  uniform rows are a guarantee rather than a coincidence.

  @prop {string} username - Creator's unique username
  @prop {string} displayName - Creator's display name
  @prop {string} avatar - Avatar image URL
  @prop {string} bio - Optional biography text
  @prop {number} contentCount - Number of published items in this org
  @prop {{ website?: string; twitter?: string; youtube?: string; instagram?: string }} socialLinks - Social media links
  @prop {Snippet} actions - Action buttons snippet
  @prop {'default' | 'compact' | 'showcase'} variant - Display variant
  @prop {() => void} onclick - Click handler (showcase: opens drawer)
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import type { SocialLinks } from './types';
  import * as m from '$paraglide/messages';
  import { Avatar, AvatarImage, AvatarFallback } from '../Avatar';
  import CreatorPortrait from './CreatorPortrait.svelte';
  import {
    GlobeIcon,
    TwitterIcon,
    YoutubeIcon,
    InstagramIcon,
  } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    username: string;
    displayName: string;
    avatar?: string | null;
    bio?: string | null;
    contentCount?: number;
    /** Creator's role in the org. Surfaced by the drawer, not by the card. */
    role?: string;
    socialLinks?: SocialLinks | null;
    /** Override profile link URL (for cross-subdomain navigation) */
    profileUrl?: string;
    /** Click handler — used by showcase variant to open drawer */
    onclick?: () => void;
    actions?: Snippet;
    variant?: 'default' | 'compact' | 'showcase';
  }

  const {
    username,
    displayName,
    avatar,
    bio,
    contentCount,
    role,
    socialLinks,
    profileUrl,
    onclick,
    actions,
    variant = 'default',
    class: className,
    ...rest
  }: Props = $props();

  const profileHref = $derived(profileUrl ?? `/@${username}`);
  const initial = $derived(displayName.charAt(0).toUpperCase());
</script>

{#if variant === 'showcase'}
  <!-- ══════════════════════════════════════════════════════════
       SHOWCASE: one contact-sheet cell
       An <article> rather than a <li> so the component stays usable
       outside a list; the directory supplies the <li> wrapper.
       ══════════════════════════════════════════════════════════ -->
  <article class="showcase {className ?? ''}" {...rest}>
    <CreatorPortrait src={avatar} name={displayName} />

    <div class="showcase__details">
      <!--
        The slot reserves two lines and BOTTOM-aligns the name inside them. The
        reservation is what keeps every bio and count row in a grid row on the
        same baseline; bottom-aligning is what stops a one-line name from leaving
        a hole between itself and the bio. The slack lands above the name
        instead, between two visually separate blocks, where it reads as spacing.
        The extra element exists because `-webkit-line-clamp` requires
        `display: -webkit-box`, which cannot also do the alignment.
      -->
      <div class="showcase__name-slot">
        <!--
          A real heading, outside the button. It used to be an <h3> INSIDE the
          <button>, which is an invalid content model (button takes phrasing
          content), flattened the heading out of the accessibility tree, and made
          the button's accessible name the whole card read as one sentence.
        -->
        <h2 class="showcase__name">{displayName}</h2>
      </div>

      <p class="showcase__practice">{bio ?? ''}</p>

      <p class="showcase__count">
        {#if contentCount !== undefined && contentCount > 0}
          {m.creator_content_count({ count: contentCount })}
        {/if}
      </p>
    </div>

    <!-- Stretched hit area. Last in DOM so the heading is read first. -->
    <button
      type="button"
      class="showcase__hit"
      aria-haspopup="dialog"
      aria-label={m.creator_view_profile({ name: displayName })}
      onclick={onclick}
    ></button>
  </article>

{:else}
  <!-- ══════════════════════════════════════════════════════════
       DEFAULT / COMPACT: Standard card variants
       ══════════════════════════════════════════════════════════ -->
  <div
    class="creator-card creator-card--{variant} {className ?? ''}"
    {...rest}
  >
    <a href={profileHref} class="creator-card__link">
      <span class="sr-only">{m.creator_view_profile({ name: displayName })}</span>
    </a>

    <div class="creator-card__body">
      <a href={profileHref} class="creator-card__avatar-link">
        <Avatar src={avatar} class="creator-card__avatar-{variant === 'compact' ? 'md' : 'lg'}">
          {#if avatar}
            <AvatarImage src={avatar} alt={displayName} />
          {/if}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </a>

      <div class="creator-card__info">
        <h3 class="creator-card__name">
          <a href={profileHref}>{displayName}</a>
        </h3>

        {#if variant === 'default' && bio}
          <p class="creator-card__bio">{bio}</p>
        {/if}

        {#if contentCount !== undefined}
          <p class="creator-card__count">
            {m.creator_content_count({ count: contentCount })}
          </p>
        {/if}
      </div>
    </div>

    {#if variant === 'default' && socialLinks && Object.keys(socialLinks).length > 0}
      <div class="creator-card__social">
        {#if socialLinks.website}
          <a
            href={socialLinks.website}
            target="_blank"
            rel="noopener noreferrer"
            class="creator-card__social-link"
            aria-label={m.creator_visit_website()}
          >
            <GlobeIcon size={16} />
          </a>
        {/if}

        {#if socialLinks.twitter}
          <a
            href={socialLinks.twitter}
            target="_blank"
            rel="noopener noreferrer"
            class="creator-card__social-link"
            aria-label={m.creator_visit_twitter()}
          >
            <TwitterIcon size={16} />
          </a>
        {/if}

        {#if socialLinks.youtube}
          <a
            href={socialLinks.youtube}
            target="_blank"
            rel="noopener noreferrer"
            class="creator-card__social-link"
            aria-label={m.creator_visit_youtube()}
          >
            <YoutubeIcon size={16} />
          </a>
        {/if}

        {#if socialLinks.instagram}
          <a
            href={socialLinks.instagram}
            target="_blank"
            rel="noopener noreferrer"
            class="creator-card__social-link"
            aria-label={m.creator_visit_instagram()}
          >
            <InstagramIcon size={16} />
          </a>
        {/if}
      </div>
    {/if}

    {#if actions}
      <div class="creator-card__actions">{@render actions()}</div>
    {/if}
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════
     SHOWCASE VARIANT — one contact-sheet cell
     ═══════════════════════════════════════════════════════════ */
  .showcase {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* Transparent until hovered. The repo convention is that cards carry no
       surface at rest — and here it is also the only honest option:
       --color-surface-secondary measures 1.07:1 against this org's background,
       so a resting tile is a tile nobody can see. */
    background: transparent;
    border-radius: var(--radius-lg);
    transition: background-color var(--duration-normal) var(--ease-default);
  }

  /* :focus-within, not just :hover — a keyboard user tabbing to the hit area
     gets the same photo response a pointer user gets. */
  .showcase:hover,
  .showcase:focus-within {
    background: var(--color-surface-secondary);
    --creator-portrait-scale: 1.04;
    --creator-portrait-rule: 1;
  }

  /* ── Text stack ──
     Each row reserves its own height so a creator with no bio and no content
     occupies exactly as much space as one with both. That is what makes the
     grid rows uniform and lets the skeleton match the loaded card exactly. */
  .showcase__details {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-inline: var(--space-1);
  }

  .showcase__name-slot {
    display: flex;
    align-items: flex-end;
    font-size: var(--text-lg);
    min-block-size: calc(2 * var(--leading-snug) * 1em);
  }

  .showcase__name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    /* Names are user data: a 38-character double-barrelled name and a 19-
       character unbroken token both have to land inside a ~13rem track. */
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .showcase__practice {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-block-size: calc(var(--leading-snug) * 1em);
  }

  .showcase__count {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    /* Secondary, not muted: muted measures 2.42:1 on a plain-brand org and
       3.78:1 here, and this is 12px text so 4.5:1 applies. */
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    min-block-size: calc(var(--leading-snug) * 1em);
  }

  /* ── Stretched hit area ── */
  .showcase__hit {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: inherit;
  }

  .showcase__hit:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  @media (prefers-reduced-motion: reduce) {
    .showcase {
      transition: none;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DEFAULT / COMPACT VARIANTS — Standard card
     ═══════════════════════════════════════════════════════════ */
  .creator-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    transition: var(--transition-colors), var(--transition-shadow);
  }

  .creator-card:hover {
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-md);
  }

  .creator-card--compact {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .creator-card__link {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .creator-card__body {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    flex: 1;
  }

  .creator-card--compact .creator-card__body {
    align-items: center;
  }

  .creator-card__avatar-link {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
  }

  .creator-card__info {
    flex: 1;
    min-width: 0;
  }

  .creator-card__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
  }

  .creator-card--compact .creator-card__name {
    font-size: var(--text-sm);
  }

  .creator-card__name a {
    color: inherit;
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .creator-card__name a:hover {
    color: var(--color-interactive);
  }

  .creator-card__bio {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .creator-card__count {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    /* Secondary, not muted — muted fails 4.5:1 at this size in both themes. */
    color: var(--color-text-secondary);
  }

  .creator-card__social {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .creator-card--compact .creator-card__social {
    margin-top: 0;
    margin-left: auto;
  }

  .creator-card__social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    position: relative;
    z-index: 2;
  }

  .creator-card__social-link:hover {
    color: var(--color-text);
    background: var(--color-surface-variant);
  }

  .creator-card__actions {
    margin-top: var(--space-3);
    display: flex;
    gap: var(--space-2);
  }

  .creator-card--compact .creator-card__actions {
    margin-top: 0;
  }
</style>
