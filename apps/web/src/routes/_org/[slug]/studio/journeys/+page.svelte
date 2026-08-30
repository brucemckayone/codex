<!--
  @component Studio Journeys — home / index (Codex-2pryk.3.3 · WP-5)

  The creator's list of journeys + landing pages. Mirrors the studio `content/`
  list page: a client `query()` reactive off a status filter (URL-driven), no
  server load — the studio `+layout.server.ts` already gates creator/admin/owner,
  and the studio subtree is `ssr = false`.

  Wired to the REAL `listJourneys` remote (Codex-isr02): `.current` / `.loading`
  access is identical to the retired `journey-queries.mock`. Owner/admin only —
  the content-api route enforces `requireOrgManagement`.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { PageStatus } from '@codex/shared-types';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import ConfirmDialog from '$lib/components/ui/Feedback/ConfirmDialog.svelte';
  import { CompassIcon, PlusIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    deleteJourney,
    duplicateJourney,
    listJourneys,
    listJourneyRevenue,
    setJourneyFeatured,
    setJourneyStatus,
  } from '$lib/remote/journeys.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';

  const { data } = $props();

  type StatusFilter = 'all' | PageStatus;
  const FILTERS: readonly { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'published', label: 'Published' },
    { id: 'archived', label: 'Archived' },
  ];

  const urlStatus = $derived.by<StatusFilter>(() => {
    const raw = page.url.searchParams.get('status');
    if (raw === 'draft' || raw === 'published' || raw === 'archived') return raw;
    return 'all';
  });

  const journeysQuery = $derived(
    listJourneys({
      organizationId: data.org.id,
      ...(urlStatus !== 'all' && { status: urlStatus }),
    })
  );

  const items = $derived(journeysQuery.current ?? []);
  const loading = $derived(journeysQuery.loading);

  /**
   * WHY the list read failed, if it did.
   *
   * Without this the failure rendered as the EMPTY STATE: `.current` is
   * `undefined` after a rejection as well as in flight (Codex-xo3bl), so `items`
   * fell to `[]`, `loading` went false, and the page told a creator with a shelf
   * full of portals "No portals yet — Create a course landing page…" and invited
   * them to make another. An empty list and an unanswered question are different
   * facts, and only one of them has a Create button as its next step.
   *
   * `queryErrorMessage`, never `journeysQuery.error?.message` — an `HttpError`
   * keeps its text at `.body.message`, so the property read is `undefined` for
   * every failure and its branch never runs. Same accessor the feature toggle
   * beside it already uses.
   */
  const loadError = $derived(
    queryErrorMessage(journeysQuery.error, 'Could not load your portals.')
  );

  /*
    HOMEPAGE PROMOTION — `landing_pages.featured`.

    A featured portal takes a slide in "Editor's picks" on the org landing page,
    beside featured CONTENT. Content has had this affordance for a long time (a
    "Feature on homepage" switch in the studio content form); portals could not
    use it because nothing in the codebase wrote the column.

    The pending id is tracked per-ROW rather than as one page-wide boolean: the
    list can hold many portals and a single flag would disable every toggle while
    one was in flight, which reads as the page having frozen.
  */
  let featurePendingId = $state<string | null>(null);
  let featureError = $state<string | null>(null);

  async function toggleFeatured(pageId: string, next: boolean) {
    featurePendingId = pageId;
    featureError = null;
    try {
      await setJourneyFeatured({ pageId, featured: next });
      // Re-read rather than mutate locally: `featured` also drives the public
      // ordering, so the server's view is the one worth showing.
      await journeysQuery.refresh();
    } catch (err) {
      // Through `queryErrorMessage`, never `err.message` — SvelteKit rejects with
      // `HttpError`, which carries its text at `body.message` and has NO
      // top-level `message`. Reading it directly yields `undefined` forever and
      // the failure renders as an empty string (Codex-xo3bl).
      featureError = queryErrorMessage(
        err,
        'Could not change the homepage feature. Please try again.'
      );
    } finally {
      featurePendingId = null;
    }
  }

  /*
    LIFECYCLE — publish · unpublish · archive · restore, WITHOUT opening the
    builder (Codex-c3lky). The owner's complaint was exact: "portals home is
    basic as fuck, there is no way to unpublish from there". Until now the only
    way to take a live page down was to open the builder, change a <select> and
    press Save — a route change and three steps to undo one mistake.

    Tracked per-ROW, like `featurePendingId` above and for the same reason: a
    single page-wide flag would disable every row's controls while one write was
    in flight, which reads as the page having frozen. The target status is kept
    beside the id so the button that was pressed is the one that reports it.
  */
  let statusPending = $state<{ pageId: string; to: PageStatus } | null>(null);
  let statusError = $state<string | null>(null);

  function busyLabel(
    pageId: string,
    to: PageStatus,
    idle: string,
    busy: string
  ): string {
    return statusPending?.pageId === pageId && statusPending.to === to
      ? busy
      : idle;
  }

  async function applyStatus(pageId: string, next: PageStatus) {
    statusPending = { pageId, to: next };
    statusError = null;
    try {
      await setJourneyStatus({ pageId, status: next });
      // Re-read rather than patch the row in place: the status filter, the header
      // count and — for a course page — the subject course's own published state
      // all move with this write, so the server's view is the only honest one.
      await journeysQuery.refresh();
    } catch (err) {
      // Through `queryErrorMessage`, never `err.message` — SvelteKit rejects with
      // an `HttpError`, which carries its text at `body.message` and has NO
      // top-level `message`, so the direct read is `undefined` for every failure
      // and the alert renders as an empty box (Codex-xo3bl).
      statusError = queryErrorMessage(
        err,
        'Could not change this portal’s status. Please try again.'
      );
    } finally {
      statusPending = null;
    }
  }

  /*
    CONFIRM, but only where the PUBLIC is affected.

    Unpublish and Archive both take a live page offline and — through the course
    cascade in `saveJourneyPage` — remove it from the library of everyone already
    enrolled, because `courses.status` is the only gate on the enrolled shelves
    and the course dashboard. That is not what "unpublish" sounds like it does,
    so both ask first and the copy names the consequence and what survives it,
    in the register the builder's own panels set. Never "Are you sure?".

    Publish and Restore do NOT ask: they are the forward directions, neither one
    withdraws anything, and each is undone by the control beside it.
  */
  /**
   * Which act the dialog is standing in front of.
   *
   * `unpublish-first` is NOT a fourth mutation — it is the DELETE request landing
   * on a published portal, where the dialog explains the constraint and its
   * confirm performs the unpublish that lifts it. A blocked action that names the
   * next step and offers it is a better product than a destructive one with a
   * warning, and the step is real: Unpublish runs through the course cascade, so
   * afterwards the row is a draft and Delete is available.
   */
  type ConfirmAction = 'status' | 'duplicate' | 'delete' | 'unpublish-first';

  type ConfirmTarget = {
    pageId: string;
    title: string;
    slug: string;
    from: PageStatus;
    /** The destination status. Only read for `status` / `unpublish-first`. */
    to: PageStatus;
    /**
     * `'course'` for a portal that fronts a curriculum, null for a plain landing
     * page. Carried because the delete copy's REASONS differ: a course page's
     * course stays live everywhere else if the page is deleted from under it,
     * and a landing page has no course to say that about. Copy that asserts a
     * course a page does not have is the same defect as a missing warning.
     */
    subjectType: string | null;
    action: ConfirmAction;
  };
  let confirmTarget = $state<ConfirmTarget | null>(null);
  let confirmOpen = $state(false);

  /**
   * Typed to the four fields the gate actually reads, rather than to
   * `JourneyListItem` — which exists as TWO parallel definitions
   * (`@codex/shared-types` and `$lib/page-builder/journey-queries`, each
   * documented as mirroring the other). Naming either one couples this gate to a
   * type it does not need, and the next additive field on the other side breaks
   * the assignment for no reason.
   */
  function requestStatus(
    j: {
      id: string;
      title: string;
      slug: string;
      status: PageStatus;
      subjectType: string | null;
    },
    to: PageStatus
  ): void {
    if (to === 'published' || j.status === 'archived') {
      void applyStatus(j.id, to);
      return;
    }
    confirmTarget = {
      pageId: j.id,
      title: j.title,
      slug: j.slug,
      from: j.status,
      to,
      subjectType: j.subjectType,
      action: 'status',
    };
    confirmOpen = true;
  }

  /*
    DUPLICATE + DELETE — the two acts that change whether a portal EXISTS, as
    opposed to what state it is in (Codex-c3lky). Both go through the same
    per-ROW pending model and the same single `ConfirmDialog` the lifecycle
    actions use; neither adds a second confirm mechanism.

    ONE pending record for the pair rather than two booleans, matching
    `statusPending` above: the kind rides beside the id so the button that was
    pressed is the one that reports itself busy, and a write on one row never
    disables another row's controls.
  */
  let managePending = $state<{
    pageId: string;
    kind: 'duplicate' | 'delete';
  } | null>(null);
  let manageError = $state<string | null>(null);

  /**
   * DUPLICATE always asks first, even though it destroys nothing.
   *
   * Not for safety — for DISAMBIGUATION. "Duplicate portal" reads as "duplicate
   * the whole journey", and it is not: the copy fronts the SAME course, so the
   * curriculum, the stages and the enrolments are shared rather than cloned, and
   * the price is deliberately left unset. A creator who presses this expecting a
   * second course would otherwise find out by editing the copy's curriculum and
   * watching the original change with it.
   */
  function requestDuplicate(j: {
    id: string;
    title: string;
    slug: string;
    status: PageStatus;
    subjectType: string | null;
  }): void {
    confirmTarget = {
      pageId: j.id,
      title: j.title,
      slug: j.slug,
      from: j.status,
      to: j.status,
      subjectType: j.subjectType,
      action: 'duplicate',
    };
    confirmOpen = true;
  }

  /**
   * DELETE on a PUBLISHED portal is refused rather than warned about, and the
   * dialog says why and offers the unpublish that unblocks it.
   *
   * The control is still rendered on a published row on purpose: hiding it would
   * leave a creator hunting for a Delete that exists on other rows, and a
   * `disabled` button explains itself only to a pointer. The server refuses this
   * too (409 from `deleteJourneyPage`) — this branch is the honest UI of a real
   * constraint, not the constraint itself.
   */
  function requestDelete(j: {
    id: string;
    title: string;
    slug: string;
    status: PageStatus;
    subjectType: string | null;
  }): void {
    confirmTarget = {
      pageId: j.id,
      title: j.title,
      slug: j.slug,
      from: j.status,
      to: 'draft',
      subjectType: j.subjectType,
      action: j.status === 'published' ? 'unpublish-first' : 'delete',
    };
    confirmOpen = true;
  }

  async function applyDuplicate(pageId: string): Promise<void> {
    managePending = { pageId, kind: 'duplicate' };
    manageError = null;
    try {
      const copy = await duplicateJourney({ pageId });
      // Re-read rather than push a row locally: the server derived both the title
      // and a verified-free slug, and the list is ordered by `updated_at`, so the
      // copy's position is the server's to decide.
      await journeysQuery.refresh();
      // The toast names WHAT was copied, because the confirm text is already gone
      // by the time the creator sees the new row.
      toast.success(
        `“${copy.title}” created as a draft — the sales page only, sharing the original’s course.`
      );
    } catch (err) {
      // `queryErrorMessage`, never `err.message` — a SvelteKit `HttpError` keeps
      // its text at `body.message` and has NO top-level `message`, so the direct
      // read is `undefined` for every failure (Codex-xo3bl).
      manageError = queryErrorMessage(
        err,
        'Could not duplicate this portal. Please try again.'
      );
    } finally {
      managePending = null;
    }
  }

  async function applyDelete(pageId: string): Promise<void> {
    managePending = { pageId, kind: 'delete' };
    manageError = null;
    try {
      await deleteJourney({ pageId });
      await journeysQuery.refresh();
    } catch (err) {
      // The 409 ("Unpublish this portal before deleting it …") arrives here if a
      // publish landed between the render and the click, so this alert carries a
      // real instruction rather than an apology — read through
      // `queryErrorMessage` for the same reason as above.
      manageError = queryErrorMessage(
        err,
        'Could not delete this portal. Please try again.'
      );
    } finally {
      managePending = null;
    }
  }

  const confirmCopy = $derived.by(() => {
    const t = confirmTarget;
    if (!t) return null;
    /*
      The three NON-STATUS branches come first, because `delete` and
      `unpublish-first` both carry `to: 'draft'` and would otherwise be answered
      by the unpublish copy below.

      `variant` is derived rather than fixed on the dialog: duplicate CREATES
      something and a red confirm button on it would be a lie about the act.
    */
    /*
      A plain LANDING page has no course, so the copy branches rather than
      asserting one. Reading `subjectType === 'course'` (a string comparison, not
      a truthiness test) is the narrowing that works with strictNullChecks off,
      and it is the SAME guard the row's Curriculum/Insights links use.
    */
    const isCourse = t.subjectType === 'course';
    if (t.action === 'duplicate') {
      return {
        title: `Duplicate “${t.title}”?`,
        description: isCourse
          ? `This copies the SALES PAGE — its sections, its look, its brand overrides and its SEO — as a new draft called “${t.title} (copy)”. It does NOT copy the course: both pages will front the same curriculum, the same stages and the same enrolments, so a stage you add later shows on both. The price is not copied either — the copy starts with nothing on sale, so you set it deliberately before you publish it.`
          : `This copies the page — its sections, its look, its brand overrides and its SEO — as a new draft called “${t.title} (copy)”. Nothing is copied that costs money: the copy starts with nothing on sale, so you set that deliberately before you publish it.`,
        confirmText: isCourse ? 'Duplicate the sales page' : 'Duplicate the page',
        cancelText: 'Cancel',
        variant: 'primary' as const,
      };
    }
    if (t.action === 'unpublish-first') {
      return {
        title: `Unpublish “${t.title}” before deleting it`,
        description: isCourse
          ? `A live portal cannot be deleted. Its course is published too, and only unpublishing the page takes the course down with it — delete the page while it is live and the course stays in Explore and in enrolled libraries with no sales page behind it. Unpublishing now removes /journeys/${t.slug} and takes it out of everyone’s library until you publish again; purchases and progress are kept. Delete becomes available straight after.`
          : `A live page cannot be deleted — a delete must never be the thing that takes something offline. Unpublishing now stops /journeys/${t.slug} resolving and returns the page to Draft; nothing is deleted. Delete becomes available straight after.`,
        confirmText: 'Unpublish',
        cancelText: 'Keep it published',
        variant: 'destructive' as const,
      };
    }
    if (t.action === 'delete') {
      return {
        title: `Delete “${t.title}”?`,
        description: isCourse
          ? `This removes the sales page — its sections, its look and its SEO — and takes the portal off this list. It is offline already, so nobody loses access today: anyone who was enrolled lost it when the portal came down, and their purchase and their progress are kept, along with the course and its whole curriculum. There is no Restore for a delete, so archive it instead if you might want the page back.`
          : `This removes the page — its sections, its look and its SEO — and takes it off this list. It is offline already, so no visitor loses anything today. There is no Restore for a delete, so archive it instead if you might want the page back.`,
        confirmText: isCourse ? 'Delete the sales page' : 'Delete the page',
        cancelText: 'Keep it',
        variant: 'destructive' as const,
      };
    }
    if (t.to === 'draft') {
      return {
        title: `Unpublish “${t.title}”?`,
        description: `The sales page stops resolving at /journeys/${t.slug}, and the portal leaves the homepage rails and Explore. Anyone already enrolled loses it from their library until you publish again — their purchase and their progress are kept, and nothing is deleted.`,
        confirmText: 'Unpublish',
        cancelText: 'Keep it published',
        variant: 'destructive' as const,
      };
    }
    if (t.from === 'published') {
      return {
        title: `Archive “${t.title}”?`,
        description: `Archiving takes the portal offline exactly as unpublishing does — /journeys/${t.slug} stops resolving, and anyone already enrolled loses it from their library — and shelves it out of the Draft and Published views. Purchases and progress are kept; Restore brings it back as a draft.`,
        confirmText: 'Archive',
        cancelText: 'Keep it published',
        variant: 'destructive' as const,
      };
    }
    return {
      title: `Archive “${t.title}”?`,
      description: `This portal is a draft, so nothing changes for visitors. It moves out of the Draft view into Archived, where Restore brings it back as a draft. Nothing is deleted.`,
      confirmText: 'Archive',
      cancelText: 'Leave it in Draft',
      variant: 'destructive' as const,
    };
  });

  // Authoritative per-journey revenue, keyed by landing-page id. A SEPARATE
  // query (independent of the status filter) so the row list paints immediately
  // and the badge streams in — the figure `listJourneys` omits by design.
  const revenueQuery = $derived(
    listJourneyRevenue({ organizationId: data.org.id })
  );
  const revenue = $derived(revenueQuery.current ?? {});

  const gbp = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  });
  function money(cents: number | null): string | null {
    return cents == null ? null : gbp.format(cents / 100);
  }

  /**
   * The cover tile's fallback character — the portal title's initial.
   *
   * The SAME derivation `JourneyEntryCard`'s flair dropcap uses on a row layout
   * ("the title is per-item in both, so it leads on rows"), so a cover-less
   * portal wears the same mark in the studio as on the public shelf. Purely
   * decorative: the title is read out immediately beside it, which is why the
   * whole tile is `aria-hidden`.
   *
   * `?? ''` because this runs on a client-side query result and apps/web has
   * strictNullChecks off — an in-flight or malformed row must not typeset the
   * string "undefined". An empty result renders NO letter rather than a
   * substitute glyph: the plate is already a coherent tile on its own, and a
   * stand-in mark would be the only non-typographic ornament in the studio.
   */
  function coverInitial(title: string): string {
    return (title ?? '').trim().charAt(0).toUpperCase();
  }

  const relative = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  function when(iso: string): string {
    return relative.format(new Date(iso));
  }

  /**
   * The URL-driven FILTER, not a mutation. Named `setStatusFilter` rather than
   * the shorter `setStatus` it used to be, because the row lifecycle above now
   * also writes a status — and two functions called `setStatus`/`applyStatus` in
   * one 900-line component is a mis-click waiting to happen in a diff.
   */
  function setStatusFilter(next: StatusFilter): void {
    const params = new URLSearchParams(page.url.searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    const query = params.toString();
    goto(`/studio/journeys${query ? `?${query}` : ''}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }
</script>

<svelte:head>
  <title>Portals | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="journeys">
  <header class="journeys__bar">
    <div class="journeys__heading">
      <h1 class="journeys__title">Portals</h1>
      <!--
        A COUNT IS A CLAIM ABOUT THE DATA, so a failed read has none to make.
        `items` falls to `[]` on a rejection as well as before one (`.current` is
        `undefined` in both states — Codex-xo3bl), and `loading` goes false, so
        this announced "0 pages" through `aria-live` directly above the "We could
        not load your portals" alert. A screen reader heard both, in that order,
        and they contradict each other. Same defect the items/empty pair below
        already fixes — an error must never fall through to a statement about the
        data — one element higher up and one round later.
      -->
      <p class="journeys__count" aria-live="polite">
        {loading
          ? 'Loading…'
          : loadError
            ? ''
            : `${items.length} ${items.length === 1 ? 'page' : 'pages'}`}
      </p>
    </div>

    <div class="journeys__filter" role="group" aria-label="Filter by status">
      {#each FILTERS as f (f.id)}
        <button
          type="button"
          class="journeys__filter-btn"
          aria-pressed={urlStatus === f.id}
          onclick={() => setStatusFilter(f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>

    <a href="/studio/journeys/new" class="journeys__create">
      <PlusIcon size={16} />
      New portal
    </a>
  </header>

  <div class="journeys__body">
    <!-- `role="alert"` so the failure is announced rather than only painted —
         a control's own label snaps back on refresh, which is silent. -->
    {#if featureError}
      <p class="journeys__action-error" role="alert">{featureError}</p>
    {/if}
    {#if statusError}
      <p class="journeys__action-error" role="alert">{statusError}</p>
    {/if}
    {#if manageError}
      <p class="journeys__action-error" role="alert">{manageError}</p>
    {/if}
    {#if loading}
      <ul class="journeys__rows" role="list">
        {#each Array(3) as _, i (i)}
          <li class="journeys__skeleton" aria-hidden="true"></li>
        {/each}
      </ul>
    {:else if loadError}
      <!--
        The error arm sits ABOVE the items/empty pair on purpose: an error must
        never fall through to "No portals yet", which is a claim about the data.
        `role="alert"` so it is announced, and a Retry rather than only an
        apology — the commonest cause is transient.
      -->
      <div class="journeys__error" role="alert">
        <p class="journeys__error-title">We could not load your portals</p>
        <p class="journeys__error-body">{loadError}</p>
        <button
          type="button"
          class="journeys__error-btn"
          onclick={() => journeysQuery.refresh()}
        >
          Try again
        </button>
      </div>
    {:else if items.length > 0}
      <ol class="journeys__rows" role="list">
        {#each items as j (j.id)}
          {@const rev = money(revenue[j.id] ?? null)}
          <li class="journey-row">
            <!--
              THE COVER TILE — the prototype's 84px square
              (`docs/design/course-journeys/prototype/studio-journeys.html` `.jcov`,
              56px at its narrow breakpoint), sized here off `--space-20` /
              `--space-14` so it tracks an org's density scale instead of pinning
              two magic pixel counts.

              `coverImageUrl` is the SAME `md` variant the public portal card
              serves, so this doubles as a check on the image a visitor will see —
              a studio-only crop would preview something the product never renders.

              With NO cover it is not an empty box: the plate + the title's
              initial are the typographic fallback `JourneyEntryCard` already
              gives a cover-less portal, so the two surfaces agree about what
              "no image yet" looks like. The plate paints in BOTH states — it sits
              under the `<img>`, so a slow or broken CDN degrades to the tile
              rather than to a white gap.

              `aria-hidden`: the title is read out immediately beside it and the
              initial is decoration, exactly as the public card's flair layer is.
            -->
            <div class="journey-row__cover" aria-hidden="true">
              {#if j.coverImageUrl}
                <img
                  class="journey-row__cover-img"
                  src={j.coverImageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              {:else}
                <span class="journey-row__cover-initial">{coverInitial(j.title)}</span>
              {/if}
            </div>
            <div class="journey-row__main">
              <div class="journey-row__title-line">
                <a class="journey-row__title" href="/studio/journeys/{j.id}/page">
                  {j.title}
                </a>
                <span class="journey-row__status" data-status={j.status}>{j.status}</span>
              </div>
              {#if j.tagline}
                <p class="journey-row__tagline">{j.tagline}</p>
              {/if}
              <p class="journey-row__meta">
                {#if j.stageCount != null}
                  <span>{j.stageCount} stages</span>
                  <span aria-hidden="true">·</span>
                  <span>{j.practiceCount} practices</span>
                  <span aria-hidden="true">·</span>
                {/if}
                {#if j.enrolledCount != null}
                  <span>{j.enrolledCount} enrolled</span>
                  <span aria-hidden="true">·</span>
                {/if}
                {#if rev}
                  <span>{rev} · 30d</span>
                  <span aria-hidden="true">·</span>
                {/if}
                <span class="journey-row__updated">Updated {when(j.updatedAt)}</span>
              </p>
            </div>
            <div class="journey-row__actions">
              <!--
                LIFECYCLE, and CONTEXTUAL rather than always-on: a row offers only
                the transitions its CURRENT status has. A published page shows
                Unpublish, a draft shows Publish, and an archived page shows only
                Restore — Archive on an already-archived row is a no-op, and an
                archive with no way back is a trap.

                These are buttons, not links, because they mutate. Every one of
                them routes through `setJourneyStatus`, whose write goes through
                the SAME `saveJourneyPage` path the builder uses, so the subject
                course moves with the page (`cascadeCourseFromPage`). That
                cascade is the bead's own precondition — "do not add an unpublish
                button on top of a publish path that ... does not cascade" — and
                it is why there is no shortcut endpoint here.
              -->
              <div class="journey-row__lifecycle">
                {#if j.status === 'published'}
                  <!--
                    `?preview=1` is REQUIRED, not decoration. The public sell page
                    redirects an ENTITLED visitor to the course dashboard, and an
                    org owner is always entitled, so without the param a creator
                    checking their own page never sees the page (O11). The load
                    bypasses that redirect on the mere PRESENCE of the key.
                  -->
                  <a
                    class="journey-row__action"
                    href="/journeys/{j.slug}?preview=1"
                    target="_blank"
                    rel="noopener"
                    title="Open the live sales page in a new tab"
                  >
                    View live ↗
                  </a>
                  <button
                    type="button"
                    class="journey-row__action"
                    disabled={statusPending?.pageId === j.id}
                    title="Take the portal offline — anyone enrolled loses it until you publish again"
                    onclick={() => requestStatus(j, 'draft')}
                  >
                    {busyLabel(j.id, 'draft', 'Unpublish', 'Unpublishing…')}
                  </button>
                {:else if j.status === 'archived'}
                  <button
                    type="button"
                    class="journey-row__action"
                    disabled={statusPending?.pageId === j.id}
                    title="Bring this portal back as a draft — it stays offline until you publish it"
                    onclick={() => requestStatus(j, 'draft')}
                  >
                    {busyLabel(j.id, 'draft', 'Restore', 'Restoring…')}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="journey-row__action"
                    disabled={statusPending?.pageId === j.id}
                    title="Make this portal public at /journeys/{j.slug}"
                    onclick={() => requestStatus(j, 'published')}
                  >
                    {busyLabel(j.id, 'published', 'Publish', 'Publishing…')}
                  </button>
                {/if}
                {#if j.status !== 'archived'}
                  <button
                    type="button"
                    class="journey-row__action"
                    disabled={statusPending?.pageId === j.id}
                    title="Shelve this portal — Restore brings it back as a draft"
                    onclick={() => requestStatus(j, 'archived')}
                  >
                    {busyLabel(j.id, 'archived', 'Archive', 'Archiving…')}
                  </button>
                {/if}
              </div>
              <!--
                EXISTENCE, not state. Duplicate and Delete change WHETHER the
                portal is here; the group beside them changes what state it is in.
                A third group rather than one long strip so the two kinds of act
                are not adjacent by accident — pressing Delete when you meant
                Archive is the mis-click this separation is for.

                Both are buttons (they mutate), both gate on their OWN row, and
                both open the single shared `ConfirmDialog`. Delete is rendered on
                a PUBLISHED row too: its dialog explains why it is blocked and
                offers the unpublish that unblocks it, which a hidden control
                cannot do and a `disabled` one can only do to a pointer.
              -->
              <div class="journey-row__manage">
                <button
                  type="button"
                  class="journey-row__action"
                  disabled={managePending?.pageId === j.id}
                  title="Copy this sales page as a new draft — the curriculum and the price are not copied"
                  onclick={() => requestDuplicate(j)}
                >
                  {managePending?.pageId === j.id &&
                  managePending.kind === 'duplicate'
                    ? 'Duplicating…'
                    : 'Duplicate'}
                </button>
                <button
                  type="button"
                  class="journey-row__action journey-row__action--danger"
                  disabled={managePending?.pageId === j.id}
                  title={j.status === 'published'
                    ? 'Unpublish this portal first — a live sales page cannot be deleted'
                    : 'Remove this sales page — the course, its curriculum and every purchase are kept'}
                  onclick={() => requestDelete(j)}
                >
                  {managePending?.pageId === j.id &&
                  managePending.kind === 'delete'
                    ? 'Deleting…'
                    : 'Delete'}
                </button>
              </div>
              <div class="journey-row__nav">
                <!--
                  Homepage promotion. A toggle BUTTON with `aria-pressed` rather
                  than a link, because it mutates rather than navigates, and rather
                  than a `<Switch>` (which is what the content form uses) because
                  this sits in a compact row of text actions where a switch's
                  track would be the only control of its kind.

                  Shown for drafts too. `featured` is orthogonal to status — the
                  public read filters `status = PUBLISHED` on its own — so the flag
                  is harmless on a draft, just inert; the title says so instead of
                  the control disappearing and leaving the creator wondering where
                  it went.
                -->
                <button
                  type="button"
                  class="journey-row__action journey-row__action--feature"
                  aria-pressed={j.featured ? 'true' : 'false'}
                  disabled={featurePendingId === j.id}
                  title={j.status === 'published'
                    ? j.featured
                      ? 'Showing in Editor’s picks on the homepage'
                      : 'Give this portal a slide in Editor’s picks'
                    : 'Takes effect on the homepage once this portal is published'}
                  onclick={() => toggleFeatured(j.id, !j.featured)}
                >
                  {featurePendingId === j.id
                    ? 'Saving…'
                    : j.featured
                      ? 'Featured'
                      : 'Feature'}
                </button>
                <!--
                  Curriculum and Insights are both COURSE artifacts (each resolves
                  the page to its subject course server-side), so both sit behind
                  the same subject-type guard — a non-course journey has neither,
                  and an ungated link would 404.
                -->
                {#if j.subjectType === 'course'}
                  <a class="journey-row__action" href="/studio/journeys/{j.id}/curriculum">
                    Curriculum
                  </a>
                  <a class="journey-row__action" href="/studio/journeys/{j.id}/insights">
                    Insights
                  </a>
                {/if}
                <a class="journey-row__action journey-row__action--primary" href="/studio/journeys/{j.id}/page">
                  Edit page
                </a>
              </div>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <div class="journeys__empty">
        <EmptyState
          title="No portals yet"
          description="Create a course landing page and start shaping its curriculum."
          icon={CompassIcon}
        >
          {#snippet action()}
            <a href="/studio/journeys/new" class="journeys__empty-cta">New portal</a>
          {/snippet}
        </EmptyState>
      </div>
    {/if}
  </div>
</div>

<!--
  ONE dialog for every row, driven by `confirmTarget`, rendered unconditionally
  rather than inside an `{#if}`: `ConfirmDialog` sets `open = false` itself on
  confirm/cancel, and unmounting it in the same tick would tear the dialog out
  from under its own close. `title` is a required string prop, hence the `?? ''`
  while nothing is targeted (the dialog paints nothing at `open = false`).
-->
<ConfirmDialog
  bind:open={confirmOpen}
  title={confirmCopy?.title ?? ''}
  description={confirmCopy?.description ?? ''}
  confirmText={confirmCopy?.confirmText ?? 'Confirm'}
  cancelText={confirmCopy?.cancelText ?? 'Cancel'}
  variant={confirmCopy?.variant ?? 'destructive'}
  onConfirm={() => {
    const t = confirmTarget;
    if (!t) return;
    /*
      ONE dispatch, and `unpublish-first` deliberately performs the UNPUBLISH
      rather than the delete the creator pressed. That is not a swapped act: the
      dialog's title says "Unpublish … before deleting it" and its confirm button
      says "Unpublish", so the button does what it is labelled. The row then
      re-renders as a draft and Delete is available on the next press.
    */
    if (t.action === 'duplicate') void applyDuplicate(t.pageId);
    else if (t.action === 'delete') void applyDelete(t.pageId);
    else void applyStatus(t.pageId, t.to);
  }}
/>

<style>
  /*
    The FAILED-READ block. Shares the empty state's centred column so the two read
    as one family, and is token-only: this list sits inside the studio shell and
    inherits the org brand.
  */
  .journeys__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4);
    text-align: center;
  }

  .journeys__error-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .journeys__error-body {
    margin: 0;
    max-width: 46ch;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }

  .journeys__error-btn {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .journeys__error-btn:hover {
    background-color: var(--color-surface-secondary);
  }

  .journeys {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .journeys__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .journeys__heading {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin-right: auto;
  }

  .journeys__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .journeys__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .journeys__filter {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
  }

  .journeys__filter-btn {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .journeys__filter-btn:hover {
    color: var(--color-text);
  }

  .journeys__filter-btn[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .journeys__filter-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .journeys__create {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .journeys__create:hover {
    background-color: var(--color-interactive-hover);
  }

  .journeys__create:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .journeys__body {
    padding-top: var(--space-5);
  }

  .journeys__rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .journeys__skeleton {
    height: var(--space-20, 5rem);
    border-radius: var(--radius-lg);
    background-image: linear-gradient(
      100deg,
      var(--color-surface-secondary) 30%,
      var(--color-surface) 50%,
      var(--color-surface-secondary) 70%
    );
    background-size: 200% 100%;
    animation: journeys-shimmer var(--duration-slower) var(--ease-default) infinite;
  }

  @keyframes journeys-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .journeys__skeleton {
      animation: none;
    }
  }

  /*
    WRAPPING, and the flex-basis pair, both come from a MEASURED regression.

    The lifecycle group takes the actions cluster from ~350px to ~640px, and with
    `flex-wrap: nowrap` plus `flex-shrink: 0` on the actions the only thing left
    to give was the TEXT: at a 900px viewport the main column was crushed to
    165px and the row grew to 306px tall, a narrow ribbon of wrapped tagline
    beside a single line of buttons.

    So the row wraps and the main column carries a flex BASIS. Wrapping in flex
    is decided by base sizes, not by `min-width`, so 22rem + the cluster is what
    drops the cluster onto its own full-width line once the studio column can no
    longer seat both — which is also what the prototype does at its narrow
    breakpoint (`.jacts { grid-column: 1 / -1 }`). `min-width: 0` stays: it is
    what still lets the title truncate rather than force the row wider.

    The cluster's own `flex-shrink: 0` had to GO for the same reason, measured at
    420px: on its own line it is the only item, so wrapping cannot help it, and
    with shrink disabled it stayed 614px wide inside a 388px row — clipped
    buttons. Shrink only ever engages when a line cannot wrap its way out, which
    is exactly that case; at every wider width the row wraps first and the
    cluster keeps its natural width.

    THE BASIS MOVED 22rem -> 30rem, and it is the same measurement redone after
    the cover tile and the Duplicate/Delete group landed. Measured on
    of-blood-and-bones at a 1440 viewport, studio column 1328px:

      before this round   cluster 644px   ->  main 636px   (one line)
      cover + manage      cluster 811px   ->  main 371px   (one line, crushed)
      basis 30rem         cluster 811px   ->  main 1200px  (cluster wraps below)

    371px is the same failure the paragraph above describes, one notch less
    severe: the text column loses 42% of its width to chrome and a two-clause
    tagline wraps to two lines beside a single row of buttons. 30rem is the
    smallest basis whose sum (80 + 480 + 811 + 32 of gaps = 1403) exceeds 1328,
    so at 1440 and below the cluster takes its own full-width line — which is
    exactly what the prototype does (`.jacts { grid-column: 1 / -1 }`) — while an
    ultra-wide column (1920 => 1808px) still seats both and gives the text ~869px.
    Wrapping in flex is decided by BASE sizes, so this is the only lever that
    chooses between "crush the words" and "give the buttons their own line".
  */
  .journey-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .journey-row:hover {
    border-color: var(--color-border-strong, var(--color-interactive));
  }

  .journey-row__main {
    flex: 1 1 30rem;
    min-width: 0;
  }

  .journey-row__title-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .journey-row__title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
  }

  .journey-row__title:hover {
    color: var(--color-interactive);
  }

  .journey-row__status {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs, 0.6875rem);
    font-weight: var(--font-medium);
    text-transform: capitalize;
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .journey-row__status[data-status='published'] {
    background-color: var(--color-success-subtle, var(--color-surface-secondary));
    color: var(--color-success, var(--color-text));
  }

  .journey-row__tagline {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .journey-row__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /*
    TWO GROUPS, not one long strip. Lifecycle (what state the portal is in) and
    navigation (where to go to work on it) are different kinds of act, and a
    published course row now carries SEVEN controls (measured: 644px of them at a
    1440 viewport, against 350px before), so the wider COLUMN gap
    between the groups is the only separator. A border-left would break the
    moment the cluster wraps, which it does inside the studio's content column at
    tablet width.
  */
  .journey-row__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2) var(--space-4);
  }

  .journey-row__lifecycle,
  .journey-row__manage,
  .journey-row__nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .journey-row__action {
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .journey-row__action:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  /*
    Element-qualified so ONE rule covers every mutating control in the row — the
    feature toggle and the four lifecycle buttons — rather than each modifier
    re-declaring the button reset. `background-color: transparent` is load-bearing:
    without it a <button> paints the UA's `buttonface` and reads as a filled chip
    beside the anchors it is meant to match.

    Specificity check: `.journey-row__action--feature[aria-pressed='true']` (0,2,0)
    and `.journey-row__action--primary` (0,1,0 — and only ever on an <a>) both
    still win their own declarations over this (0,1,1).
  */
  button.journey-row__action {
    cursor: pointer;
    background-color: transparent;
    font-family: inherit;
  }

  button.journey-row__action:disabled {
    cursor: progress;
    opacity: 0.6;
  }

  /*
    The pressed state has to be legible without colour alone, because "Feature"
    and "Featured" differ by two characters. A filled brand chip carries it:
    `--color-text-on-brand` auto-derives its own contrast from the brand hue
    (org-brand.css), so it stays readable on any org's palette rather than
    assuming a light one.
  */
  .journey-row__action--feature[aria-pressed='true'] {
    border-color: transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  /* `--color-error-600` matches the studio's existing error-text convention
     (monetisation/pricing-faq, sales) rather than introducing a fifth
     treatment. Shared by the feature toggle and the lifecycle actions — one
     failure treatment for the row's two kinds of write. */
  .journeys__action-error {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-error-600);
  }

  .journey-row__action--primary {
    border-color: transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .journey-row__action--primary:hover {
    background-color: var(--color-interactive-hover);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .journey-row__action:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /*
    THE COVER TILE.

    A fixed square that never shrinks (`flex: 0 0 auto`): it is the row's visual
    index, and a thumbnail that squashes with the column is worse than none. The
    size comes from the spacing scale (`--space-20` = 80px, `--space-14` = 56px at
    density 1) rather than the prototype's literal 84/56, so an org's
    `--brand-density-scale` moves it with everything else on the row.

    THE PLATE IS THE SAME ONE THE PUBLIC CARD USES, deliberately reduced to two
    stops for an 80px tile. `JourneyEntryCard.jec__cover-brand` records why the
    lightness is PINNED (`oklch(from … 0.32 …)`) instead of derived from a theme
    surface: `--media-glyph` — the ink the initial is set in — is a near-white in
    BOTH themes, which only reads over a dark backdrop. A media plate is dark in
    light mode for the same reason a photograph is. Chroma scales DOWN as the
    plate deepens so the bottom lands as a brand shadow rather than a saturated
    block.

    It paints in BOTH states, not just the empty one: the `<img>` is absolutely
    positioned over it, so a slow, missing or 404'd CDN object degrades to the
    tile instead of to a white hole in the row.
  */
  .journey-row__cover {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    width: var(--space-20, 5rem);
    height: var(--space-20, 5rem);
    border-radius: var(--radius-md);
    background-image: radial-gradient(
        120% 120% at 30% 8%,
        oklch(from var(--color-brand-primary) 0.44 calc(c * 0.72) h) 0%,
        transparent 68%
      ),
      linear-gradient(
        158deg,
        oklch(from var(--color-brand-primary) 0.32 calc(c * 0.64) h) 0%,
        oklch(from var(--color-brand-primary) 0.17 calc(c * 0.4) h) 100%
      );
  }

  .journey-row__cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The dropcap idiom `JourneyEntryCard` gives a cover-less portal, at tile
     scale. `--font-semibold` and NOT `--font-bold`: under an org brand
     `--font-bold` resolves to `var(--heading-weight, 700)` and computes to 400
     for single-weight display faces, which would silently un-weight the letter. */
  .journey-row__cover-initial {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: 1;
    color: var(--media-glyph);
  }

  @media (max-width: 900px) {
    /* The prototype drops its square to 56px at its narrow breakpoint, and 900px
       is where this row's own cluster starts wrapping inside the studio column
       (see the wrapping note above). */
    .journey-row__cover {
      width: var(--space-14, 3.5rem);
      height: var(--space-14, 3.5rem);
    }

    .journey-row__cover-initial {
      font-size: var(--text-lg);
    }
  }

  /*
    DELETE reads as an ordinary text action until it is reached, then goes red.
    A resting red chip on every row would be seven alarms on a list of seven
    portals, and the act is guarded by a dialog rather than by colour.

    Source order is load-bearing: this and `.journey-row__action:hover` are BOTH
    (0,2,0), so it only wins by sitting after it. It deliberately leaves
    `background-color` alone, so the shared hover surface still applies.
  */
  .journey-row__action--danger:hover,
  .journey-row__action--danger:focus-visible {
    color: var(--color-error-600);
    border-color: var(--color-error-600);
  }

  .journeys__empty {
    padding: var(--space-8) var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) dashed var(--color-border);
  }

  .journeys__empty-cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
  }

  .journeys__empty-cta:hover {
    background-color: var(--color-interactive-hover);
  }
</style>
