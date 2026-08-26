<!--
  @component OrgLibraryPage

  The member library scoped to this organization (SPEC §8.4) — a candlelit
  "room" that gathers the journeys you're on and the practices you've kept:

    • Header + toolbar (search + facet chips)
    • "Jump back in" — a resume rail mixing in-progress JOURNEYS (→ the in-course
      player) with resumeable standalone MEDIA (from the progress store).
    • "Your journeys" — enrolled courses with a progress ring + access badge,
      each linking to the journey dashboard.
    • "Everything you own" — the owned-content grid, grouped Recent / Type /
      Source, with access-source badges and the journey "seam" note.
    • First-run onboarding when the member has no journeys and no content.

  Data seam: enrolled courses come from the server load (`data.enrolledCourses`,
  worker-scoped to the session + org); owned content stays client-side in the
  localStorage-backed `libraryCollection` (filtered to this org).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    type LibraryItem,
    libraryCollection,
    loadLibraryFromServer,
    useLiveQuery,
  } from '$lib/collections';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import JourneyEntryCard from '$lib/components/journeys/JourneyEntryCard.svelte';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import {
    enrolledCoursePortalStripEntry,
    enrolledCourseRowEntry,
    resumeProgress,
  } from '$lib/components/journeys/journey-entry-card';
  import type { EnrolledCourseSummary } from '$lib/journeys/types';
  import { filterLibraryItemsByOrg } from '$lib/library/filter-by-org';
  import { buildContentUrl, buildJourneyUrl } from '$lib/utils/subdomain';

  let { data } = $props();

  const orgName = $derived(data.org?.name ?? 'your library');
  const orgId = $derived(data.org?.id);
  const memberName = $derived(data.user?.name?.split(' ')[0]?.trim() || null);
  const enrolledCourses = $derived(
    (data.enrolledCourses ?? []) as EnrolledCourseSummary[]
  );

  // Auth guard — redirect unauthenticated users client-side (parity with the
  // prior page; the loader also returns [] for anonymous callers).
  $effect(() => {
    if (!data.user) {
      goto(`/login?redirect=${encodeURIComponent(page.url.pathname)}`);
    }
  });

  // ── Owned content — client-side, from the localStorage library collection ──
  const libraryQuery = useLiveQuery(
    (q) =>
      q
        .from({ item: libraryCollection })
        .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc'),
    undefined,
    { ssrData: [] as LibraryItem[] }
  );
  const ownedItems = $derived(
    filterLibraryItemsByOrg((libraryQuery.data ?? []) as LibraryItem[], orgId)
  );

  /**
   * Has the server refresh finished (either way)? Starts false — including on
   * the server, where it can never be true.
   */
  let serverFetchSettled = $state(false);

  onMount(async () => {
    try {
      await loadLibraryFromServer();
    } catch {
      // Non-fatal — an empty grid degrades gracefully.
    } finally {
      serverFetchSettled = true;
    }
  });

  /**
   * "We do not know what you own yet" — as distinct from "you own nothing".
   *
   * Derived rather than assigned in `onMount`, because the previous flag started
   * `false` and only flipped to `true` inside `onMount`. That made the SSR pass —
   * where `ssrData` is `[]` and no effect has run — indistinguishable from a
   * settled empty library, so the server baked the first-run onboarding into the
   * HTML for members who own plenty, and the real content replaced it a beat
   * later. The library fetch takes several seconds, so that flash was very
   * visible rather than theoretical.
   *
   * Any locally-cached item short-circuits this to `false`, so a return visit
   * paints from localStorage immediately and never shows a skeleton — the
   * skeleton is only for members with genuinely nothing cached yet.
   */
  const ownedPending = $derived(!serverFetchSettled && ownedItems.length === 0);

  // ── Static maps ────────────────────────────────────────────────────────────
  const TYPE_META: Record<string, { label: string; glyph: string }> = {
    video: { label: 'video', glyph: '▷' },
    audio: { label: 'audio', glyph: '♪' },
    written: { label: 'article', glyph: '✎' },
  };
  const typeMeta = (t: string | null | undefined) =>
    TYPE_META[t ?? ''] ?? { label: t ?? 'practice', glyph: '◆' };

  const TONES = ['tone-0', 'tone-1', 'tone-2', 'tone-3'] as const;
  const hashInt = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };
  const toneFor = (s: string) => TONES[hashInt(s) % TONES.length];

  const fmtTime = (secs: number | null | undefined) => {
    const s = Math.max(0, Math.round(secs ?? 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };

  // Compact "last opened" relative label for owned rows (matches the prototype's
  // "2h ago" / "Yesterday" / "3 days ago" / "Last week" cues).
  const relativeTime = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diff = Date.now() - then;
    const day = 86_400_000;
    if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
    if (diff < day) return `${Math.round(diff / 3_600_000)}h ago`;
    const days = Math.round(diff / day);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 14) return 'Last week';
    if (days < 30) return `${Math.round(days / 7)} weeks ago`;
    const months = Math.round(days / 30);
    return months <= 1 ? 'Last month' : `${months} months ago`;
  };

  // Access-source → badge. Owned content maps its `accessType`; portal cards
  // map the enrollment `source`. Unknown sources render no badge (never guess).
  type Badge = { cls: string; label: string };
  const badgeFor = (via: string | null | undefined): Badge | null => {
    if (!via) return null;
    if (via.startsWith('course:')) {
      return { cls: 'course', label: `part of ${via.slice(7)}` };
    }
    switch (via) {
      case 'paid':
      case 'purchased':
      case 'course_purchase':
        return { cls: 'purchased', label: 'purchased' };
      case 'subscribers':
      case 'members':
      case 'membership':
      case 'subscription':
      case 'tier_subscription':
        return { cls: 'member', label: 'via membership' };
      case 'course_subscription':
        return { cls: 'member', label: 'via subscription' };
      case 'grant':
        return { cls: 'member', label: 'included' };
      case 'free':
      case 'followers':
        return { cls: 'free', label: 'free' };
      default:
        return null;
    }
  };
  /**
   * The badge an owned row carries.
   *
   * Portal PROVENANCE wins over access route. A practice inside a portal is
   * almost always ALSO reachable some other way (an owner reaches everything
   * "via membership"), so showing the access route there would bury the more
   * useful fact — that opening this practice means stepping into a portal, and
   * that its progress counts toward one. `+n` when a practice is shared by
   * several portals, which `stage_practices` permits.
   */
  const ownedBadge = (item: LibraryItem): Badge | null => {
    const portals = item.journeys ?? [];
    const first = portals[0];
    if (first) {
      const extra = portals.length > 1 ? ` +${portals.length - 1}` : '';
      return { cls: 'course', label: `part of ${first.title}${extra}` };
    }
    return badgeFor(item.accessType);
  };

  /**
   * Bucket for `group by: source`. Exhaustive over the API's real `accessType`
   * union — `purchased | membership | subscription | free | followers`.
   *
   * It previously also tested `'paid'`, `'subscribers'` and `'members'`, which
   * the API has never returned for a library item. Those branches were
   * invisible dead code while the published type under-declared the union (see
   * `@codex/access` types.ts); with the type derived from the service, the
   * compiler flags them, so they are gone.
   */
  const sourceGroup = (item: LibraryItem) => {
    if ((item.journeys?.length ?? 0) > 0) return 'Part of a portal';
    switch (item.accessType) {
      case 'purchased':
        return 'Purchased';
      case 'membership':
      case 'subscription':
        return 'Included with membership';
      default:
        return 'Free';
    }
  };

  // Routed through `buildJourneyUrl` rather than hand-built, so the slug→id
  // fallback and the cross-org absolute form live in one place.
  const journeyUrlTarget = (c: EnrolledCourseSummary) => ({
    slug: c.course.slug,
    id: c.course.id,
    organizationSlug: c.course.organizationSlug,
  });
  const journeyDashboardHref = (c: EnrolledCourseSummary) =>
    buildJourneyUrl(page.url, journeyUrlTarget(c), { surface: 'dashboard' });
  // The deep `practice/[contentSlug]` surface is deliberately NOT one of
  // `buildJourneyUrl`'s surfaces (`sales | checkout | dashboard`) — it takes a
  // SECOND slug and is always same-origin from inside the course, so its own
  // routes compose it. Composed onto the helper's org-resolved sales root so
  // the org resolution still is not duplicated here.
  const journeyResumeHref = (c: EnrolledCourseSummary) =>
    c.progress.nextPracticeSlug
      ? `${buildJourneyUrl(page.url, journeyUrlTarget(c))}/practice/${c.progress.nextPracticeSlug}`
      : journeyDashboardHref(c);

  // ── Filter state ─────────────────────────────────────────────────────────
  let facetKind = $state<'all' | 'inprogress' | 'journeys' | 'type'>('all');
  let facetType = $state<'video' | 'audio' | 'written' | null>(null);
  let query = $state('');
  let groupBy = $state<'recent' | 'type' | 'source'>('recent');

  const q = $derived(query.trim().toLowerCase());
  const matchQ = (t: string | null | undefined) =>
    !q || (t ?? '').toLowerCase().includes(q);

  const ownedTypes = $derived(
    [
      ...new Set(
        ownedItems
          .map((i) => i.content?.contentType)
          .filter((t): t is 'video' | 'audio' | 'written' => Boolean(t))
      ),
    ].sort()
  );

  // Only claim "you have nothing" once the server has actually said so.
  const isFirstRun = $derived(
    !ownedPending && enrolledCourses.length === 0 && ownedItems.length === 0
  );

  const showContinue = $derived(facetKind === 'all' && !q);
  const showJourneys = $derived(
    (facetKind === 'all' ||
      facetKind === 'journeys' ||
      facetKind === 'inprogress') &&
      enrolledCourses.length > 0
  );
  const showOwn = $derived(
    facetKind !== 'journeys' && facetKind !== 'inprogress'
  );

  // Continue rail — in-progress journeys + resumeable standalone media.
  const continueJourneys = $derived(
    enrolledCourses.filter((c) => c.progress.status === 'in-progress')
  );
  const continueMedia = $derived(
    ownedItems.filter(
      (i) =>
        i.progress &&
        !i.progress.completed &&
        (i.progress.positionSeconds ?? 0) > 0
    )
  );
  const hasContinue = $derived(
    continueJourneys.length + continueMedia.length > 0
  );

  // Journeys shelf.
  const journeysShown = $derived.by(() => {
    let list = enrolledCourses.filter((c) => matchQ(c.course.title));
    if (facetKind === 'inprogress') {
      list = list.filter((c) => c.progress.status === 'in-progress');
    }
    return list;
  });

  // Owned grid.
  const ownedShown = $derived.by(() => {
    let list = ownedItems.filter((i) => matchQ(i.content?.title));
    if (facetKind === 'type' && facetType) {
      list = list.filter((i) => i.content?.contentType === facetType);
    }
    return list;
  });

  const ownTitle = $derived(
    facetKind === 'type' && facetType
      ? `${typeMeta(facetType).label}s`
      : 'Everything you own'
  );

  type OwnGroup = { key: string; items: LibraryItem[] };
  const ownedGroups = $derived.by<OwnGroup[]>(() => {
    const list = ownedShown;
    if (groupBy === 'type') {
      return groupByKey(list, (i) => typeMeta(i.content?.contentType).label);
    }
    if (groupBy === 'source') {
      return groupByKey(list, (i) => sourceGroup(i), [
        'Part of a portal',
        'Included with membership',
        'Purchased',
        'Free',
      ]);
    }
    return [{ key: '', items: list }];
  });

  function groupByKey(
    list: LibraryItem[],
    keyFn: (i: LibraryItem) => string,
    order?: string[]
  ): OwnGroup[] {
    const map = new Map<string, LibraryItem[]>();
    for (const item of list) {
      const k = keyFn(item);
      const bucket = map.get(k);
      if (bucket) bucket.push(item);
      else map.set(k, [item]);
    }
    let keys = [...map.keys()];
    if (order) keys = keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return keys.map((k) => ({ key: k, items: map.get(k) ?? [] }));
  }

  function selectType(t: 'video' | 'audio' | 'written') {
    facetKind = 'type';
    facetType = t;
  }
  function selectFacet(kind: 'all' | 'inprogress' | 'journeys') {
    facetKind = kind;
    facetType = null;
  }
