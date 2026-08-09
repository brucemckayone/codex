<!--
  @component OrgCreatorsPage

  A creators CONTACT SHEET: one square portrait per person, many per row,
  uniform rows. Clicking a cell opens a profile drawer with full details,
  social links and latest content.

  ## Why the grid is one line and not a breakpoint ladder

  `repeat(auto-fill, minmax(min(100%, 13rem), 1fr))` replaces both a hardcoded
  two-column rule and a `--single` special case. `auto-fill` (unlike `auto-fit`)
  keeps empty tracks, so an org with one or two creators gets cells the same size
  as an org with twenty instead of one enormous stretched card — which is exactly
  why the special case existed. The `min(100%, …)` guard stops the track floor
  from overflowing a container narrower than the floor itself.

  ## Why the masthead is a PageHeader with no kicker

  It gives the page a lede and a meta row carrying the count, and it aligns
  /creators with its own siblings — explore and library are both
  `--container-max` and left-aligned, while this page was 960px and centred.
  The kicker is deliberately omitted: its contract is section wayfinding, and
  there is no section above /creators on a public space, so any kicker text would
  be invented. That means no brand ink in this masthead, which is correct — the
  brand already saturates the chrome here (rail, logo, org background).
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { CreatorCard, CreatorProfileDrawer } from '$lib/components/ui/CreatorCard';
  import type { CreatorDrawerData } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { PageHeader } from '$lib/components/ui';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { StructuredData } from '$lib/components/seo';
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

  /**
   * The cell whose hit area opened the drawer.
   *
   * Deliberately NOT `$state` — nothing renders from it. It exists only so the
   * drawer can hand it to Melt's `closeFocus`: the drawer is opened
   * programmatically rather than through a `Dialog.Trigger`, so Melt has no
   * restore target of its own and Escape used to drop focus to `<body>`, making
   * a keyboard user re-tab the entire page (WCAG 2.4.3).
   */
  let drawerTrigger: HTMLElement | null = null;

  function openCreator(
    creator: typeof items[number],
    event: MouseEvent & { currentTarget: HTMLButtonElement }
  ) {
    drawerTrigger = event.currentTarget;
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

  // ── SEO ──────────────────────────────────────────────────────────
  // Canonical includes ?page= (each paginated page is a distinct
  // discoverable URL). Self-referencing pagination is safe per
  // current Google guidance; the prior rel=next/prev hint is ignored.
  const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}${page.url.search}`);

  // CollectionPage with an ItemList of Person entities — helps Google
  // surface the directory in people-search contexts and associate
  // individual creators with the org.
  const collectionSchema = $derived<Record<string, unknown>>({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${m.org_creators_title()} | ${orgName}`,
    description: m.org_creators_subtitle(),
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: orgName,
      url: page.url.origin,
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: total,
      itemListElement: items.map((c, i) => ({
        '@type': 'ListItem',
        position: (currentPage - 1) * limit + i + 1,
        item: {
          '@type': 'Person',
          name: c.name,
          ...(c.avatarUrl && { image: c.avatarUrl }),
          ...(c.bio && { description: c.bio }),
          ...(c.username && {
            url: `${page.url.origin}/explore?creator=${encodeURIComponent(c.username)}`,
          }),
        },
      })),
    },
  });
</script>

<svelte:head>
  <title>{m.org_creators_title()} | {orgName}</title>
  <link rel="canonical" href={canonicalUrl} />
  <meta name="description" content="{m.org_creators_subtitle()}" />
  <meta property="og:title" content="{m.org_creators_title()} | {orgName}" />
  <meta property="og:description" content={m.org_creators_subtitle()} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonicalUrl} />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="{m.org_creators_title()} | {orgName}" />
  <meta name="twitter:description" content={m.org_creators_subtitle()} />
</svelte:head>

<StructuredData data={collectionSchema} />

<div class="creators">
  <PageHeader
    title={m.org_creators_title()}
    description={m.org_creators_subtitle()}
  >
    {#snippet meta()}
      <!-- One fact only. The page position already has a home: the Pagination
           control renders "Page 1 of 2" beneath the grid. -->
      {#if total > 0}
        <li>
          {total === 1
            ? m.org_hero_creators_count_one()
            : m.org_hero_creators_count({ count: total })}
        </li>
      {/if}
    {/snippet}
  </PageHeader>

  {#if items.length > 0}
    <!--
      A real list, so assistive tech announces "list, 12 items" and the cells are
      countable. Keyed on `creator.id`: `username` is nullable and `name` is not
      unique, so the previous `username ?? name` key would throw on two
      anonymous namesakes.
    -->
    <ul class="creators__grid">
      {#each items as creator (creator.id)}
        <li class="creators__cell">
          <CreatorCard
            variant="showcase"
            username={creator.username ?? ''}
            displayName={creator.name}
            avatar={creator.avatarUrl}
            bio={creator.bio}
            contentCount={creator.contentCount}
            role={creator.role}
            onclick={(event) => openCreator(creator, event)}
          />
        </li>
      {/each}
    </ul>

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

<!-- Profile Drawer.
     `closeFocus` is a getter, not the element: this one component serves every
     cell, so the restore target changes on each open and has to be read at close
     time. -->
<CreatorProfileDrawer
  bind:open={drawerOpen}
  creator={selectedCreator}
  orgSlug={data.org?.slug ?? ''}
  closeFocus={() => drawerTrigger}
/>

<style>
  /* ── Layout ──
     Matches explore and library exactly: --container-max, left-aligned,
     same padding rhythm. This page was the odd one out at a hardcoded 960px. */
  .creators {
    inline-size: 100%;
    max-inline-size: var(--container-max);
    margin-inline: auto;
    padding: var(--space-8) var(--space-8) var(--space-16);
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  /* ── Contact sheet ──
     One declaration for every viewport. At --container-max this resolves to five
     even tracks; at 390px the below-sm floor gives two. `auto-fill` keeps empty
     tracks so a one- or two-creator org still gets normal-sized cells. */
  .creators__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
    column-gap: var(--space-5);
    row-gap: var(--space-8);
    /* `align-content` keeps the ROW TRACKS packed to the top; `align-items`
       stops each CELL from stretching to its track. Both are needed. Without
       `align-items: start` a cell inherits the track height, and I measured two
       neighbours at 275.3px and 283.3px with byte-identical contents — invisible
       while the card is transparent, but the moment one is hovered its tile
       paints 8px taller than the cell beside it. */
    align-content: start;
    align-items: start;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .creators__cell {
    display: flex;
    min-inline-size: 0;
  }

  .creators__cell > :global(*) {
    inline-size: 100%;
  }

  /* ── Pagination ── */
  .creators__pagination {
    display: flex;
    justify-content: center;
    padding-block-start: var(--space-4);
  }

  /* ── Narrow viewports ── */
  @media (--below-sm) {
    .creators {
      /* The last row used to sit under the mobile tab bar. */
      padding: var(--space-6) var(--space-4)
        calc(var(--space-16) + env(safe-area-inset-bottom, 0px));
      gap: var(--space-6);
    }

    .creators__grid {
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
      column-gap: var(--space-3);
      row-gap: var(--space-6);
    }
  }
</style>
