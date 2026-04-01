<!--
  @component CreatorProfilePage

  Public creator profile page showing avatar, name, bio, social links,
  and a grid of their published content.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const username = $derived(data.username ?? 'Creator');
  const profile = $derived(data.creatorProfile);
  const displayName = $derived(profile?.name ?? username);
  const avatar = $derived(profile?.image ?? null);
  const bio = $derived(profile?.bio ?? m.creator_profile_bio_default());
  const socialLinks = $derived(profile?.socialLinks ?? null);
  const contentItems = $derived(data.contentItems ?? []);
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2 0 1.6-1 3-2 4 .8.1 2-.2 2-.5-3.2 3.2-8 2-10.5-3C-.4 7.3 3.3 1.2 8.5 1c2.1-.1 4 1.2 5.5 1.2.8 0 2.2-1.2 3.5-1.5z"></path>
            </svg>
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
              <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon>
            </svg>
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
          </a>
        {/if}
      </div>
    {/if}

    {#if !data.user}
      <a href="/login" class="follow-btn">{m.creator_profile_follow()}</a>
    {/if}
  </section>

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
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state__icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
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
    line-height: 1.2;
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
    line-height: 1.6;
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
    color: #ffffff;
    background: var(--color-primary-500);
    border: none;
    border-radius: var(--radius-md, 0.375rem);
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .follow-btn:hover {
    background: var(--color-primary-600);
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
    opacity: 0.6;
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
  :global([data-theme='dark']) .profile-header {
    border-bottom-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .profile-header__name,
  :global([data-theme='dark']) .content-section__title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .profile-header__username {
    color: var(--color-text-muted-dark, #94a3b8);
  }

  :global([data-theme='dark']) .profile-header__bio {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .social-link {
    color: var(--color-text-secondary-dark);
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .social-link:hover {
    background: var(--color-neutral-800);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .empty-state__text {
    color: var(--color-text-muted-dark, #94a3b8);
  }

  :global([data-theme='dark']) .empty-state__icon {
    color: var(--color-text-muted-dark, #94a3b8);
  }
</style>