</script>

<svelte:head>
  <title>Your {orgName} library</title>
  <!-- Private authenticated page — never index a member's personal library. -->
  <meta name="robots" content="noindex, follow" />
</svelte:head>

<!-- The owned-content ROWS' small type motif. The `big` variant went with the
     resume strip, which now renders real covers via `JourneyEntryCard`. -->
{#snippet motif(title: string, glyph: string)}
  <span class="thumb {toneFor(title)}">
    <span class="thumb__art"></span>
    <span class="thumb__glyph">{glyph}</span>
  </span>
{/snippet}

<!-- One portal in the "Your portals" carousel. -->
{#snippet portalCard(c: EnrolledCourseSummary)}
  {@const badge = badgeFor(c.enrollmentSource)}
  <JourneyEntryCard
    {...enrolledCoursePortalStripEntry(c, journeyDashboardHref(c), {
      accessLabel: badge?.label ?? null,
    })}
  />
{/snippet}

<main class="library" data-testid="member-library">
  {#if isFirstRun}
    <div class="firstrun">
      <p class="firstrun__kicker">Welcome to {orgName}</p>
      <h1 class="firstrun__title">Your library will grow here.</h1>
      <p class="firstrun__sub">
        As you gather practices and enter portals, they'll live in this room —
        the ones you're on, and the ones you've kept. For now, there's one clear
        place to begin.
      </p>
      <a class="firstrun__card" href="/explore">
        <span class="firstrun__cover">❋</span>
        <span class="firstrun__body">
          <span class="firstrun__ck">Start here</span>
          <span class="firstrun__ct">Explore {orgName}</span>
          <span class="firstrun__cd">
            Browse the catalogue and find your first practice or portal.
          </span>
          <span class="firstrun__cta">Browse everything →</span>
        </span>
      </a>
    </div>
  {:else}
    <header class="lib-head">
      <p class="lib-head__kicker">Your library</p>
      <h1 class="lib-head__title">
        {memberName ? `Welcome back, ${memberName}` : 'Welcome back'}
      </h1>
      <p class="lib-head__sub">
        Everything you've gathered lives here — portals you're on, and the
        practices you've kept.
      </p>
    </header>

    <div class="toolbar">
      <label class="search">
        <span class="search__icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search your library…"
          autocomplete="off"
          aria-label="Search your library"
          bind:value={query}
        />
      </label>
      <div class="chips" role="tablist" aria-label="Library filters">
        <button
          class="chip"
          class:chip--on={facetKind === 'all'}
          onclick={() => selectFacet('all')}>All</button
        >
        <button
          class="chip"
          class:chip--on={facetKind === 'inprogress'}
          onclick={() => selectFacet('inprogress')}>In progress</button
        >
        {#if enrolledCourses.length > 0}
          <button
            class="chip"
            class:chip--on={facetKind === 'journeys'}
            onclick={() => selectFacet('journeys')}>Portals</button
          >
        {/if}
        {#if ownedTypes.length > 0}
          <span class="chips__sep"></span>
          {#each ownedTypes as t (t)}
            <button
              class="chip"
              class:chip--on={facetKind === 'type' && facetType === t}
              onclick={() => selectType(t)}>{typeMeta(t).label}</button
            >
          {/each}
        {/if}
      </div>
    </div>

    <!-- Jump back in -->
    {#if showContinue && hasContinue}
      <section class="sec">
        <div class="sec__head">
          <h2>Jump back in</h2>
          <span class="sec__ct">across your portals &amp; practices</span>
        </div>
        <!--
          Journeys AND standalone practices render through the SAME card
          (Codex-tnwnu). They sit in one rail, so componentising only the
          journey half would have left two different-looking things side by
          side — the exact inconsistency this closes, just relocated. The card
          is a resume card, not a journey-only card: a cover, a kicker, a title,
          a meta line and a determinate progress bar describe both.
        -->
        <div class="cont">
          {#each continueJourneys as c (c.course.id)}
            <JourneyEntryCard
              {...enrolledCourseRowEntry(c, journeyResumeHref(c))}
            />
          {/each}
          {#each continueMedia as item (item.content?.id)}
            {@const m = typeMeta(item.content?.contentType)}
            {@const pos = item.progress?.positionSeconds ?? 0}
            {@const dur = item.progress?.durationSeconds ?? 0}
            {@const href = buildContentUrl(page.url, item.content)}
            <!--
              `resumeProgress` returns NULL, not 0%, when the duration is
              unknown — see its doc comment. Every item in this rail has been
              started, so a determinate "0%" bar would be a false claim about
              something demonstrably in progress.
            -->
            <JourneyEntryCard
              {href}
              title={item.content?.title ?? ''}
              kicker={m.label}
              meta={`${fmtTime(pos)}${dur > 0 ? ` of ${fmtTime(dur)}` : ''}`}
              coverImageUrl={item.content?.thumbnailUrl ?? null}
              layout="row"
              cta="Resume"
              progress={resumeProgress(pos, dur)}
            />
          {/each}
        </div>
      </section>
    {/if}

    <!-- Your journeys -->
    {#if showJourneys}
      <section class="sec">
        <div class="sec__head">
          <h2>Your portals</h2>
          <span class="sec__ct">{journeysShown.length} in your library</span>
        </div>
        {#if journeysShown.length > 0}
          <!--
            A CAROUSEL, not a wrapping grid. The grid put five portals on two
            rows and cost ~2x the vertical space for something the member scans
            once — worst on mobile, where each row is a full card tall. One
            scrolling row is a fixed height no matter how many portals you own.

            The shared `Carousel` is used rather than a bare scroll container
            precisely because the naive version of this is bad UX: it gives
            prev/next arrows that auto-hide at the ends, a visible thin
            scrollbar, scroll-snap, swipe, and roving focus that scrolls the
            focused card into view. The rail this replaces hid its scrollbar and
            offered no arrows, so there was nothing to tell you more existed.
          -->
          <!--
            25rem for the same reason `.cont` (the resume rail) is 26rem: a row
            card splits its width between cover and text, and at 22rem the text
            column was ~200px, which wrapped both the title and the
            "Next · <practice>" line. 25rem is also exactly the carousel item's
            400px ceiling, so it asks for what it can actually get.
          -->
          <Carousel
            items={journeysShown}
            itemMinWidth="25rem"
            ariaLabel="Your portals"
            renderItem={portalCard}
          />
        {:else}
          <p class="empty">No portals match — try another filter or search.</p>
        {/if}
      </section>
    {/if}

    <!-- Everything you own -->
    {#if showOwn}
      <section class="sec">
        <div class="sec__head">
          <h2>{ownTitle}</h2>
          <!-- Suppressed while pending: "0 pieces" is a claim, not a placeholder. -->
          {#if !ownedPending}
            <span class="sec__ct">
              {ownedShown.length}
              {ownedShown.length === 1 ? 'piece' : 'pieces'}
            </span>
          {/if}
          <div class="groupby">
            <span class="groupby__lbl">Group by</span>
            <div class="seg" role="group" aria-label="Group content by">
              <button
                class="seg__btn"
                class:seg__btn--on={groupBy === 'recent'}
                onclick={() => (groupBy = 'recent')}>Recent</button
              >
              <button
                class="seg__btn"
                class:seg__btn--on={groupBy === 'type'}
                onclick={() => (groupBy = 'type')}>Type</button
              >
              <button
                class="seg__btn"
                class:seg__btn--on={groupBy === 'source'}
                onclick={() => (groupBy = 'source')}>Source</button
              >
            </div>
          </div>
        </div>

        {#if ownedPending}
          <!--
            Mirrors the real row silhouette (motif + two text lines + end chip)
            in the same two-column grid, so the shelf does not reflow when the
            data lands. Eight rows is roughly a viewport's worth — enough to read
            as "a library is loading", not so many that it implies a count.
          -->
          <div class="rows" aria-hidden="true">
            {#each { length: 8 } as _, i (i)}
              <div class="row row--sk">
                <Skeleton
                  width="var(--space-12)"
                  height="var(--space-12)"
                  class="sk-thumb"
                />
                <div class="row--sk__t">
                  <!--
                    Title widths vary deterministically by index rather than
                    randomly: a column of identical bars reads as a table, and
                    Math.random() in a template would resample on every rerender
                    and make the bars twitch. Fixed rem rather than % now that
                    the text column is content-sized — a percentage of a
                    content-sized box collapses to nothing.
                  -->
                  <Skeleton
                    width="{9 + ((i * 17) % 7)}rem"
                    height="var(--text-base)"
                  />
                  <Skeleton width="3.5rem" height="var(--text-sm)" />
                </div>
                <Skeleton width="6.5rem" height="1.5rem" class="sk-chip" />
              </div>
            {/each}
          </div>
          <p class="sr-only" role="status">Loading your library…</p>
        {:else if ownedShown.length > 0}
          {#each ownedGroups as group (group.key)}
            <div class="grp">
              {#if group.key}
                <div class="grp__h">
                  {group.key}<span class="grp__n">{group.items.length}</span>
                </div>
              {/if}
              <div class="rows">
                {#each group.items as item (item.content?.id)}
                  {@const m = typeMeta(item.content?.contentType)}
                  {@const badge = ownedBadge(item)}
                  {@const opened = relativeTime(
                    item.progress?.updatedAt ?? item.purchase?.purchasedAt
                  )}
                  <a class="row" href={buildContentUrl(page.url, item.content)}>
                    {@render motif(item.content?.title ?? '', m.glyph)}
                    <span class="row__t">
                      <span class="row__title">{item.content?.title}</span>
                      <span class="row__meta">{m.label}</span>
                    </span>
                    {#if badge}
                      <!-- Sits NEXT TO the title, not at the far right edge:
                           "part of <portal>" describes the practice, so the two
                           belong together, and pinning it to the edge of a
                           full-width row opened a gutter wide enough to read as
                           a layout mistake. `title` keeps a name clipped by the
                           chip's max-width recoverable on hover. -->
                      <span class="badge badge--{badge.cls}" title={badge.label}
                        >{badge.label}</span
                      >
                    {/if}
                    {#if opened}
                      <!-- `margin-left: auto` — the only thing that earns the
                           right edge, and only on rows that have been opened. -->
                      <span class="row__opened">{opened}</span>
                    {/if}
                  </a>
                {/each}
              </div>
            </div>
          {/each}
        {:else}
          <p class="empty">Nothing matches — try another filter or search.</p>
        {/if}

        <p class="seam">
          <span class="seam__g" aria-hidden="true">↳</span>
          Practices that belong to a portal open inside it, so you keep your
          place and can mark them complete.
        </p>
      </section>
    {/if}
  {/if}
</main>

<style>
  /*
    Candlelit "room" (SPEC §8.4). The prototype palette is warm + dark; we
    re-point the semantic --color-* on the page root, deriving each shade from
    the org brand HUE via relative-color OKLCH — so the surface reads dark and
    on-brand rather than copying the prototype's literal colours. The shared
    `JourneyEntryCard`s in both rails inherit those tokens and adapt to the
    room. (This used to name `ProgressRing`, which the page no longer renders —
    the cards carry a progress BAR on the cover now, and the component was
    deleted once Codex-tnwnu orphaned its last two importers.)
  */
  .library {
    /*
      Inherit the org's REAL theme — no forced palette, no per-page --color-*
      re-point. studio-alpha resolves to dark (#0A0A0A surfaces) + green
      (#4ADE80 interactive) via org-brand.css; a light org would render light.
      The --lib-* helpers below are DERIVED from the semantic tokens (never
      overriding them), so they follow whatever theme the org applies —
      light-alpha hairlines / lifts on dark, dark-alpha on light.
    */
    --lib-ink: var(--color-surface);
    --lib-ink-2: color-mix(in oklab, var(--color-text) 6%, var(--color-surface));
    --lib-bone: var(--color-text);
    --lib-accent: var(--color-interactive);
    --lib-hair: color-mix(in oklab, var(--color-text) 12%, transparent);
    --lib-hair-strong: color-mix(
      in oklab,
      var(--color-interactive) 45%,
      transparent
    );

    /* Cover / motif variety, all from the brand-family accent (on-brand). */
    --tone-0: var(--color-interactive);
    --tone-1: var(--color-interactive-hover);
    --tone-2: var(--color-success);
    --tone-3: color-mix(in oklab, var(--color-interactive) 60%, var(--color-text));

    min-height: 100%;
    /*
      The page SURFACE is full-bleed (the background fills `org-main`, so the
      org's theme reaches every edge) but the CONTENT column is capped, the same
      way the org landing page does it (`(space)/+page.svelte`). Those are two
      separate things: the 2026-07-26 pass removed the cap to fix a narrow
      centred column showing the wrong background past its edges — a background
      problem, which `min-height`/`overflow-x` here already solve. Uncapped
      content on a wide display stretched the shelves to ~2000px, which is what
      this restores.

      `--container-max` (80rem) is the platform's one content-width token; the
      cap centres inside `org-main`, which is itself offset by the sidebar.
    */
    max-width: var(--container-max);
    margin-inline: auto;
    overflow-x: clip;
    padding: clamp(var(--space-6), 4vw, var(--space-12))
      clamp(var(--space-4), 4vw, var(--space-10)) var(--space-24);
  }

  /* ── Header ── */
  .lib-head {
    margin-bottom: var(--space-5);
  }
  .lib-head__kicker {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--lib-accent);
  }
  .lib-head__title {
    margin: var(--space-1) 0 var(--space-1);
    font-family: var(--font-heading);
    font-weight: 300;
    font-size: clamp(var(--text-3xl), 5vw, var(--text-5xl));
    color: var(--color-text);
  }
  .lib-head__sub {
    margin: 0;
    color: var(--color-text-tertiary);
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-5) 0 var(--space-8);
  }
  .search {
    position: relative;
    flex: 1 1 18rem;
    max-width: 25rem;
    display: block;
  }
  .search__icon {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
  }
  .search input {
    width: 100%;
    background: color-mix(in oklab, var(--lib-ink-2) 60%, transparent);
    border: var(--border-width) solid var(--lib-hair);
    border-radius: var(--radius-full, 999px);
    color: var(--color-text);
    font: inherit;
    padding: var(--space-2-5, 0.6rem) var(--space-4) var(--space-2-5, 0.6rem)
      var(--space-8);
  }
  .search input::placeholder {
    color: var(--color-text-tertiary);
  }
  .search input:focus {
    outline: none;
    border-color: var(--lib-hair-strong);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 2px;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex-shrink: 0;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full, 999px);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) solid var(--lib-hair);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }
  .chip:hover {
    color: var(--color-text);
    border-color: var(--lib-hair-strong);
  }
  .chip--on {
    color: var(--lib-ink);
    background: var(--lib-accent);
    border-color: var(--lib-accent);
    font-weight: var(--font-semibold);
  }
  .chips__sep {
    flex-shrink: 0;
    width: 1px;
    align-self: stretch;
    margin: var(--space-1) var(--space-1);
    background: var(--lib-hair);
  }

  /* ── Sections ── */
  .sec {
    margin-top: var(--space-10);
  }
  .sec__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }
  .sec__head h2 {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: 400;
    font-size: var(--text-2xl);
    color: var(--color-text);
  }
  .sec__ct {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  /* ── Motif thumbnail ── */
  .thumb {
    position: relative;
    flex-shrink: 0;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .thumb__art {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      120% 120% at 30% 15%,
      color-mix(in oklab, var(--tone) 60%, var(--lib-ink-2)),
      var(--lib-ink)
    );
  }
  .thumb__glyph {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--lib-bone);
    background: color-mix(in oklab, var(--lib-ink) 58%, transparent);
    backdrop-filter: blur(4px);
  }
  .tone-0 {
    --tone: var(--tone-0);
  }
  .tone-1 {
    --tone: var(--tone-1);
  }
  .tone-2 {
    --tone: var(--tone-2);
  }
  .tone-3 {
    --tone: var(--tone-3);
  }

  /*
    Both shelves hold `JourneyEntryCard`s, so the per-shelf CARD styling that
    used to live here is gone (Codex-tnwnu): `.contcard*` + `.track` (the resume
    strip) and `.jc*` (the portals shelf, including its title-hash tone
    gradient). What remains is the SCROLLER — a rail owns its own overflow and
    snap behaviour; a card never does.

    These styles are only "Jump back in" now. The portals shelf moved to the
    shared `Carousel` component, which owns its own track, arrows and scrollbar
    — this hand-rolled scroller stays for the resume rail alone. Worth
    collapsing the two onto `Carousel` eventually; the resume rail mixes portals
    with standalone practices and sizes its cards differently, so that is a
    separate change rather than a drive-by.
  */
  .cont {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    padding: var(--space-1) 2px var(--space-4);
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .cont::-webkit-scrollbar {
    display: none;
  }
  /*
    26rem, up from 22rem: a resume card cannot do its job with the text
    unreadable.

    A row card spends its width on TWO columns, so the text gets whatever the
    cover does not. At 22rem the split was 144px cover / 160px text — and a 160px
    column wrapped the kicker to three lines, clamped the title to two, and
    ellipsised the next-practice name. Two changes share the repair: the cover
    came down to 7.5rem (`JourneyEntryCard`, row silhouette) and the track went
    up to 26rem. Together the text column goes 160px → ~248px, which holds a
    two-line title and the full practice name.

    This costs NO height: a row's cover takes its height from the text beside it,
    not from its own width, so a wider track makes the card shorter if anything.
  */
  .cont > :global(*) {
    flex: 0 0 clamp(18rem, 86vw, 26rem);
    scroll-snap-align: start;
  }
  /*
    The portals carousel owns its own track/arrow/scrollbar styling; the page
    only supplies the space beneath it before "Everything you own".
  */
  .sec :global(.carousel) {
    padding-block-end: var(--space-2);
  }

  /* ── Group-by segmented control ── */
  .groupby {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }
  .groupby__lbl {
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: var(--radius-full, 999px);
    background: color-mix(in oklab, var(--lib-ink-2) 65%, transparent);
    border: var(--border-width) solid var(--lib-hair);
  }
  .seg__btn {
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    border: none;
    background: transparent;
    border-radius: var(--radius-full, 999px);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .seg__btn--on {
    background: var(--lib-accent);
    color: var(--lib-ink);
    font-weight: var(--font-semibold);
  }

  /* ── Owned rows ── */
  .grp {
    margin-top: var(--space-5);
  }
  .grp:first-child {
    margin-top: 0;
  }
  .grp__h {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }
  .grp__n {
    opacity: 0.6;
  }
  /*
    ONE row per line. Multi-column was tried and reverted: two columns of
    title + chip forced the eye to scan in a Z rather than straight down a
    single list of names, and every column boundary is another place a long
    practice title or portal name can collide with a chip.

    The dead-gutter problem that motivated columns is solved in the ROW instead
    (see `.row__t` / `.row__opened`): the provenance chip now sits immediately
    after the title rather than being flung to the far right edge, so the width
    is spent on content adjacency instead of whitespace.
  */
  .rows {
    display: grid;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2-5, 0.65rem) var(--space-3);
    border-radius: var(--radius-md);
    border: var(--border-width) solid transparent;
    text-decoration: none;
    transition:
      background-color var(--duration-fast, 0.15s) ease,
      border-color var(--duration-fast, 0.15s) ease;
  }
  .row:hover {
    background: color-mix(in oklab, var(--lib-ink-2) 55%, transparent);
    border-color: color-mix(in oklab, var(--lib-accent) 24%, transparent);
  }
  /*
    Skeleton rows reuse `.row` for padding/gap so the placeholder and the real
    row occupy identical boxes and nothing shifts when data lands. They are
    `div`s, not `<a>`s — a placeholder must not be focusable or clickable.
  */
  .row--sk__t {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* Match the real motif's and chip's silhouettes. */
  .row--sk :global(.sk-thumb) {
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }
  .row--sk :global(.sk-chip) {
    border-radius: var(--radius-full, 999px);
    flex-shrink: 0;
  }
  /*
    `flex: 0 1 24rem` — a fixed BASIS that may shrink but never grows.

    Three behaviours fall out of that, and all three are wanted:
      - no grow, so the chip is not pushed to the far right edge (the dead
        gutter that made a full-width row look like a mistake);
      - a fixed basis, so every chip starts at the SAME x instead of trailing
        each title at a different offset — adjacency without raggedness;
      - shrink allowed (with `min-width: 0`), so a phone-width row compresses
        the title rather than overflowing the card.

    24rem clears the longest practice title in this catalogue
    ("Working with Copal & Sacred Smoke") on one line at `--text-base`.
  */
  .row__t {
    flex: 0 1 24rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .row__title {
    font-family: var(--font-heading);
    font-weight: 400;
    font-size: var(--text-base);
    line-height: var(--leading-tight);
    color: var(--color-text);
  }
  .row__meta {
    margin-top: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .row__opened {
    margin-left: auto;
    padding-left: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /*
    Below md, a title and a provenance chip cannot share a line. At 390px the
    row's content box is ~334px, and the chip alone may claim 14rem of it — the
    title was squeezed under its own longest word and the chip pushed past the
    viewport edge, clipped mid-word. So the chip takes its own line instead,
    indented to the title's left edge (past the motif) so the row still reads as
    one block rather than a stray pill under the artwork.
  */
  @media (--below-md) {
    .row {
      flex-wrap: wrap;
      row-gap: var(--space-1);
      /* Grid items default to `min-width: auto`, which lets a flex row's
         min-content width force the single-column track wider than the
         viewport. */
      min-width: 0;
    }
    .row__t {
      flex: 1 1 8rem;
    }
    .badge {
      margin-left: calc(var(--space-12) + var(--space-3));
    }
  }

  /* ── Badges ── */
  .badge {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.26rem var(--space-2-5, 0.6rem);
    border-radius: var(--radius-full, 999px);
    border: var(--border-width) solid transparent;
    white-space: nowrap;
    /* `center`, not `flex-start`: the chip is now a direct child of the
       centre-aligned `.row`, where top-aligning it against a two-line
       title/type block left it visibly floating above the text baseline. */
    align-self: center;
  }
  .badge--free {
    color: var(--color-text-secondary);
    border-color: color-mix(in oklab, var(--lib-bone) 20%, transparent);
  }
  .badge--purchased {
    color: var(--color-text);
    background: color-mix(in oklab, var(--lib-bone) 10%, transparent);
    border-color: color-mix(in oklab, var(--lib-bone) 24%, transparent);
  }
  .badge--member {
    color: var(--lib-accent);
    background: color-mix(in oklab, var(--lib-accent) 12%, transparent);
    border-color: color-mix(in oklab, var(--lib-accent) 30%, transparent);
  }
  /*
    Provenance chips carry a PROPER NOUN — the portal's title — where every
    other badge carries a short status word ("purchased", "free"). Two
    consequences, both handled here rather than by shortening the label:

    1. No uppercase/tracking. Capitalising a title costs ~15% width and reads
       as shouting a name; "part of Ancestral Threads" is also simply easier to
       read than "PART OF ANCESTRAL THREADS".
    2. A hard `max-width` + ellipsis. Portal titles are author-supplied and
       unbounded, so without a cap a long one crowds the practice name it is
       meant to annotate. The cap makes that impossible regardless of how a
       creator names a portal.
  */
  .badge--course {
    color: var(--lib-accent);
    background: color-mix(in oklab, var(--lib-accent) 12%, transparent);
    border-color: color-mix(in oklab, var(--lib-accent) 32%, transparent);
    text-transform: none;
    letter-spacing: normal;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  /* ── Seam + empty ── */
  .seam {
    margin-top: var(--space-6);
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .seam__g {
    color: var(--lib-accent);
  }
  .empty {
    padding: var(--space-6) 0;
    color: var(--color-text-tertiary);
  }

  /* ── First-run onboarding ── */
  .firstrun {
    max-width: 40rem;
  }
  .firstrun__kicker {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--lib-accent);
  }
  .firstrun__title {
    margin: var(--space-2) 0;
    font-family: var(--font-heading);
    font-weight: 300;
    font-size: clamp(var(--text-3xl), 5vw, var(--text-4xl));
    color: var(--color-text);
  }
  .firstrun__sub {
    margin: 0 0 var(--space-6);
    color: var(--color-text-tertiary);
    line-height: var(--leading-relaxed);
  }
  .firstrun__card {
    display: flex;
    gap: var(--space-4);
    align-items: flex-start;
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: var(--border-width) solid
      color-mix(in oklab, var(--lib-accent) 30%, transparent);
    background: color-mix(in oklab, var(--lib-accent) 7%, var(--lib-ink-2));
    text-decoration: none;
    transition:
      border-color var(--duration-fast, 0.18s) ease,
      transform var(--duration-fast, 0.15s) ease;
  }
  .firstrun__card:hover {
    transform: translateY(-2px);
    border-color: var(--lib-accent);
  }
  .firstrun__cover {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-lg);
    font-size: var(--text-2xl);
    color: var(--lib-bone);
    background: radial-gradient(
      130% 130% at 25% 0%,
      color-mix(in oklab, var(--tone-0) 55%, var(--lib-ink-2)),
      var(--lib-ink)
    );
  }
  .firstrun__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .firstrun__ck {
    font-size: var(--text-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--lib-accent);
  }
  .firstrun__ct {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    color: var(--color-text);
  }
  .firstrun__cd {
    margin: var(--space-1) 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }
  .firstrun__cta {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--lib-accent);
  }

  @media (max-width: 40rem) {
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }
    /* Reset the row-layout flex so neither control grows on the column axis. */
    .search {
      flex: none;
      max-width: none;
    }
    .chips {
      flex: none;
    }
    .groupby {
      width: 100%;
      margin: var(--space-1) 0 0;
    }
  }
</style>
