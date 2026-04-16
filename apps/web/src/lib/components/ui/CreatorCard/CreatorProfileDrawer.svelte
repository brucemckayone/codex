<!--
  @component CreatorProfileDrawer

  Full-bleed photo-first creator profile drawer.
  Opens as a right panel (desktop) or bottom sheet (mobile).

  The hero photo fills the top half of the drawer with the creator's
  name + username overlaid on a gradient fade — dating-app style.
  Bio, social links, latest content, and profile link sit below.

  @prop {boolean} open - Whether the drawer is open (bindable)
  @prop {CreatorDrawerData | null} creator - Creator data to display
  @prop {string} orgSlug - Organization slug (for content links)
  @prop {(open: boolean) => void} [onOpenChange] - Callback when open state changes
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/Badge';
  import {
    GlobeIcon,
    TwitterIcon,
    YoutubeIcon,
    InstagramIcon,
    ChevronRightIcon,
  } from '$lib/components/ui/Icon';
  import { buildCreatorsUrl, buildContentUrl, buildOrgUrl } from '$lib/utils/subdomain';
  import { formatRelativeTime } from '$lib/utils/format';

  interface SocialLinks {
    website?: string;
    twitter?: string;
    youtube?: string;
    instagram?: string;
  }

  interface ContentItem {
    title: string;
    slug: string;
    thumbnailUrl: string | null;
    contentType: string;
  }

  interface OrgMembership {
    name: string;
    slug: string;
    logoUrl: string | null;
  }

  export interface CreatorDrawerData {
    name: string;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    socialLinks: SocialLinks | null;
    role: string;
    joinedAt: string;
    contentCount: number;
    recentContent: ContentItem[];
    organizations: OrgMembership[];
  }

  interface Props {
    open?: boolean;
    creator: CreatorDrawerData | null;
    orgSlug: string;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    creator,
    orgSlug,
    onOpenChange,
  }: Props = $props();

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
  }

  const displayName = $derived(creator?.name ?? '');
  const initial = $derived(displayName.charAt(0).toUpperCase());
  const hasSocialLinks = $derived(
    creator?.socialLinks != null &&
      (!!creator.socialLinks.website ||
        !!creator.socialLinks.twitter ||
        !!creator.socialLinks.youtube ||
        !!creator.socialLinks.instagram)
  );

  const profileUrl = $derived(
    creator?.username
      ? buildCreatorsUrl(page.url, `/@${creator.username}`)
      : null
  );

  const roleLabel = $derived.by(() => {
    switch (creator?.role) {
      case 'owner': return m.creator_drawer_role_owner();
      case 'admin': return m.creator_drawer_role_admin();
      default: return m.creator_drawer_role_creator();
    }
  });
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="creator-drawer">
    {#if creator}
      <!-- Mobile drag handle -->
      <div class="drawer-handle" aria-hidden="true">
        <span class="drawer-handle__bar"></span>
      </div>

      <!-- ═══ HERO PHOTO ═══ -->
      <div class="drawer-hero">
        {#if creator.avatarUrl}
          <img
            src={creator.avatarUrl}
            alt={displayName}
            class="drawer-hero__img"
          />
        {:else}
          <div class="drawer-hero__fallback">
            <span class="drawer-hero__initial">{initial}</span>
          </div>
        {/if}

        <!-- Gradient overlay with name -->
        <div class="drawer-hero__overlay">
          <h2 class="drawer-hero__name">{displayName}</h2>
          <div class="drawer-hero__meta">
            {#if creator.username}
              <span class="drawer-hero__username">@{creator.username}</span>
            {/if}
            <Badge variant="neutral">{roleLabel}</Badge>
          </div>
        </div>
      </div>

      <!-- ═══ BODY ═══ -->
      <div class="drawer-body">
        <!-- Bio -->
        {#if creator.bio}
          <p class="drawer-bio">{creator.bio}</p>
        {/if}

        <!-- Stats row -->
        <div class="drawer-stats">
          {#if creator.contentCount > 0}
            <span class="drawer-stats__item">
              {m.creator_drawer_content_items({ count: creator.contentCount })}
            </span>
          {/if}
          <span class="drawer-stats__item">
            {m.creator_drawer_joined({ date: formatRelativeTime(creator.joinedAt) })}
          </span>
        </div>

        <!-- Social Links -->
        {#if hasSocialLinks}
          <div class="drawer-social">
            {#if creator.socialLinks?.website}
              <a
                href={creator.socialLinks.website}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_website()}
              >
                <GlobeIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.twitter}
              <a
                href={creator.socialLinks.twitter}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_twitter()}
              >
                <TwitterIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.youtube}
              <a
                href={creator.socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_youtube()}
              >
                <YoutubeIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.instagram}
              <a
                href={creator.socialLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_instagram()}
              >
                <InstagramIcon size={20} />
              </a>
            {/if}
          </div>
        {/if}

        <!-- Other Organizations -->
        {#if creator.organizations.length > 0}
          <div class="drawer-orgs">
            <h3 class="drawer-orgs__heading">Also on</h3>
            <div class="drawer-orgs__row">
              {#each creator.organizations as org (org.slug)}
                <a
                  href={buildOrgUrl(page.url, org.slug, '/')}
                  class="drawer-orgs__item"
                  title={org.name}
                >
                  {#if org.logoUrl}
                    <img src={org.logoUrl} alt={org.name} class="drawer-orgs__logo" />
                  {:else}
                    <span class="drawer-orgs__initial">{org.name.charAt(0)}</span>
                  {/if}
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Content Gallery -->
        {#if creator.recentContent.length > 0}
          <div class="drawer-content">
            <h3 class="drawer-content__heading">{m.creator_drawer_latest()}</h3>
            <div class="drawer-content__grid">
              {#each creator.recentContent as item (item.slug)}
                <a
                  href={buildContentUrl(page.url, { slug: item.slug, id: item.slug })}
                  class="drawer-content__item"
                >
                  {#if item.thumbnailUrl}
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      class="drawer-content__thumb"
                      loading="lazy"
                    />
                  {:else}
                    <div class="drawer-content__thumb drawer-content__thumb--empty">
                      <span class="drawer-content__thumb-type">{item.contentType}</span>
                    </div>
                  {/if}
                  <span class="drawer-content__title">{item.title}</span>
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- View Full Profile -->
        {#if profileUrl}
          <a href={profileUrl} class="drawer-profile-link">
            <span>{m.creator_drawer_view_profile()}</span>
            <ChevronRightIcon size={16} />
          </a>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /* ═══════════════════════════════════════════════════════════
     ANIMATIONS — Disney principles: ease-out entrance, overshoot settle
     ═══════════════════════════════════════════════════════════ */

  /* Desktop: slide in from right with deceleration */
  @keyframes drawer-slide-in-right {
    0% {
      transform: translateX(100%);
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    100% {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Mobile: slide up from bottom with slight overshoot (follow-through) */
  @keyframes drawer-slide-in-bottom {
    0% {
      transform: translateY(100%);
      opacity: 0;
    }
    70% {
      transform: translateY(-2%);
      opacity: 1;
    }
    100% {
      transform: translateY(0);
      opacity: 1;
    }
  }

  /* Overlay fade-in */
  @keyframes drawer-overlay-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Apply overlay fade to the dialog overlay when drawer is open */
  :global(.dialog-content.creator-drawer ~ .dialog-overlay),
  :global(.dialog-overlay:has(~ .dialog-content-wrapper .creator-drawer)) {
    animation: drawer-overlay-fade var(--duration-slow) var(--ease-out) both;
  }

  /* ═══════════════════════════════════════════════════════════
     DRAWER CONTAINER
     Desktop: right-aligned panel, no padding (hero is edge-to-edge)
     Mobile: bottom sheet
     ═══════════════════════════════════════════════════════════ */
  :global(.dialog-content.creator-drawer) {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    max-width: 28rem;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
    animation: drawer-slide-in-right var(--duration-slower) var(--ease-out) both;
  }

  @media (max-width: 40rem) {
    :global(.dialog-content.creator-drawer) {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      max-width: 100%;
      width: 100%;
      height: auto;
      max-height: 90vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      border-left: none;
      border-top: var(--border-width) var(--border-style) var(--color-border);
      animation-name: drawer-slide-in-bottom;
    }
  }

  /* ── Drag handle (mobile only) ── */
  .drawer-handle {
    display: none;
    justify-content: center;
    padding: var(--space-3) 0 0;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
  }

  @media (max-width: 40rem) {
    .drawer-handle {
      display: flex;
    }
  }

  .drawer-handle__bar {
    width: var(--space-10);
    height: var(--space-1);
    background: var(--color-border-strong);
    border-radius: var(--radius-full);
  }

  /* ═══════════════════════════════════════════════════════════
     HERO PHOTO — Full-bleed, name overlaid on gradient
     Staged entrance: hero fades in, then body content follows
     ═══════════════════════════════════════════════════════════ */

  @keyframes drawer-content-fade-up {
    from {
      opacity: 0;
      transform: translateY(var(--space-4));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .drawer-hero {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    background: var(--color-surface-secondary);
    flex-shrink: 0;
  }

  @media (max-width: 40rem) {
    .drawer-hero {
      aspect-ratio: 1 / 1;
    }
  }

  .drawer-hero__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .drawer-hero__fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      135deg,
      var(--color-surface-secondary) 0%,
      var(--color-surface-tertiary, var(--color-surface-secondary)) 100%
    );
  }

  .drawer-hero__initial {
    font-size: clamp(3rem, 8vw, 6rem);
    font-weight: var(--font-bold);
    color: var(--color-text-muted);
    user-select: none;
    opacity: var(--opacity-40);
  }

  /* Gradient overlay — fades from transparent to dark at bottom */
  .drawer-hero__overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: var(--space-16) var(--space-6) var(--space-6);
    background: linear-gradient(
      to top,
      var(--color-player-overlay) 0%,
      var(--color-player-overlay) 50%,
      transparent 100%
    );
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    animation: drawer-content-fade-up var(--duration-slower) var(--ease-out) both;
    animation-delay: var(--duration-normal);
  }

  .drawer-hero__name {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text-inverse);
    line-height: var(--leading-tight);
    text-shadow: 0 1px 3px var(--color-player-overlay);
  }

  .drawer-hero__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .drawer-hero__username {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
    text-shadow: 0 1px 2px var(--color-player-overlay);
  }

  /* ═══════════════════════════════════════════════════════════
     BODY — Content below the hero
     ═══════════════════════════════════════════════════════════ */
  .drawer-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
    animation: drawer-content-fade-up var(--duration-slower) var(--ease-out) both;
    animation-delay: calc(var(--duration-slow) * 1.17);
  }

  @media (max-width: 40rem) {
    .drawer-body {
      padding: var(--space-5);
      padding-bottom: var(--space-8);
    }
  }

  /* ── Bio ── */
  .drawer-bio {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  /* ── Stats ── */
  .drawer-stats {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .drawer-stats__item {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /* ── Social links ── */
  .drawer-social {
    display: flex;
    gap: var(--space-3);
  }

  .drawer-social__link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
    transition: var(--transition-colors);
  }

  .drawer-social__link:hover {
    color: var(--color-text);
    background: var(--color-surface-variant, var(--color-surface-tertiary));
  }

  /* ── Other orgs row ── */
  .drawer-orgs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .drawer-orgs__heading {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .drawer-orgs__row {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .drawer-orgs__row::-webkit-scrollbar {
    display: none;
  }

  .drawer-orgs__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-11);
    height: var(--space-11);
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
    overflow: hidden;
    transition:
      border-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .drawer-orgs__item:hover {
    border-color: var(--color-brand-primary-subtle, var(--color-border-hover));
    transform: scale(var(--card-image-hover-scale, 1.08));
  }

  .drawer-orgs__logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: var(--space-1);
  }

  .drawer-orgs__initial {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  /* ── Content gallery ── */
  .drawer-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .drawer-content__heading {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .drawer-content__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }

  .drawer-content__item {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    text-decoration: none;
    color: inherit;
  }

  .drawer-content__thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .drawer-content__item:hover .drawer-content__thumb {
    transform: scale(1.02);
  }

  .drawer-content__thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drawer-content__thumb-type {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }

  .drawer-content__title {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-snug);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── View Full Profile ── */
  .drawer-profile-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition:
      background-color var(--duration-fast) var(--ease-default);
  }

  .drawer-profile-link:hover {
    background: var(--color-interactive-hover);
  }
</style>
