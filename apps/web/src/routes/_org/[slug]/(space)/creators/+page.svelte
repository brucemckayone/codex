<!--
  @component OrgCreatorsPage

  Photo-dominant creators directory. Each creator is displayed as a
  portrait card (showcase variant). Clicking a card opens a profile
  drawer with full details, social links, and latest content.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { CreatorCard, CreatorProfileDrawer } from '$lib/components/ui/CreatorCard';
  import type { CreatorDrawerData } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');
  const items = $derived(data.creators?.items ?? []);
  const total = $derived(data.creators?.total ?? 0);
  const currentPage = $derived(data.pagination?.page ?? 1);
  const limit = $derived(data.pagination?.limit ?? 12);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));

  // Drawer state
  let selectedCreator = $state<CreatorDrawerData | null>(null);
  let drawerOpen = $state(false);

  function openCreator(creator: typeof items[number]) {
    selectedCreator = {
      name: creator.name,
      username: creator.username ?? null,
      avatarUrl: creator.avatarUrl ?? null,
      bio: creator.bio ?? null,
      socialLinks: creator.socialLinks ?? null,
      role: creator.role,
      joinedAt: creator.joinedAt,
      contentCount: creator.contentCount,
      recentContent: creator.recentContent ?? [],
      organizations: creator.organizations ?? [],
    };
    drawerOpen = true;
  }

  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });
</script>

<svelte:head>
  <title>{m.org_creators_title()} | {orgName}</title>
  <meta name="description" content="{m.org_creators_subtitle()}" />
  <meta property="og:title" content="{m.org_creators_title()} | {orgName}" />
  <meta property="og:description" content={m.org_creators_subtitle()} />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="creators">
  <!-- Header -->
  <header class="creators__header">
    <h1 class="creators__title">{m.org_creators_title()}</h1>
    <p class="creators__subtitle">{m.org_creators_subtitle()}</p>
  </header>

  <!-- Creators Grid -->
  {#if items.length > 0}
    <div class="creators__grid" class:creators__grid--single={items.length === 1}>
      {#each items as creator (creator.username ?? creator.name)}
        <CreatorCard
          variant="showcase"
          username={creator.username ?? creator.name.toLowerCase().replace(/\s+/g, '-')}
          displayName={creator.name}
          avatar={creator.avatarUrl}
          bio={creator.bio}
          contentCount={creator.contentCount}
          role={creator.role}
          recentContent={creator.recentContent}
          onclick={() => openCreator(creator)}
        />
      {/each}
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
      <div class="creators__pagination">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else}
    <EmptyState
      title={m.org_creators_empty()}
      description={m.org_creators_empty_description()}
      icon={UsersIcon}
    />
  {/if}
</div>

<!-- Profile Drawer -->
<CreatorProfileDrawer
  bind:open={drawerOpen}
  creator={selectedCreator}
  orgSlug={data.org?.slug ?? ''}
/>

<style>
  /* ── Layout ── */
  .creators {
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-12) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
  }

  /* ── Header ── */
  .creators__header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3);
  }

  .creators__title {
    margin: 0;
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    font-family: var(--font-heading);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .creators__subtitle {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 420px;
  }

  /* ── Grid — bento-style, large cards ── */
  .creators__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  /* Single creator: constrain width */
  .creators__grid--single {
    max-width: 400px;
    margin: 0 auto;
    width: 100%;
  }

  @media (--breakpoint-sm) {
    .creators__grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .creators__grid--single {
      grid-template-columns: 1fr;
    }
  }

  /* ── Pagination ── */
  .creators__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .creators {
      padding: var(--space-8) var(--space-4);
      gap: var(--space-8);
    }

    .creators__title {
      font-size: var(--text-2xl);
    }

    .creators__subtitle {
      font-size: var(--text-base);
    }
  }
</style>
