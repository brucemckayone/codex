<!--
  @component CreatorProfilePage

  Public creator profile page showing avatar, name, bio, social links,
  stats strip, org affiliations, and a grid of their published content.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl, buildOrgUrl } from '$lib/utils/subdomain';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { Badge } from '$lib/components/ui/Badge';
  import { GlobeIcon, TwitterIcon, YoutubeIcon, InstagramIcon, FileIcon, UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
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
  const hasStats = $derived(contentItems.length > 0 || organizations.length > 0);
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
  <!-- Profile Hero -->
  <section class="profile-hero">
    <div class="profile-hero__avatar">
      <Avatar src={avatar} class="avatar--xl">
        {#if avatar}
          <AvatarImage src={avatar} alt={displayName} />
        {/if}
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
    </div>

    <h1 class="profile-hero__name">{displayName}</h1>
    <p class="profile-hero__username">@{username}</p>

    {#if bio}
      <p class="profile-hero__bio">{bio}</p>
    {/if}

    {#if hasStats}
      <div class="profile-hero__stats">
        <div class="stat-item">
          <FileIcon size={16} />
          <span>{m.creator_profile_stat_content({ count: String(contentItems.length) })}</span>
        </div>
        {#if organizations.length > 0}
          <span class="stat-divider" aria-hidden="true"></span>
          <div class="stat-item">
            <UsersIcon size={16} />
            <span>{m.creator_profile_stat_orgs({ count: String(organizations.length) })}</span>
          </div>
        {/if}
      </div>
    {/if}

    {#if hasSocialLinks}
      <div class="profile-hero__social">
        {#if socialLinks?.website}
          <a
            href={socialLinks.website}
            target="_blank"
            rel="noopener noreferrer"
            class="social-link"
            aria-label={m.creator_visit_website()}
            title={m.creator_visit_website()}
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
            title={m.creator_visit_twitter()}
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
            title={m.creator_visit_youtube()}
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
            title={m.creator_visit_instagram()}
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
      <h2 class="orgs-section__title">{m.creator_profile_organizations()}</h2>
      <p class="orgs-section__subtitle">{m.creator_profile_organizations_subtitle()}</p>
      <div class="orgs-grid">
        {#each organizations as org (org.id)}
          {@const orgContentCount = contentItems.filter(
            (item) => item.organization?.id === org.id
          ).length}
          <div class="org-card">
            <div class="org-card__header">
              <div class="org-card__icon">
                {#if org.logoUrl}
                  <img src={org.logoUrl} alt="" class="org-card__logo" />
                {:else}
                  <span class="org-card__initial">{org.name[0]}</span>
                {/if}
              </div>
              <div class="org-card__info">
                <span class="org-card__name">{org.name}</span>
                <Badge variant="neutral">{m.creator_profile_role_creator()}</Badge>
              </div>
            </div>
            {#if orgContentCount > 0}
              <span class="org-card__content-count">
                {m.creator_profile_org_content_count({ count: String(orgContentCount) })}
              </span>
            {/if}
            <a
              href={buildOrgUrl(page.url, org.slug, '/')}
              class="org-card__link"
            >
              {m.creator_profile_view_on_org({ name: org.name })} &rarr;
            </a>
          </div>
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
            contentAccessType={item.accessType}
          />
        {/each}
      </div>
    {:else}
      <EmptyState title={m.creator_profile_no_content()} description={m.creator_profile_no_content_description()} icon={FileIcon} />
    {/if}
  </section>
</div>

<style>
  /* ── Layout ── */
  .profile {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* ── Profile Hero ── */
  .profile-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3);
    padding-bottom: var(--space-8);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .profile-hero__avatar {
    margin-bottom: var(--space-2);
  }

  .profile-hero__avatar :global(.avatar) {
    width: var(--space-24);
    height: var(--space-24);
    font-size: var(--text-2xl);
  }

  .profile-hero__name {
    margin: 0;
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .profile-hero__username {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text-muted);
  }

  .profile-hero__bio {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 560px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Stats Strip ── */
  .profile-hero__stats {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .stat-divider {
    width: var(--border-width);
    height: var(--space-4);
    background: var(--color-border);
  }

  /* ── Social Links ── */
  .profile-hero__social {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-11);
    height: var(--space-11);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
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
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-6);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md);
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
    gap: var(--space-4);
  }

  .orgs-section__title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .orgs-section__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .orgs-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .org-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-shadow);
  }

  .org-card:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--color-brand-primary-subtle);
  }

  .org-card__header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .org-card__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-lg);
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
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .org-card__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .org-card__name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .org-card__content-count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .org-card__link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .org-card__link:hover {
    color: var(--color-interactive-hover);
  }

  /* ── Content Section ── */
  .content-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .content-section__title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (--breakpoint-sm) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .orgs-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }

    .orgs-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .profile {
      padding: var(--space-6) var(--space-4);
      gap: var(--space-8);
    }

    .profile-hero__avatar :global(.avatar) {
      width: var(--space-20);
      height: var(--space-20);
      font-size: var(--text-xl);
    }

    .profile-hero__name {
      font-size: var(--text-2xl);
    }

    .profile-hero__stats {
      flex-direction: column;
      gap: var(--space-2);
    }

    .stat-divider {
      display: none;
    }

    .profile-hero__social {
      gap: var(--space-2);
    }
  }

  /* ── Dark Theme ── */
  :global([data-theme='dark']) .org-card:hover {
    border-color: var(--color-interactive-active);
    background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface));
    box-shadow: var(--shadow-md);
  }
</style>
