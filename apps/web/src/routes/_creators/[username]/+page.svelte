<!--
  @component CreatorProfilePage

  Public creator profile page showing avatar, name, bio, social links,
  and a grid of their published content.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl, buildOrgUrl } from '$lib/utils/subdomain';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { GlobeIcon, TwitterIcon, YoutubeIcon, InstagramIcon, FileIcon, UsersIcon } from '$lib/components/ui/Icon';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const username = $derived(data.username ?? 'Creator');
  const profile = $derived(data.creatorProfile);
  const displayName = $derived(profile?.name ?? username);
  const avatar = $derived(profile?.image ?? null);
  const bio = $derived(profile?.bio ?? m.creator_profile_bio_default());
  const socialLinks = $derived(profile?.socialLinks ?? null);
  const contentItems = $derived(data.contentItems ?? []);
  const organizations = $derived(data.organizations ?? []);
  const initial = $derived(displayName.charAt(0).toUpperCase());
  const hasSocialLinks = $derived(
    socialLinks != null &&
      (!!socialLinks.website ||
        !!socialLinks.twitter ||
        !!socialLinks.youtube ||
        !!socialLinks.instagram)
  );
</script>

<svelte:head>
  <title>{m.creator_profile_title({ name: displayName })}</title>
  <meta property="og:title" content="{displayName} | Revelations Creators" />
  <meta property="og:description" content={bio} />
  <meta property="og:type" content="profile" />
  {#if avatar}
    <meta property="og:image" content={avatar} />
  {/if}
  <meta name="description" content={bio} />
  <meta name="twitter:card" content={avatar ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content="{displayName} | Revelations Creators" />
  <meta name="twitter:description" content={bio} />
</svelte:head>

<div class="profile">
  <!-- Profile Header -->
  <section class="profile-header">
    <div class="profile-header__avatar">
      <Avatar src={avatar} class="avatar--xl">
        {#if avatar}
          <AvatarImage src={avatar} alt={displayName} />
        {/if}
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
    </div>

    <h1 class="profile-header__name">{displayName}</h1>
    <p class="profile-header__username">@{username}</p>

    {#if bio}
      <p class="profile-header__bio">{bio}</p>
    {/if}

    {#if hasSocialLinks}
      <div class="profile-header__social">
        {#if socialLinks?.website}
          <a
            href={socialLinks.website}
            target="_blank"
            rel="noopener noreferrer"
            class="social-link"
            aria-label={m.creator_visit_website()}
          >
            <GlobeIcon size={18} />
          </a>
        {/if}

        {#if socialLinks?.twitter}
          <a
            href={socialLinks.twitter}
            target="_blank"
            rel="noopener noreferrer"
            class="social-link"
            aria-label={m.creator_visit_twitter()}
          >
            <TwitterIcon size={18} />
          </a>
        {/if}

        {#if socialLinks?.youtube}
          <a
            href={socialLinks.youtube}
            target="_blank"
            rel="noopener noreferrer"
            class="social-link"
            aria-label={m.creator_visit_youtube()}
          >
            <YoutubeIcon size={18} />
          </a>
        {/if}

        {#if socialLinks?.instagram}
          <a
            href={socialLinks.instagram}
            target="_blank"
            rel="noopener noreferrer"
            class="social-link"
            aria-label={m.creator_visit_instagram()}
          >
            <InstagramIcon size={18} />
          </a>
        {/if}
      </div>
    {/if}

    {#if !data.user}
      <a href="/login" class="follow-btn">{m.creator_profile_follow()}</a>
    {/if}
  </section>

  <!-- Organizations Section -->
  {#if organizations.length > 0}
    <section class="orgs-section">
      <h2 class="orgs-section__title">Organizations</h2>
      <div class="orgs-grid">
        {#each organizations as org (org.id)}
          <a href={buildOrgUrl(page.url, org.slug, '/')} class="org-card">
            <div class="org-card__icon">
              {#if org.logoUrl}
                <img src={org.logoUrl} alt="" class="org-card__logo" />
              {:else}
                <span class="org-card__initial">{org.name[0]}</span>
              {/if}
            </div>
            <span class="org-card__name">{org.name}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Content Section -->
  <section class="content-section">
    <h2 class="content-section__title">{m.creator_profile_latest_content()}</h2>

    {#if contentItems.length > 0}
      <div class="content-grid">
        {#each contentItems as item (item.id)}
          <ContentCard
            id={item.id}
            title={item.title}
            thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
            description={item.description}
            contentType={item.contentType === 'written' ? 'article' : item.contentType}
            duration={item.mediaItem?.durationSeconds ?? null}
            href={buildContentUrl(page.url, item)}
            price={item.priceCents != null ? {
              amount: item.priceCents,
              currency: 'GBP',
            } : null}
          />
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <FileIcon size={48} class="empty-state__icon" stroke-width="1.5" />
        <p class="empty-state__text">{m.creator_profile_no_content()}</p>
      </div>
    {/if}
  </section>
</div>

<style>
  /* ── Layout ── */
  .profile {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-12, 3rem);
  }

  /* ── Profile Header ── */
  .profile-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3, 0.75rem);
    padding-bottom: var(--space-8, 2rem);
    border-bottom: var(--border-width, 1px) var(--border-style, solid) var(--color-border);
  }

  .profile-header__avatar {
    margin-bottom: var(--space-2, 0.5rem);
  }

  .profile-header__name {
    margin: 0;
    font-size: var(--text-3xl, 1.875rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .profile-header__username {
    margin: 0;
    font-size: var(--text-base, 1rem);
    color: var(--color-text-muted);
  }

  .profile-header__bio {
    margin: 0;
    font-size: var(--text-base, 1rem);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    max-width: 560px;
  }

  /* ── Social Links ── */
  .profile-header__social {
    display: flex;
    gap: var(--space-2, 0.5rem);
    margin-top: var(--space-2, 0.5rem);
  }

  .social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10, 2.5rem);
    height: var(--space-10, 2.5rem);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md, 0.375rem);
    transition: var(--transition-colors);
  }

  .social-link:hover {
    color: var(--color-text);
    background: var(--color-surface-variant);
  }

  /* ── Follow Button ── */
  .follow-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-6, 1.5rem);
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-semibold, 600);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md, 0.375rem);
    text-decoration: none;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .follow-btn:hover {
    background: var(--color-interactive-hover);
  }

  /* ── Organizations Section ── */
  .orgs-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
  }

  .orgs-section__title {
    margin: 0;
    font-size: var(--text-xl, 1.25rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text);
  }

  .orgs-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3, 0.75rem);
  }

  .org-card {
    display: flex;
    align-items: center;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    border-radius: var(--radius-lg, 0.5rem);
    background: var(--color-surface);
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-border);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .org-card:hover {
    border-color: var(--color-brand-primary-subtle);
    background: var(--color-interactive-subtle);
  }

  .org-card__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10, 2.5rem);
    height: var(--space-10, 2.5rem);
    border-radius: var(--radius-md, 0.375rem);
    background: var(--color-surface-secondary);
    flex-shrink: 0;
    overflow: hidden;
  }

  .org-card__logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .org-card__initial {
    font-size: var(--text-base, 1rem);
    font-weight: var(--font-semibold, 600);
    color: var(--color-text-secondary);
  }

  .org-card__name {
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-medium, 500);
    color: var(--color-text);
  }

  /* ── Content Section ── */
  .content-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-6, 1.5rem);
  }

  .content-section__title {
    margin: 0;
    font-size: var(--text-2xl, 1.5rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6, 1.5rem);
  }

  @media (--breakpoint-sm) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* ── Empty State ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4, 1rem);
    padding: var(--space-16, 4rem) var(--space-4, 1rem);
    text-align: center;
  }

  .empty-state__icon {
    color: var(--color-text-muted);
    opacity: var(--opacity-60);
  }

  .empty-state__text {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
    color: var(--color-text-muted);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .profile {
      padding: var(--space-6, 1.5rem) var(--space-4, 1rem);
      gap: var(--space-8, 2rem);
    }

    .profile-header__name {
      font-size: var(--text-2xl, 1.5rem);
    }
  }

  /* ── Dark Mode ── */
  :global([data-theme='dark']) .orgs-section__title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .org-card {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .org-card:hover {
    border-color: var(--color-interactive-active);
    background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface));
  }

  :global([data-theme='dark']) .org-card__initial {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .org-card__name {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .profile-header {
    border-bottom-color: var(--color-border);
  }

  :global([data-theme='dark']) .profile-header__name,
  :global([data-theme='dark']) .content-section__title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .profile-header__username {
    color: var(--color-text-muted, #94a3b8);
  }

  :global([data-theme='dark']) .profile-header__bio {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .social-link {
    color: var(--color-text-secondary);
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .social-link:hover {
    background: var(--color-neutral-800);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .empty-state__text {
    color: var(--color-text-muted, #94a3b8);
  }

  :global([data-theme='dark']) .empty-state__icon {
    color: var(--color-text-muted, #94a3b8);
  }
</style>
