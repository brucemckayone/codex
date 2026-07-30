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
  import JourneyEntryCard from '$lib/components/journeys/JourneyEntryCard.svelte';
  import {
    enrolledCourseRowEntry,
    enrolledCourseTileEntry,
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
  let isLoadingFromServer = $state(false);
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

  onMount(async () => {
    const hasData = (libraryCollection?.state.size ?? 0) > 0;
    if (!hasData) isLoadingFromServer = true;
    try {
      await loadLibraryFromServer();
    } catch {
      // Non-fatal — an empty grid degrades gracefully.
    } finally {
      isLoadingFromServer = false;
    }
  });

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

  // Access-source → badge. Owned content maps its `accessType`; journey cards
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
  const sourceGroup = (via: string | null | undefined) => {
    if (via?.startsWith('course:')) return 'Part of a journey';
    if (via === 'paid' || via === 'purchased') return 'Purchased';
    if (via === 'subscribers' || via === 'members' || via === 'membership') {
      return 'Included with membership';
    }
    return 'Free';
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

  const isFirstRun = $derived(
    !isLoadingFromServer &&
      enrolledCourses.length === 0 &&
      ownedItems.length === 0
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
      return groupByKey(list, (i) => sourceGroup(i.accessType), [
        'Part of a journey',
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

<main class="library" data-testid="member-library">
  {#if isFirstRun}
    <div class="firstrun">
      <p class="firstrun__kicker">Welcome to {orgName}</p>
      <h1 class="firstrun__title">Your library will grow here.</h1>
      <p class="firstrun__sub">
        As you gather practices and follow journeys, they'll live in this room —
        the ones you're on, and the ones you've kept. For now, there's one clear
        place to begin.
      </p>
      <a class="firstrun__card" href="/explore">
        <span class="firstrun__cover">❋</span>
        <span class="firstrun__body">
          <span class="firstrun__ck">Start here</span>
          <span class="firstrun__ct">Explore {orgName}</span>
          <span class="firstrun__cd">
            Browse the catalogue and find your first practice or journey.
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
        Everything you've gathered lives here — journeys you're on, and the
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
            onclick={() => selectFacet('journeys')}>Journeys</button
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
          <span class="sec__ct">across your journeys &amp; practices</span>
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
            <JourneyEntryCard
              {href}
              title={item.content?.title ?? ''}
              kicker={m.label}
              meta={`${fmtTime(pos)}${dur > 0 ? ` of ${fmtTime(dur)}` : ''}`}
              coverImageUrl={item.content?.thumbnailUrl ?? null}
              layout="row"
              cta="Resume"
              progress={{
                percent:
                  dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0,
                label: null,
              }}
            />
          {/each}
        </div>
      </section>
    {/if}

    <!-- Your journeys -->
    {#if showJourneys}
      <section class="sec">
        <div class="sec__head">
          <h2>Your journeys</h2>
          <span class="sec__ct">{journeysShown.length} in your library</span>
        </div>
        {#if journeysShown.length > 0}
          <div class="rail">
            {#each journeysShown as c (c.course.id)}
              {@const badge = badgeFor(c.enrollmentSource)}
              <JourneyEntryCard
                {...enrolledCourseTileEntry(c, journeyDashboardHref(c), {
                  accessLabel: badge?.label ?? null,
                })}
              />
            {/each}
          </div>
        {:else}
          <p class="empty">No journeys match — try another filter or search.</p>
        {/if}
      </section>
    {/if}

    <!-- Everything you own -->
    {#if showOwn}
      <section class="sec">
        <div class="sec__head">
          <h2>{ownTitle}</h2>
          <span class="sec__ct">{ownedShown.length} pieces</span>
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

        {#if ownedShown.length > 0}
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
                  {@const badge = badgeFor(item.accessType)}
                  {@const opened = relativeTime(
                    item.progress?.updatedAt ?? item.purchase?.purchasedAt
                  )}
                  <a class="row" href={buildContentUrl(page.url, item.content)}>
                    {@render motif(item.content?.title ?? '', m.glyph)}
                    <span class="row__t">
                      <span class="row__title">{item.content?.title}</span>
                      <span class="row__meta">{m.label}</span>
                    </span>
                    <span class="row__end">
                      {#if opened}
                        <span class="row__opened">{opened}</span>
                      {/if}
                      {#if badge}
                        <span class="badge badge--{badge.cls}"
                          >{badge.label}</span
                        >
                      {/if}
                    </span>
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
          Practices that belong to a journey open inside it, so you keep your
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
    on-brand rather than copying the prototype's literal colours. Reused
    primitives (ProgressRing) inherit these tokens and adapt to the dark room.
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
    /* Full-bleed browsing layout — fills the org-main width; horizontal scroll
       lives only in the inner rails. */
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
    Both rails now hold `JourneyEntryCard`s, so the per-rail CARD styling that
    used to live here is gone (Codex-tnwnu): `.contcard*` + `.track` (the resume
    strip) and `.jc*` (the journeys shelf, including its title-hash tone
    gradient). What remains is the SCROLLER — a rail owns its own overflow and
    snap behaviour; a card never does.

    Both scrollers set the card track width, since only the page knows how wide a
    card should be in ITS rail. The journeys shelf is narrower than it looks
    relative to the old 16.5rem: the shared card is a 3:4 portrait, so the track
    had to come down or the shelf would be ~26rem tall.
  */
  .cont,
  .rail {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    padding: var(--space-1) 2px var(--space-4);
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .cont::-webkit-scrollbar,
  .rail::-webkit-scrollbar {
    display: none;
  }
  .cont > :global(*) {
    flex: 0 0 clamp(17rem, 82vw, 22rem);
    scroll-snap-align: start;
  }
  .rail > :global(*) {
    flex: 0 0 13rem;
    scroll-snap-align: start;
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
  .row__t {
    flex: 1;
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
  .row__end {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }
  .row__opened {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    white-space: nowrap;
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
    align-self: flex-start;
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
  .badge--course {
    color: var(--lib-accent);
    background: color-mix(in oklab, var(--lib-accent) 12%, transparent);
    border-color: color-mix(in oklab, var(--lib-accent) 32%, transparent);
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
