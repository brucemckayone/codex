<!--
  @component StudioMonetisation

  The Subscriptions tab of the monetisation hub: the Stripe account payouts land
  in, and the tiers people can join. Client-side queries (SPA pattern) — the page
  renders instantly with skeletons and data streams in from remote functions.

  Sections, in the order a creator needs them:
  - Compact masthead (an <h2>; the hub layout owns the <h1>)
  - One money-readiness prompt, ABOVE the cards, so a blocked org is told even
    when its lists are full (see MoneySetupPrompt)
  - Stripe Connect status + onboarding
  - Enable/disable subscriptions toggle
  - Subscriber summary, linked through to the actual people
  - Subscription tier CRUD, each row carrying its own subscriber count

  This page used to render four mutually exclusive stories at once: badge "Not
  connected", an Alert saying tiers need Connect, two existing tiers, and stats
  reading 2 subscribers / £9.98 MRR — all flat, none ranked. The readiness
  prompt now states the precedence explicitly.
-->
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import LoadFailedAlert from '$lib/components/studio/LoadFailedAlert.svelte';
  import MoneySetupPrompt from '$lib/components/studio/MoneySetupPrompt.svelte';
  import MoneyStatBand from '$lib/components/studio/MoneyStatBand.svelte';
  import type { MoneyStat } from '$lib/components/studio/money-stat';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Alert, Badge, EmptyState, PageHeader } from '$lib/components/ui';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import {
    TrashIcon,
    EditIcon,
    PlusIcon,
    CheckCircleIcon,
    ChevronRightIcon,
    UsersIcon,
  } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import PlanPicker from '$lib/components/studio/plan-picker/PlanPicker.svelte';
  import PlanGuidanceNote from '$lib/components/studio/plan-picker/PlanGuidanceNote.svelte';
  import {
    countsAnd,
    countsDot,
    itemsLabel,
  } from '$lib/components/studio/plan-picker/plan-counts';
  import {
    isDearer,
    itemGaps,
    joinNames,
    tiersByPrice,
    toggleTierId,
  } from '$lib/components/studio/plan-picker/select-from-tier';
  import { onMount, tick } from 'svelte';
  import {
    listTiers,
    getMyConnectStatus,
    getSubscriptionStats,
    getTierAccessSummary,
    getTierDeleteImpact,
    createTier,
    updateTier,
    deleteTier,
    connectMeOnboard,
    getMyConnectDashboard,
    updateSubscriptionFeature,
    syncMyConnect,
  } from '$lib/remote/subscription.remote';
  import { getOrgSettings } from '$lib/remote/org.remote';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import { randomUuid } from '$lib/utils/random-uuid';
  import { humanizeRequirement } from '$lib/utils/connect-requirement-humanization';
  import {
    connectQueryState,
    isConnectReady,
    moneyReadiness,
  } from '$lib/utils/connect-readiness';
  import {
    isFirstLoad,
    queryErrorMessage,
    type QueryResult,
  } from '$lib/remote/query-result';
  import type {
    ConnectRequirements,
    SubscriptionStats,
    SubscriptionTier,
  } from '$lib/types';
  import { logger } from '$lib/observability';

  let { data } = $props();

  // Role guard. Wait for data.userRole to populate — ssr=false means
  // first render has data.userRole === undefined.
  $effect(() => {
    if (data.userRole !== undefined && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived(data.org?.id);

  // ─── Client-side queries (SPA pattern) ─────────────────────────────────
  // Page renders instantly with skeletons, data streams in.

  const tiersQuery = $derived(orgId ? listTiers(orgId) : null);
  // The owner's OWN payout account — the account this org's money is paid to.
  // Set-up, re-check and the Stripe dashboard all go through the self-scoped
  // /connect/me routes: nobody acts on another person's account (Codex-2hxff.1).
  const connectQuery = $derived(getMyConnectStatus());
  const settingsQuery = $derived(orgId ? getOrgSettings(orgId) : null);
  const statsQuery = $derived(orgId ? getSubscriptionStats(orgId) : null);

  // Derived data from queries (with safe defaults)
  const tiers = $derived(
    ((tiersQuery as QueryResult<SubscriptionTier[]> | null)?.current ?? [])
  );

  // A failed tiers or settings read is not "no tiers" / "subscriptions off"
  // (Codex-2hxff.74, the .45 pattern). The `?? []` above and the `?? false`
  // below only fill the gap while a read is loading or failed. A failed tiers
  // read used to render "No subscription tiers yet." with Create Tier enabled,
  // so an owner with three tiers could make a duplicate first one; a failed
  // settings read showed the toggle OFF, and switching it "on" wrote a
  // setting the owner never saw. Each now shows "We couldn't load your …"
  // with Retry in place of what it feeds, and hides the action.
  const tiersState = $derived(
    connectQueryState(tiersQuery as QueryResult<SubscriptionTier[]> | null)
  );
  const tiersFailed = $derived(tiersState.kind === 'failed');
  const settingsState = $derived(
    connectQueryState(settingsQuery as QueryResult<unknown> | null)
  );
  const settingsFailed = $derived(settingsState.kind === 'failed');
  // A failed stats read is an UNKNOWN subscriber count, not 0. Read as 0 it
  // turned off the "money arriving with nowhere to land" prompt, hid the
  // band and left every tier with no subscribers, all silently. The alert
  // stands in for the band and says the numbers are missing; the stranded-
  // money prompt can't be shown honestly without them, and the Connect card
  // still states the account's own status.
  const statsState = $derived(
    connectQueryState(statsQuery as QueryResult<SubscriptionStats> | null)
  );
  const statsFailed = $derived(statsState.kind === 'failed');

  // What each tier includes (Codex-2hxff.91). STREAMED secondary data: the
  // rows render without it, their counts and guidance notes fill in when it
  // lands, and a failed read simply hides them (the create dialog's copy
  // choice still works, without its numbers). Authoritative and uncached.
  type TierAccessSummary = NonNullable<
    Awaited<ReturnType<typeof getTierAccessSummary>>
  >;
  type TierDeleteImpact = NonNullable<
    Awaited<ReturnType<typeof getTierDeleteImpact>>
  >;
  const summaryQuery = $derived(orgId ? getTierAccessSummary(orgId) : null);
  const summaryState = $derived(
    connectQueryState(summaryQuery as QueryResult<TierAccessSummary> | null)
  );
  const summary = $derived(summaryState.kind === 'ok' ? summaryState.status : null);
  const summaryByTier = $derived(
    new Map((summary?.tiers ?? []).map((row) => [row.tierId, row]))
  );
  const tierById = $derived(new Map(tiers.map((t) => [t.id, t])));

  type ConnectStatusPayload = {
    isConnected: boolean; accountId: string | null;
    chargesEnabled: boolean; payoutsEnabled: boolean; status: string | null;
    requirements: ConnectRequirements | null;
    requirementsFetchFailed?: boolean;
  };

  // A read that FAILED is not "no account" (Codex-2hxff.45). The default below
  // only fills the gap while loading or failed, and every surface that would
  // read it as a verdict (the badge, the set-up button, the two needs-Connect
  // hints and the readiness prompt) checks `connectFailed` first.
  const connectState = $derived(
    connectQueryState(connectQuery as QueryResult<ConnectStatusPayload>)
  );
  const connectFailed = $derived(connectState.kind === 'failed');
  const connectStatus = $derived<ConnectStatusPayload>(
    connectState.kind === 'ok'
      ? connectState.status
      : {
          isConnected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, status: null, requirements: null,
          requirementsFetchFailed: false,
        }
  );

  // The real error goes to the logger (which redacts), never into the DOM.
  $effect(() => {
    if (connectFailed) {
      logRawError(
        'payout account status failed to load',
        queryErrorMessage((connectQuery as QueryResult<unknown>).error)
      );
    }
  });
  $effect(() => {
    if (tiersFailed) {
      logRawError(
        'tiers failed to load',
        queryErrorMessage((tiersQuery as QueryResult<unknown> | null)?.error)
      );
    }
  });
  $effect(() => {
    if (settingsFailed) {
      logRawError(
        'settings failed to load',
        queryErrorMessage((settingsQuery as QueryResult<unknown> | null)?.error)
      );
    }
  });
  $effect(() => {
    if (statsFailed) {
      logRawError(
        'subscription stats failed to load',
        queryErrorMessage((statsQuery as QueryResult<unknown> | null)?.error)
      );
    }
  });

  let connectRetrying = $state(false);
  /** Outcome of the last Retry, for the copy and for where focus goes. */
  let connectRetryOutcome = $state<'ok' | 'failed' | null>(null);
  let connectLoadErrorNode = $state<HTMLElement | null>(null);
  let connectRetryStatusNode = $state<HTMLElement | null>(null);

  /**
   * Retry the status read. No `loading` on the button: `Button` disables
   * itself while loading, which drops focus to <body>. Its label says
   * "Retrying…" instead, and a second click while one runs does nothing.
   *
   * The outcome is read from the query, not from whether `refresh()` threw:
   * a failure stays on the query's own `.error`, which keeps the card failed
   * and is logged above.
   *
   * Focus follows the OUTCOME, as in `handleRecheckStatus`. On success the
   * alert unmounts with the focused Retry inside it, so focus goes to the
   * status line that says the account loaded. A failed Retry changes the
   * alert to "We still couldn't…", which a second one leaves as it is, so
   * `role="alert"` alone would say nothing: focus goes back to the alert,
   * which reads it out again.
   */
  async function retryConnectStatus() {
    if (connectRetrying) return;
    connectRetrying = true;
    try {
      await connectQuery.refresh();
    } catch {
      // Kept on `connectQuery.error`; see above.
    }
    connectRetryOutcome = connectFailed ? 'failed' : 'ok';
    connectRetrying = false;
    await tick();
    (connectRetryOutcome === 'ok'
      ? connectRetryStatusNode
      : connectLoadErrorNode
    )?.focus();
  }

  /**
   * Connect readiness gate for tier creation. Mirrors the backend guard
   * TierService.requireActiveConnect (chargesEnabled && payoutsEnabled), so the
   * UI blocks tier creation proactively instead of letting the creator fill in
   * the dialog and hit an opaque "Stripe Connect account is not fully onboarded"
   * (HTTP 422) error only on submit. Tiers cannot be created — and are dormant —
   * until Connect is fully active.
   */
  const connectReady = $derived(isConnectReady(connectStatus));

  /**
   * Show the requirements warning when:
   *  - the account is restricted (Stripe is actively blocking payouts), OR
   *  - the account is in onboarding AND has at least one currently_due field
   *    (the operator stopped mid-onboarding and needs nudge), OR
   *  - charges or payouts are disabled with `currently_due` items present
   *
   * We deliberately DON'T render for `eventually_due`-only state on Phase 1
   * (those become `currently_due` later) — keeps the alert action-oriented.
   */
  const showRequirementsAlert = $derived(
    !!connectStatus.requirements
      && connectStatus.requirements.currentlyDue.length > 0
      && (connectStatus.status === 'restricted'
        || connectStatus.status === 'disabled'
        || connectStatus.status === 'onboarding'
        || !connectStatus.payoutsEnabled)
  );

  const deadlineLabel = $derived(
    connectStatus.requirements?.currentDeadline
      ? formatDate(new Date(connectStatus.requirements.currentDeadline * 1000))
      : null
  );
  const enableSubscriptionsFromServer = $derived(
    (settingsQuery as QueryResult<{ features?: { enableSubscriptions?: boolean } }> | null)
      ?.current?.features?.enableSubscriptions ?? false
  );
  // `SubscriptionStats` from `$lib/types` — the same contract the service
  // returns (`packages/subscription`, `tierBreakdown: TierBreakdown[]`). The
  // inline shape this replaces declared `tierBreakdown: unknown[]` and then
  // cast it straight back in `subscribersByTier`, duplicating the contract with
  // no compiler link to its producer.
  const stats = $derived(
    (statsQuery as QueryResult<SubscriptionStats> | null)?.current ?? {
      totalSubscribers: 0,
      activeSubscribers: 0,
      mrrCents: 0,
      tierBreakdown: [],
    }
  );

  // FIRST loads only, as on the subscribers page. A query's own `loading` is
  // also true during every refresh: a Connect Retry, the post-create tier
  // re-read and each `invalidateAll()` used to flip the Tiers card to
  // skeletons and show the toggle OFF for the round trip. Connect counts
  // through `connectState`, which stays `failed` while a Retry is in flight.
  const dataLoading = $derived(
    connectState.kind === 'loading'
    || isFirstLoad(tiersQuery as QueryResult<unknown> | null)
    || isFirstLoad(settingsQuery as QueryResult<unknown> | null)
  );

  /**
   * The one money-readiness verdict for this page. `showTierPrompt` stays off in
   * the prompt below because the Tiers card owns its own empty state — saying
   * "add a tier" twice on one screen is the duplication this pass removed.
   */
  const readiness = $derived(
    moneyReadiness(connectStatus, {
      // Only a list that LOADED empty means "no tiers": a failed read is not
      // a verdict, so it never nudges the owner to add a first tier.
      hasTiers: tiersState.kind !== 'ok' || tiers.length > 0,
      subscriberCount: stats.activeSubscribers,
    })
  );

  /**
   * On THIS page the Connect card already carries the badge, the requirements
   * list and the onboarding button, so the prompt only earns its place for the
   * two things that card cannot express:
   *
   *   - money is already arriving with nowhere to land (studio-alpha: two active
   *     subscriptions, zero Connect rows) — the card shows a neutral badge and
   *     says nothing about the stranded revenue;
   *   - we never reached Stripe, so the card's "all clear" is unverified.
   *
   * Every other blocking state is fully described 200px below. Rendering the
   * prompt for those too would restate it — the duplication this pass removes.
   *
   * Never on a failed read: `readiness` is then computed from the "no account"
   * default, so it would warn a set-up owner that money has nowhere to land.
   */
  const showReadinessPrompt = $derived(
    !connectFailed &&
      ((readiness.blocking && readiness.hasSubscribers) ||
        readiness.state === 'stripe_unknown')
  );

  /** Per-tier subscriber counts, so each row carries its own number instead of
      a second card restating the whole stats grid. */
  const subscribersByTier = $derived.by(() => {
    const map = new Map<string, { count: number; mrrCents: number }>();
    for (const row of stats.tierBreakdown) {
      map.set(row.tierId, {
        count: row.subscriberCount,
        mrrCents: row.mrrCents,
      });
    }
    return map;
  });

  const statBand = $derived<MoneyStat[]>([
    {
      label: m.monetisation_stats_total(),
      value: stats.totalSubscribers,
      href: '/studio/subscribers',
    },
    {
      label: m.monetisation_stats_active(),
      value: stats.activeSubscribers,
      href: '/studio/subscribers',
    },
    { label: m.monetisation_stats_mrr(), value: formatPrice(stats.mrrCents) },
  ]);

  /** Annual vs 12× monthly, as a whole-percent saving. Nothing said this before —
      a creator pricing a tier could not see whether the annual price was a deal. */
  function annualSavingPercent(tier: SubscriptionTier): number | null {
    const twelveMonths = tier.priceMonthly * 12;
    if (!twelveMonths || tier.priceAnnual >= twelveMonths) return null;
    return Math.round(((twelveMonths - tier.priceAnnual) / twelveMonths) * 100);
  }

  // ─── State ──────────────────────────────────────────────────────────────

  let tierDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let editingTier = $state<SubscriptionTier | null>(null);
  let deletingTier = $state<SubscriptionTier | null>(null);

  // Tier form state
  let tierName = $state('');
  let tierDescription = $state('');
  let tierPriceMonthly = $state(499);
  let tierPriceAnnual = $state(4990);
  let tierFormError = $state('');
  let tierFormLoading = $state(false);
  /**
   * "Include everything from…" (Codex-2hxff.91): the tier whose films and
   * courses the new tier starts with, or `null` for Nothing. It starts on the
   * dearest existing tier (owner decision U3), which is what a new top tier
   * got under the old ladder. Create only: copying happens at creation.
   */
  let tierCopyFrom = $state<string | null>(null);
  /**
   * One id per create attempt, minted when the dialog opens (Codex-2hxff.66).
   * The server keys the Stripe product and prices on it, so resubmitting the
   * SAME values (a retry after a dropped response, a double submit) gets back
   * the tier the first attempt made instead of making a second one. Plain
   * `let`, not `$state`: nothing renders it.
   */
  let tierSubmissionId = '';
  /** The values last sent under `tierSubmissionId`; null before the first send. */
  let tierSubmittedValues: string | null = null;
  type TierCreateValues = {
    name: string;
    description: string | undefined;
    priceMonthly: number;
    priceAnnual: number;
    /**
     * Part of the attempt: Stripe compares only its own parameters under a
     * key, so a reused `submissionId` with a different source would return
     * the first attempt's tier with the FIRST copy. A changed source is
     * therefore a new attempt with a new id, like a changed price.
     */
    copyAccessFromTierId: string | null;
  };

  /** The copy choices, dearest first: what the default and the cards follow. */
  const copySources = $derived([...tiersByPrice(tiers)].reverse());

  function defaultCopySource(): string | null {
    return copySources[0]?.id ?? null;
  }

  /** Films + courses a tier includes, once the summary has landed. */
  function itemCountOf(tierId: string): number | null {
    const row = summaryByTier.get(tierId);
    return row ? row.films + row.courses : null;
  }

  /**
   * The create dialog's preview note (mockup P2): a new tier that starts with
   * Nothing but costs more than tiers that include things lacks all of them.
   * The cheaper tiers with items, dearest first; `[]` hides the note (it also
   * hides with no counts, no name yet, or a copy source chosen).
   */
  const createGaps = $derived.by(() => {
    if (editingTier || tierCopyFrom !== null || !summary || !tierName.trim()) {
      return [];
    }
    const monthly = Number(tierPriceMonthly);
    return copySources
      .filter((t) => isDearer(t, { ...t, priceMonthly: monthly }))
      .map((t) => ({ tier: t, items: itemCountOf(t.id) ?? 0 }))
      .filter((gap) => gap.items > 0);
  });
  /**
   * A create whose outcome is unknown: it was sent and did not answer with
   * success. The server may still have made the tier (a lost response, a
   * timeout). It outlives the dialog closing, so a reopen resumes the SAME
   * attempt: the same values under the same `tierSubmissionId`, and an
   * unchanged Save gets back the first tier instead of making a second.
   * Cleared when a create succeeds.
   */
  let unsettledCreate: TierCreateValues | null = null;
  /**
   * When `tierSubmissionId` was first SENT. Stripe's 24h key window runs from
   * the key's first use, so this, not the mint (the dialog opening) and not
   * the latest send, bounds a resume: an owner who spends an hour on the copy
   * before the first Save still gets the resume.
   */
  let tierFirstSentAt = 0;
  /** The `tierSubmissionId` of a create still awaiting its answer, or null. */
  let createInFlightId: string | null = null;
  /**
   * How long a reopen may resume an unsettled attempt. Stripe keeps a key for
   * 24h and a repeat after that would make a SECOND tier, so stop well short.
   */
  const UNSETTLED_CREATE_TTL_MS = 60 * 60 * 1000;

  function mintTierSubmission() {
    // `randomUuid`, not `crypto.randomUUID`: the latter is undefined on
    // http://*.lvh.me (local dev and e2e), which is not a secure context.
    tierSubmissionId = randomUuid();
    tierFirstSentAt = 0;
    tierSubmittedValues = null;
  }

  /**
   * Whether a reopen should resume the unsettled attempt: not once an hour
   * has passed since its first send, and not once the tier list shows it,
   * because then the first attempt landed. An id re-minted after a refusal
   * has not been sent (`tierFirstSentAt` 0), so no key window runs yet and
   * the typed values are kept.
   */
  function resumable(values: TierCreateValues): boolean {
    if (tierFirstSentAt !== 0 && Date.now() - tierFirstSentAt > UNSETTLED_CREATE_TTL_MS) {
      return false;
    }
    return !tiers.some(
      (t) =>
        t.name === values.name &&
        (t.description ?? '') === (values.description ?? '') &&
        t.priceMonthly === values.priceMonthly &&
        t.priceAnnual === values.priceAnnual
    );
  }

  // Delete dialog state
  let deleteLoading = $state(false);
  let deleteError = $state('');
  /**
   * What happens to the films and courses ONLY in the tier being deleted
   * (Codex-2hxff.91). Nothing is preselected (owner decision U5): Delete stays
   * disabled until the creator moves them to one or more tiers or keeps them
   * subscribers-only (closed, never free).
   */
  let deleteChoice = $state<'keep' | 'move' | null>(null);
  let deleteMoveTo = $state<string[]>([]);

  /**
   * The dialog's preview, read when it opens. The delete recomputes "only
   * here" in its own transaction; this decides what the dialog offers, and
   * until it has loaded Delete stays disabled. A failed read never reads as
   * "nothing only here".
   */
  const impactQuery = $derived(
    orgId && deletingTier && deleteDialogOpen
      ? getTierDeleteImpact({ orgId, tierId: deletingTier.id })
      : null
  );
  const impactState = $derived(
    connectQueryState(impactQuery as QueryResult<TierDeleteImpact> | null)
  );
  const impact = $derived(impactState.kind === 'ok' ? impactState.status : null);
  const onlyHereFilms = $derived(impact?.onlyHere.films.total ?? 0);
  const onlyHereCourses = $derived(impact?.onlyHere.courses.total ?? 0);
  const onlyHereTotal = $derived(onlyHereFilms + onlyHereCourses);
  const alsoElsewhere = $derived(
    (impact?.alsoInOtherPlans.films ?? 0) + (impact?.alsoInOtherPlans.courses ?? 0)
  );
  /** The tiers the only-here items can move to: every other active tier. */
  const moveOptions = $derived(tiers.filter((t) => t.id !== deletingTier?.id));
  const otherTierNames = $derived(
    joinNames(
      tiersByPrice(moveOptions).map((t) => t.name),
      'or'
    )
  );
  /** The first few only-here items, films first, as the dialog lists them. */
  const DELETE_PREVIEW_LIMIT = 5;
  const onlyHereShown = $derived(
    impact
      ? [
          ...impact.onlyHere.films.items.map((item) => ({ kind: 'film' as const, ...item })),
          ...impact.onlyHere.courses.items.map((item) => ({ kind: 'course' as const, ...item })),
        ].slice(0, DELETE_PREVIEW_LIMIT)
      : []
  );
  /** "Pro won't include these 5, though Basic will." for the move target. */
  const moveGaps = $derived(
    deleteChoice === 'move' ? itemGaps(deleteMoveTo, moveOptions) : []
  );
  const deleteReady = $derived(
    impact !== null &&
      impact.liveSubscriberCount === 0 &&
      (onlyHereTotal === 0 ||
        deleteChoice === 'keep' ||
        (deleteChoice === 'move' && deleteMoveTo.length > 0))
  );

  function retryImpact() {
    // The failure stays on the query's `.error`, which keeps the alert up.
    void impactQuery?.refresh().catch(() => {});
  }

  // Connect state
  let connectLoading = $state(false);
  let connectError = $state('');
  let connectSyncing = $state(false);
  /** Set when Stripe bounced us back to `refreshUrl` — the operator abandoned
      onboarding, so the account exists but is incomplete. */
  let connectSetupAbandoned = $state(false);
  /** Set after a `?connect=success` sync lands a fully-active account. Drives
      the "payments are live — add your first tier" hand-off. */
  let connectJustWentLive = $state(false);
  let recheckingStatus = $state(false);
  /** Outcome of the last explicit Stripe re-check, for the live region. */
  let recheckOutcome = $state<'ok' | 'failed' | null>(null);
  let recheckStatusNode = $state<HTMLElement | null>(null);

  // Auto-sync Connect status when returning from Stripe onboarding.
  // Without a webhook tunnel, the account.updated event never arrives in local dev.
  //
  // Two important constraints on this handler:
  //   1. The studio sub-tree is `ssr=false`, so this `onMount` runs DURING
  //      first client paint over an empty <main> SSR'd by the org layout.
  //      `invalidateAll()` here would re-fire every parent server load
  //      (auth, org public-info, studio membership/draft-count, …) racing
  //      with hydration — the visible result is the fullpage ShaderHero
  //      canvas painting alone behind a stalled studio shell ("blank black
  //      page"). Refresh ONLY the Connect status query.
  //   2. Strip `?connect=success` after sync resolves so a refresh /
  //      back-button doesn't re-trigger the sync (and the same race) on
  //      every visit.
  //   3. `refreshUrl` points BACK here with `?connect=refresh`, which Stripe uses
  //      when its onboarding link expires or the operator abandons the flow.
  //      That branch was unhandled: the creator landed on a stale "Not connected"
  //      page with the param stuck in the URL and no way to resume. It gets an
  //      explicit prompt instead — and it must NOT sync, because nothing changed
  //      at Stripe.
  onMount(() => {
    const connectParam = page.url.searchParams.get('connect');
    if (!connectParam || !orgId) return;

    function stripParam() {
      const url = new URL(page.url);
      url.searchParams.delete('connect');
      window.history.replaceState({}, '', url.toString());
    }

    if (connectParam === 'refresh') {
      connectSetupAbandoned = true;
      stripParam();
      return;
    }

    if (connectParam !== 'success') return;

    connectSyncing = true;
    syncMyConnect()
      .then(() => getMyConnectStatus().refresh())
      .then(() => {
        // Read the freshly-synced status, not the pre-sync snapshot. Only a
        // tier list that loaded empty means "add your first tier".
        if (
          isConnectReady(connectStatus) &&
          tiersState.kind === 'ok' &&
          tiers.length === 0
        ) {
          connectJustWentLive = true;
        }
      })
      .catch(() => {})
      .finally(() => {
        connectSyncing = false;
        stripParam();
      });
  });

  /**
   * Every money path on this page funnels its real error here rather than into
   * the DOM. `ObservabilityClient` redacts (emails in production, secrets
   * always); the surface only ever renders a fixed i18n string. `warn` is for
   * an expected refusal the owner can act on, so it stays out of the error
   * stream.
   */
  function logRawError(
    what: string,
    error: unknown,
    level: 'error' | 'warn' = 'error'
  ) {
    logger[level](`studio/monetisation: ${what}`, {
      organizationId: orgId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Re-check status against Stripe. Only ever on an explicit click — this hits
   * the live Stripe API, so firing it on load would turn every page view into a
   * third-party round trip.
   *
   * The outcome goes to `recheckOutcome`, a PERSISTENT live region beside the
   * prompt, not to `connectError` several hundred pixels below inside the
   * Connect card. Two reasons this had to change:
   *
   *   - on success `readiness` recomputes, `showReadinessPrompt` goes false and
   *     the Alert unmounts, taking the focused button with it: focus fell to
   *     <body> and nothing anywhere stated the result, so an AT user heard no
   *     response at all to their own click;
   *   - on failure it set `monetisation_connect_dashboard_error` — "Could not
   *     open the Stripe dashboard" — which is not what a status re-check does.
   */
  async function handleRecheckStatus() {
    if (!orgId) return;
    recheckingStatus = true;
    recheckOutcome = null;
    try {
      await syncMyConnect();
      await getMyConnectStatus().refresh();
      recheckOutcome = 'ok';
    } catch (error) {
      recheckOutcome = 'failed';
      logRawError('connect status re-check failed', error);
    } finally {
      recheckingStatus = false;
      // Focus follows the OUTCOME, in both directions. On success the prompt
      // unmounts and would drop focus to <body>; on failure the Button's own
      // `loading` disabled it mid-flight, which ALSO drops focus to <body>
      // (measured). Either way the answer is in this region, so put the caret
      // on the answer.
      await tick();
      recheckStatusNode?.focus();
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  // `disabled` has an explicit case. Without one it fell through to the
  // neutral "Not connected" label — while `isConnected` stayed true, so the
  // button beside it read "Continue Setup". Badge and button contradicted each
  // other on the one surface that owns this state machine.
  function connectStatusLabel(status: string | null): string {
    switch (status) {
      case 'active': return m.monetisation_connect_active();
      case 'onboarding': return m.monetisation_connect_onboarding();
      case 'restricted': return m.monetisation_connect_restricted();
      case 'disabled': return m.monetisation_connect_disabled();
      default: return m.monetisation_connect_not_connected();
    }
  }

  function connectStatusVariant(status: string | null): 'success' | 'warning' | 'error' | 'neutral' {
    switch (status) {
      case 'active': return 'success';
      case 'onboarding': return 'warning';
      case 'restricted': return 'error';
      case 'disabled': return 'error';
      default: return 'neutral';
    }
  }

  // ─── Tier Dialog ────────────────────────────────────────────────────────

  function openCreateTier() {
    // Defense-in-depth: the button is disabled when !connectReady, and hidden
    // while the tiers failed to load, but guard the handler too so a stray
    // programmatic call can't open a dialog that would only fail on submit,
    // or make a tier over a list nobody has seen.
    if (!connectReady || tiersFailed) return;
    editingTier = null;
    tierFormError = '';
    if (unsettledCreate && !resumable(unsettledCreate)) unsettledCreate = null;
    if (unsettledCreate) {
      // Resume the unsettled attempt: its values and its id are kept, so an
      // unchanged Save repeats it and the server returns the first tier.
      tierName = unsettledCreate.name;
      tierDescription = unsettledCreate.description ?? '';
      tierPriceMonthly = unsettledCreate.priceMonthly;
      tierPriceAnnual = unsettledCreate.priceAnnual;
      tierCopyFrom = unsettledCreate.copyAccessFromTierId;
    } else {
      tierName = '';
      tierDescription = '';
      tierPriceMonthly = 499;
      tierPriceAnnual = 4990;
      tierCopyFrom = defaultCopySource();
      mintTierSubmission();
    }
    // Busy only while a send of THIS attempt is still out, i.e. a reopen that
    // resumed it. A send of any other attempt answers into a dialog that has
    // moved on (see `submitCreate`).
    tierFormLoading =
      createInFlightId !== null && createInFlightId === tierSubmissionId;
    tierDialogOpen = true;
  }

  function openEditTier(tier: SubscriptionTier) {
    editingTier = tier;
    tierName = tier.name;
    tierDescription = tier.description ?? '';
    tierPriceMonthly = tier.priceMonthly;
    tierPriceAnnual = tier.priceAnnual;
    tierFormError = '';
    // A create still in flight does not hold up this dialog's Save.
    tierFormLoading = false;
    tierDialogOpen = true;
  }

  function openDeleteTier(tier: SubscriptionTier) {
    deletingTier = tier;
    deleteError = '';
    deleteChoice = null;
    deleteMoveTo = [];
    deleteDialogOpen = true;
  }

  async function handleTierSubmit() {
    if (!editingTier) {
      await submitCreate();
      return;
    }
    tierFormLoading = true;
    tierFormError = '';
    try {
      await updateTier({
        orgId,
        tierId: editingTier.id,
        name: tierName,
        description: tierDescription || undefined,
        priceMonthly: tierPriceMonthly,
        priceAnnual: tierPriceAnnual,
      });
      tierDialogOpen = false;
      await invalidateAll();
    } catch (error) {
      // NEVER the raw message. Tier writes create Stripe products and prices,
      // so `error.message` can be a Stripe string carrying an `acct_…` id or an
      // email — and every one of these renders inside `<Alert variant="error">`,
      // which sets role="alert", so it would be spoken verbatim and swept into
      // any DOM-scraping error pipeline. Generic copy in the DOM, real error to
      // the logger (which redacts). The same holds for a create below.
      tierFormError = m.monetisation_tier_save_error();
      logRawError('tier save failed', error);
    } finally {
      tierFormLoading = false;
    }
  }

  /**
   * Send a create, and act on its answer.
   *
   * The answer can land after the owner closed the dialog and opened another:
   * closing while in flight is a designed path (a reopen resumes the attempt),
   * and Edit on another tier shares this dialog. So the dialog is touched only
   * while it still shows THIS attempt (open, creating, the same id); a late
   * answer must not close an Edit or put this create's error in it. Whatever
   * the dialog shows, the answer still settles the attempt: a success clears
   * `unsettledCreate`, a refusal re-mints a spent id, and both re-read the list.
   */
  async function submitCreate() {
    const values: TierCreateValues = {
      name: tierName,
      description: tierDescription || undefined,
      priceMonthly: tierPriceMonthly,
      priceAnnual: tierPriceAnnual,
      // As chosen. A source deleted meanwhile is refused by the server before
      // any Stripe call; it is never quietly swapped for Nothing.
      copyAccessFromTierId: tierCopyFrom,
    };
    // Stripe refuses a reused key with different parameters, so values
    // that changed since the last send are a new attempt with a new id.
    // Unchanged values keep the id: that is the retry the server dedupes.
    const sent = JSON.stringify(values);
    if (tierSubmittedValues !== null && tierSubmittedValues !== sent) {
      mintTierSubmission();
    }
    if (tierSubmittedValues === null) tierFirstSentAt = Date.now();
    tierSubmittedValues = sent;
    // Unsettled from the moment it is sent, so closing the dialog while
    // it is in flight still resumes this attempt.
    unsettledCreate = values;
    const attemptId = tierSubmissionId;
    createInFlightId = attemptId;
    tierFormLoading = true;
    tierFormError = '';

    let result: Awaited<ReturnType<typeof createTier>> | undefined;
    let thrown: unknown;
    try {
      result = await createTier({ orgId, submissionId: attemptId, ...values });
    } catch (error) {
      thrown = error;
    }
    if (createInFlightId === attemptId) createInFlightId = null;
    // Read once, before anything below re-mints the id or closes the dialog.
    const shown = tierDialogOpen && !editingTier && tierSubmissionId === attemptId;
    if (shown) tierFormLoading = false;

    if (!result) {
      // Thrown: the request may have reached the worker, so the outcome is
      // unknown. Never the raw message; see `handleTierSubmit`.
      failCreate(m.monetisation_tier_save_unknown(), thrown, shown);
    } else if (!('tier' in result)) {
      // `in`, not `result.success`: a boolean discriminant does not narrow
      // with strictNullChecks off.
      refuseCreate(result, attemptId, shown);
    } else {
      if (tierSubmissionId === attemptId) unsettledCreate = null;
      if (shown) tierDialogOpen = false;
      await invalidateAll();
    }
  }

  /**
   * A create the worker refused, by its `details.code` (Codex-2hxff.66):
   * - `STRIPE_UNAVAILABLE` (503): nothing was saved, but Stripe replays a
   *   failure stored under a key for 24h, so the same id could keep failing.
   *   Mint a new one.
   * - `SUBMISSION_ID_REUSED` (409): the id was already used with other values
   *   (only a retry from elsewhere can do that). Mint a new one.
   * - `SUBMISSION_IN_PROGRESS` (409): the first is still at Stripe. Keep the
   *   id; a retry in a moment returns its tier.
   * - Anything else keeps the id. A 500 repeat reuses the first attempt's
   *   Stripe objects, and our own 400/403/404/422 gates run before any Stripe
   *   call.
   *
   * A 408 timeout or any other 5xx is an UNKNOWN outcome: the worker may have
   * made the tier, so the copy says so and sends the owner to the list, which
   * is re-read behind it. "Could not save" is kept for a definite refusal. A
   * changed resubmit after "Could not save" mints a new id, which for a tier
   * that did land is a second tier.
   *
   * A definite 4xx refusal is logged at warn, as the worker logs it: it is
   * the expected answer to a double click or a slow Stripe. An unknown outcome
   * and Stripe failing stay at error.
   */
  function refuseCreate(
    failure: {
      status: number;
      code: string | undefined;
      detailsCode: string | undefined;
    },
    attemptId: string,
    shown: boolean
  ) {
    const code = failure.detailsCode;
    // Only while the refused id is still the dialog's: a reopen since may
    // have minted a new one, which this refusal says nothing about.
    if (
      (code === 'STRIPE_UNAVAILABLE' || code === 'SUBMISSION_ID_REUSED') &&
      tierSubmissionId === attemptId
    ) {
      mintTierSubmission();
    }
    const unknownOutcome =
      failure.status === 408 ||
      (failure.status >= 500 && code !== 'STRIPE_UNAVAILABLE');
    let copy = m.monetisation_tier_save_error();
    if (code === 'SUBMISSION_IN_PROGRESS') copy = m.monetisation_tier_save_in_progress();
    else if (unknownOutcome) copy = m.monetisation_tier_save_unknown();
    failCreate(
      copy,
      `${failure.status} ${code ?? failure.code ?? 'unknown'}`,
      shown,
      unknownOutcome || failure.status >= 500 ? 'error' : 'warn'
    );
  }

  /**
   * Every failed create, refused or thrown. It may still have made the tier,
   * so re-read the list: a tier the first attempt made then shows, and the
   * creator does not make a second one. A failed re-read is logged, since the
   * copy may have just sent the owner to that list. The copy goes into the
   * dialog only while it shows this attempt (`shown`, see `submitCreate`).
   */
  function failCreate(
    copy: string,
    reason: unknown,
    shown: boolean,
    level: 'error' | 'warn' = 'error'
  ) {
    void tiersQuery
      ?.refresh()
      .catch((error) => logRawError('tier list refresh after a failed create failed', error));
    if (shown) tierFormError = copy;
    logRawError('tier create failed', reason, level);
  }

  async function handleDeleteTier() {
    if (!deletingTier || !deleteReady) return;
    // The choice goes only when something is only in this tier, and only as
    // the creator made it. With nothing only-here a bare delete is sent; if
    // something became only-here meanwhile, the worker refuses it.
    const choice =
      onlyHereTotal === 0
        ? undefined
        : deleteChoice === 'keep'
          ? { onlyHere: 'keep' as const }
          : { onlyHere: 'move' as const, moveTo: [...deleteMoveTo] };
    deleteLoading = true;
    deleteError = '';
    try {
      const result = await deleteTier({ orgId, tierId: deletingTier.id, choice });
      if (result.success) {
        deleteDialogOpen = false;
        deletingTier = null;
        await invalidateAll();
        return;
      }
      if (!('detailsCode' in result)) return;
      if (result.detailsCode === 'TIER_HAS_ONLY_ITEMS') {
        // The preview went stale: re-read it and ask again.
        deleteError = m.monetisation_tier_delete_only_here_changed({
          name: deletingTier.name,
        });
        deleteChoice = null;
        deleteMoveTo = [];
        retryImpact();
      } else if (result.detailsCode === 'TIER_HAS_SUBSCRIBERS') {
        // Someone subscribed since the check: the re-read shows the refusal.
        retryImpact();
      } else {
        deleteError = m.monetisation_tier_delete_error();
      }
      logRawError(
        'tier delete refused',
        `${result.status} ${result.detailsCode ?? result.code ?? 'unknown'}`,
        result.status >= 500 ? 'error' : 'warn'
      );
    } catch (error) {
      deleteError = m.monetisation_tier_delete_error();
      logRawError('tier delete failed', error);
    } finally {
      deleteLoading = false;
    }
  }

  // ─── Feature Toggle ─────────────────────────────────────────────────────

  let featureToggleLoading = $state(false);
  let featureToggleError = $state('');

  async function handleFeatureToggle(newValue: boolean) {
    featureToggleLoading = true;
    featureToggleError = '';
    try {
      await updateSubscriptionFeature({ orgId, enabled: newValue });
      await invalidateAll();
    } catch (error) {
      featureToggleError = m.monetisation_feature_toggle_error();
      logRawError('subscription feature toggle failed', error);
    } finally {
      featureToggleLoading = false;
    }
  }


  // ─── Recommended Toggle ─────────────────────────────────────────────────

  async function handleToggleRecommended(tier: SubscriptionTier) {
    try {
      await updateTier({
        orgId,
        tierId: tier.id,
        isRecommended: !tier.isRecommended,
      });
      await invalidateAll();
      toast.success(
        tier.isRecommended
          ? m.monetisation_tier_recommended_removed({ name: tier.name })
          : m.monetisation_tier_recommended_set({ name: tier.name })
      );
    } catch {
      toast.error(m.monetisation_tier_update_error());
    }
  }

  // ─── Connect ────────────────────────────────────────────────────────────

  async function handleConnectOnboard() {
    connectLoading = true;
    connectError = '';
    try {
      const returnUrl = `${page.url.origin}/studio/monetisation?connect=success`;
      const refreshUrl = `${page.url.origin}/studio/monetisation?connect=refresh`;
      const result = await connectMeOnboard({ returnUrl, refreshUrl });
      window.location.href = result.onboardingUrl;
    } catch (error) {
      connectError = m.monetisation_connect_onboard_error();
      logRawError('connect onboarding link failed', error);
      connectLoading = false;
    }
  }

  async function handleConnectDashboard() {
    connectLoading = true;
    connectError = '';
    try {
      const result = await getMyConnectDashboard();
      window.location.href = result.url;
    } catch (error) {
      // The seed-account branch stays — it maps a KNOWN condition to fixed
      // copy, which is the correct shape. What went is the `: msg` fallback,
      // which put a raw Stripe Connect error (account ids, emails) straight
      // into the DOM.
      const raw = error instanceof Error ? error.message : '';
      connectError =
        raw.includes('test') || raw.includes('seed') || raw === 'API Error'
          ? m.monetisation_connect_dashboard_test_error()
          : m.monetisation_connect_dashboard_error();
      logRawError('connect dashboard link failed', error);
      connectLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.monetisation_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting... -->
{:else}
<div class="monetisation">
  <!-- Compact masthead: an <h2>. The hub layout owns the <h1> and the tab
       track, and per that layout's contract a leaf carries no kicker. -->
  <PageHeader
    variant="compact"
    title={m.monetisation_subscriptions_title()}
    description={m.monetisation_subscriptions_description()}
  />

  <!-- Returned from Stripe without finishing. `refreshUrl` has always pointed
       here, but only `success` was handled — this used to be a dead end. -->
  {#if connectSetupAbandoned}
    <Alert variant="info">
      <div class="return-alert">
        <div class="return-alert__text">
          <p class="return-alert__title">{m.money_setup_refresh_title()}</p>
          <p class="return-alert__description">{m.money_setup_refresh_description()}</p>
        </div>
        <Button variant="secondary" size="sm" onclick={handleConnectOnboard} loading={connectLoading}>
          {m.money_setup_refresh_cta()}
        </Button>
      </div>
    </Alert>
  {/if}

  <!-- Stripe just verified the account and there is nothing to sell yet. -->
  {#if connectJustWentLive}
    <Alert variant="success">
      <div class="return-alert">
        <div class="return-alert__text">
          <p class="return-alert__title">{m.money_setup_live_title()}</p>
          <p class="return-alert__description">{m.money_setup_live_description()}</p>
        </div>
        <Button variant="secondary" size="sm" onclick={openCreateTier}>
          {m.money_setup_no_tiers_cta()}
        </Button>
      </div>
    </Alert>
  {/if}

  <!-- Readiness prompt, but ONLY for what the Connect card below cannot say:
       that money is already coming in with nowhere to land, or that we never
       reached Stripe to check. Rendering it for plain "not connected" would
       restate the badge + button 200px below it, which is the duplication this
       pass exists to remove. -->
  {#if !dataLoading && showReadinessPrompt}
    <MoneySetupPrompt
      {readiness}
      subscriberCount={stats.activeSubscribers}
      onAction={readiness.state === 'stripe_unknown' ? handleRecheckStatus : handleConnectOnboard}
      actionLoading={readiness.state === 'stripe_unknown' ? recheckingStatus : connectLoading}
    />
  {/if}

  <!-- OUTSIDE the {#if} above, deliberately, and mounted from first paint. A
       successful re-check unmounts the prompt, so a region nested inside it
       could never announce the outcome of the click that dismissed it — and a
       region inserted at the same instant as its own text is not announced
       either. This one persists and its TEXT changes. While it has nothing to
       say it carries `.sr-only`, so it stays in the accessibility tree without
       contributing a `--space-6` flex gap to the page. `tabindex="-1"` so the
       handler can hand focus here instead of dropping it to <body>. -->
  <div
    bind:this={recheckStatusNode}
    class="recheck-status"
    class:sr-only={recheckOutcome === null}
    role="status"
    aria-live="polite"
    aria-busy={recheckingStatus}
    tabindex="-1"
  >
    {#if recheckOutcome === 'ok'}
      <Alert variant="success" role="presentation">
        {m.money_setup_stripe_unknown_ok()}
      </Alert>
    {:else if recheckOutcome === 'failed'}
      <!-- `role="presentation"` — the wrapper above owns the announcement, so
           Alert's own role="alert" would say it twice. -->
      <Alert variant="error" role="presentation">
        {m.money_setup_stripe_unknown_error()}
      </Alert>
    {/if}
  </div>

  <!-- Stripe Connect Card -->
  <Card.Root>
    <Card.Header>
      <div class="card-header-row">
        <Card.Title level={3}>{m.monetisation_connect_title()}</Card.Title>
        {#if connectFailed}
          <!-- No badge: we don't know the status, so we claim none. -->
        {:else if dataLoading}
          <Skeleton width="var(--space-20)" height="var(--space-6)" class="skeleton-circle" />
        {:else}
          <!-- `stripe_unknown` means the stored status is `active` but the live
               requirements fetch failed, so the badge used to assert a
               confident green "Active" directly under a prompt saying we could
               not reach Stripe. Same fact, two answers. The badge now states
               what we actually know. `data-connect-status` still carries the
               raw status for tests and debugging. -->
          {#if readiness.state === 'stripe_unknown'}
            <Badge
              variant="neutral"
              data-testid="connect-status-badge"
              data-connect-status={connectStatus.status ?? 'not_connected'}
            >
              {m.monetisation_connect_unverified()}
            </Badge>
          {:else}
            <Badge
              variant={connectStatusVariant(connectStatus.status)}
              data-testid="connect-status-badge"
              data-connect-status={connectStatus.status ?? 'not_connected'}
            >
              {connectStatusLabel(connectStatus.status)}
            </Badge>
          {/if}
        {/if}
      </div>
      <Card.Description>{m.monetisation_connect_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <!-- Where focus goes after a Retry that loaded the account (see
           `retryConnectStatus`): the alert holding the focused button has just
           unmounted. Persistent, so its text change is announced too. -->
      <p
        bind:this={connectRetryStatusNode}
        class="sr-only"
        role="status"
        aria-live="polite"
        tabindex="-1"
      >
        {connectRetryOutcome === 'ok' ? m.money_setup_load_retry_ok() : ''}
      </p>
      {#if connectFailed}
        <!-- Ahead of `dataLoading`, so the Retry button stays mounted (and
             focused) while its own retry is in flight. No set-up or continue
             button: we can't tell which one this owner needs, and "Connect
             Stripe Account" would restart onboarding for an account that may
             be fully set up (Codex-2hxff.45). The wrapper takes focus after a
             Retry that failed again, so the alert is read out again. -->
        <div bind:this={connectLoadErrorNode} class="load-error-focus" tabindex="-1">
          <Alert variant="error" data-testid="connect-load-error" aria-busy={connectRetrying}>
            <div class="return-alert">
              <p class="return-alert__description">
                {connectRetryOutcome === 'failed'
                  ? m.money_setup_load_failed_again()
                  : m.money_setup_load_failed()}
              </p>
              <Button variant="secondary" size="sm" onclick={retryConnectStatus}>
                {connectRetrying
                  ? m.money_setup_load_failed_retrying()
                  : m.money_setup_load_failed_retry()}
              </Button>
            </div>
          </Alert>
        </div>
      {:else if dataLoading}
        <Skeleton width="200px" height="var(--space-5)" />
      {:else}
        {#if connectStatus.isConnected}
          <div class="connect-status-row">
            {#if connectStatus.chargesEnabled}
              <span class="status-item status-enabled">
                <CheckCircleIcon size={14} />
                {m.monetisation_connect_charges_enabled()}
              </span>
            {/if}
            {#if connectStatus.payoutsEnabled}
              <span class="status-item status-enabled">
                <CheckCircleIcon size={14} />
                {m.monetisation_connect_payouts_enabled()}
              </span>
            {/if}
          </div>
        {/if}

        {#if connectError}
          <Alert variant="error" style="margin-top: var(--space-3)">{connectError}</Alert>
        {/if}

        {#if showRequirementsAlert && connectStatus.requirements}
          <Alert
            variant="warning"
            role="alert"
            aria-live="assertive"
            class="requirements-alert"
            style="margin-top: var(--space-3)"
          >
            <div class="requirements-content">
              <h3 class="requirements-title">{m.monetisation_connect_requirements_title()}</h3>
              <p class="requirements-description">
                {#if deadlineLabel}
                  {m.monetisation_connect_requirements_with_deadline({ deadline: deadlineLabel })}
                {:else}
                  {m.monetisation_connect_requirements_no_deadline()}
                {/if}
              </p>
              <ul class="requirements-list">
                {#each connectStatus.requirements.currentlyDue as field (field)}
                  <li>{humanizeRequirement(field)}</li>
                {/each}
              </ul>
              {#if connectStatus.requirements.errors.length > 0}
                <details class="requirements-errors">
                  <summary>{m.monetisation_connect_requirements_errors_summary()}</summary>
                  <ul>
                    {#each connectStatus.requirements.errors as error (error.requirement + error.code)}
                      <li>
                        <strong>{humanizeRequirement(error.requirement)}:</strong> {error.reason}
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </div>
          </Alert>
        {/if}

        <div class="connect-actions">
          {#if !connectStatus.isConnected}
            <Button onclick={handleConnectOnboard} loading={connectLoading} data-testid="connect-stripe-btn">
              {m.monetisation_connect_start()}
            </Button>
          {:else if connectStatus.chargesEnabled && connectStatus.payoutsEnabled}
            <Button onclick={handleConnectDashboard} loading={connectLoading} variant="secondary">
              {m.monetisation_connect_dashboard()}
            </Button>
          {:else}
            <Button onclick={handleConnectOnboard} loading={connectLoading} variant="secondary">
              {m.monetisation_connect_continue()}
            </Button>
          {/if}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Feature Toggle.
       The switch sits BESIDE its label, not at the far edge of the column: it
       used to be pushed 1404px away by `justify-content: space-between`, so at
       1920 the control had lost all association with the thing it controls. -->
  <Card.Root>
    <Card.Content>
      <!-- In place of the toggle when the settings read failed: an OFF switch
           there would be a guess, and switching it would write over a
           setting the owner never saw. -->
      <LoadFailedAlert
        query={settingsQuery}
        message={m.monetisation_settings_load_failed()}
        againMessage={m.monetisation_settings_load_failed_again()}
        loadedMessage={m.monetisation_settings_load_retry_ok()}
        data-testid="settings-load-error"
      />
      {#if !settingsFailed}
      <div class="feature-toggle-row">
        <Switch
          id="enable-subscriptions"
          checked={dataLoading ? false : enableSubscriptionsFromServer}
          disabled={dataLoading || featureToggleLoading || !connectStatus.isConnected || connectStatus.status !== 'active'}
          onclick={() => handleFeatureToggle(!enableSubscriptionsFromServer)}
          aria-labelledby="enable-subscriptions-label"
        />
        <div class="feature-toggle-text">
          <!-- `aria-labelledby`, not a `<label for>`: the Switch root is a Melt
               `<button role="switch">`, and pairing label-activation with Melt's
               own click handling is a needless interaction to reason about. -->
          <span class="feature-toggle-label" id="enable-subscriptions-label">
            {m.monetisation_feature_toggle()}
          </span>
          <span class="feature-toggle-description">{m.monetisation_feature_toggle_description()}</span>
        </div>
      </div>
      {/if}
      {#if featureToggleError}
        <Alert variant="error" style="margin-top: var(--space-3)">{featureToggleError}</Alert>
      {/if}
      {#if !dataLoading && !connectFailed && !settingsFailed && (!connectStatus.isConnected || connectStatus.status !== 'active')}
        <p class="feature-toggle-disabled-hint">{m.monetisation_feature_requires_connect()}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Subscriber summary. Two of the three tiles link through to the people
       behind the number — there was previously no path at all from the stats to
       /studio/subscribers. Treatment matches studio/customers' band rather than
       StatCard, which measures visibly flatter on a dark page. -->
  <LoadFailedAlert
    query={statsQuery}
    message={m.monetisation_stats_load_failed()}
    againMessage={m.monetisation_stats_load_failed_again()}
    loadedMessage={m.monetisation_stats_load_retry_ok()}
    data-testid="stats-load-error"
  />
  {#if statsState.kind === 'ok' && stats.totalSubscribers > 0}
    <MoneyStatBand stats={statBand} label={m.monetisation_stats_title()} />
  {/if}

  <!-- Subscription Tiers -->
  <Card.Root>
    <Card.Header>
      <div class="card-header-row">
        <div>
          <Card.Title level={3}>{m.monetisation_tiers_title()}</Card.Title>
          <Card.Description>{m.monetisation_tiers_description()}</Card.Description>
        </div>
        <!-- Hidden while the tiers failed to load: a "first" tier made over a
             list nobody has seen can be a duplicate. -->
        {#if !tiersFailed}
          <Button onclick={openCreateTier} size="sm" disabled={dataLoading || !connectReady}>
            <PlusIcon size={14} />
            {m.monetisation_tiers_create()}
          </Button>
        {/if}
      </div>
    </Card.Header>
    <Card.Content>
      {#if !dataLoading && !connectFailed && !connectReady}
        <Alert variant="info" style="margin-bottom: var(--space-4)">
          {m.monetisation_tiers_requires_connect()}
        </Alert>
      {/if}
      <LoadFailedAlert
        query={tiersQuery}
        message={m.monetisation_tiers_load_failed()}
        againMessage={m.monetisation_tiers_load_failed_again()}
        loadedMessage={m.monetisation_tiers_load_retry_ok()}
        data-testid="tiers-load-error"
      />
      <!-- `tiersFailed` before `dataLoading`, so the alert and its focused
           Retry stay mounted while a Connect read is still loading. -->
      {#if tiersFailed}
        <!-- The alert above stands in for the tier list. -->
      {:else if dataLoading}
        <!-- Shaped like the row it replaces — rank, name/description, the
             recommended control, two prices, two actions. It used to promise a
             three-part row and deliver a six-part one. -->
        <div class="tier-list">
          {#each Array(2) as _, i (i)}
            <div class="tier-item tier-item--skeleton">
              <Skeleton width="var(--space-8)" height="var(--space-8)" class="skeleton-circle" />
              <div class="tier-details">
                <Skeleton width="var(--space-24)" height="var(--text-sm)" />
                <Skeleton width="var(--space-32)" height="var(--text-xs)" />
              </div>
              <Skeleton width="var(--space-11)" height="var(--space-6)" />
              <div class="tier-prices">
                <Skeleton width="var(--space-16)" height="var(--text-sm)" />
                <Skeleton width="var(--space-16)" height="var(--text-sm)" />
              </div>
              <div class="tier-actions">
                <Skeleton width="var(--space-8)" height="var(--space-8)" />
                <Skeleton width="var(--space-8)" height="var(--space-8)" />
              </div>
            </div>
          {/each}
        </div>
      {:else if tiers.length === 0}
        <EmptyState
          size="lg"
          title={m.monetisation_tiers_empty()}
          description={m.monetisation_tiers_empty_description()}
        />
      {:else}
        <!-- Grid, not flex-with-`flex:1`. The name used to sit 1255px from the
             recommended switch and 1535px from its own actions, because
             `.tier-info { flex: 1 }` absorbed every pixel of an 1808px column.
             Now the meaning-bearing clusters pack together on the left and only
             the row ACTIONS take the conventional right edge. -->
        <div class="tier-list">
          {#each tiers as tier, i (tier.id)}
            {@const tierStats = subscribersByTier.get(tier.id)}
            {@const saving = annualSavingPercent(tier)}
            {@const access = summaryByTier.get(tier.id)}
            {@const rowGaps = (access?.missingFromCheaper ?? []).filter((gap) =>
              tierById.has(gap.cheaperTierId)
            )}
            <div class="tier-item">
              <div class="tier-rank">{i + 1}</div>
              <div class="tier-details">
                <span class="tier-name">{tier.name}</span>
                {#if tier.description}
                  <span class="tier-description">{tier.description}</span>
                {/if}
                {#if tierStats && tierStats.count > 0}
                  <!-- Per-tier count, folded in from the separate breakdown card
                       that restated the stats band verbatim. -->
                  <a class="tier-subscribers" href="/studio/subscribers?tierId={tier.id}">
                    {tierStats.count === 1
                      ? m.monetisation_tier_subscribers_one()
                      : m.monetisation_tier_subscribers({ count: String(tierStats.count) })}
                    <span class="tier-subscribers-mrr">
                      {formatPrice(tierStats.mrrCents)}/{m.monetisation_tier_monthly()}
                    </span>
                  </a>
                {/if}
                <!-- What the tier includes, the way into its checklist
                     (Codex-2hxff.91). Streamed: a skeleton while the summary
                     loads, nothing if it failed. -->
                {#if access}
                  <a
                    class="tier-subscribers tier-content-link"
                    href="/studio/monetisation/tiers/{tier.id}"
                    data-testid="tier-contents-link"
                  >
                    {countsDot(access.films, access.courses)}
                    <span class="sr-only">{m.monetisation_tier_contents_link_aria({ name: tier.name })}</span>
                    <ChevronRightIcon size={12} aria-hidden="true" />
                  </a>
                {:else if summaryState.kind === 'loading'}
                  <Skeleton width="var(--space-24)" height="var(--text-xs)" />
                {/if}
              </div>
              <!-- The switch had NO accessible name at all — no `aria-label`, no
                   `aria-labelledby`, no visible label — and duplicated a
                   `Recommended` Badge rendered ~1250px away for the same
                   boolean. One control now, named, beside the tier it marks. -->
              <div class="tier-recommended">
                <Switch
                  checked={tier.isRecommended}
                  onclick={() => handleToggleRecommended(tier)}
                  aria-label={m.monetisation_tier_recommended_toggle({ name: tier.name })}
                />
                <span class="tier-recommended-label" aria-hidden="true">
                  {m.monetisation_tier_recommended()}
                </span>
              </div>
              <div class="tier-prices">
                <span class="tier-price">
                  {formatPrice(tier.priceMonthly)}<span class="tier-interval">/{m.monetisation_tier_monthly()}</span>
                </span>
                <span class="tier-price tier-price-secondary">
                  {formatPrice(tier.priceAnnual)}<span class="tier-interval">/{m.monetisation_tier_annual()}</span>
                  {#if saving !== null}
                    <span class="tier-saving">{m.monetisation_tier_annual_saving({ percent: String(saving) })}</span>
                  {/if}
                </span>
              </div>
              <!-- Names the tier, like the Switch above. `monetisation_tiers_edit`
                   does not interpolate, so with three tiers the AT elements list
                   read "Edit Tier, Edit Tier, Edit Tier" and nothing said which
                   paid tier any button acted on. The short labels stay in use as
                   the dialog titles. -->
              <div class="tier-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => openEditTier(tier)}
                  aria-label={m.monetisation_tiers_edit_aria({ name: tier.name })}
                >
                  <EditIcon size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => openDeleteTier(tier)}
                  aria-label={m.monetisation_tiers_delete_aria({ name: tier.name })}
                >
                  <TrashIcon size={14} />
                </Button>
              </div>
              <!-- The guidance note (owner decision 2): this tier costs more
                   than one that has items it lacks. Info, never a block. -->
              {#if rowGaps.length > 0}
                <div class="tier-gaps">
                  {#each rowGaps as gap (gap.cheaperTierId)}
                    {@const cheaperName = tierById.get(gap.cheaperTierId)?.name ?? ''}
                    {@const count = gap.films + gap.courses}
                    <PlanGuidanceNote
                      size="compact"
                      data-testid="tier-row-gap"
                      actions={[
                        {
                          label: m.plan_gap_review(),
                          href: `/studio/monetisation/tiers/${tier.id}?filter=missing&cheaper=${gap.cheaperTierId}`,
                        },
                      ]}
                    >
                      <b>
                        {count === 1
                          ? m.plan_gap_tier_row_one({ dearer: tier.name, cheaper: cheaperName })
                          : m.plan_gap_tier_row_other({
                              dearer: tier.name,
                              count,
                              cheaper: cheaperName,
                            })}
                      </b>
                    </PlanGuidanceNote>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- The tier-breakdown card that used to sit here is gone. It carried
       `m.monetisation_stats_title()` as its Card.Title — the SAME message key
       already used as the stats band's accessible name — and then restated the
       band's numbers verbatim ("Standard · 2 subscribers · £9.98/mo" beside
       "Total Subscribers 2 / Active 2 / MRR £9.98"). The per-tier counts now
       live on the tier rows themselves, where the tier they describe is. -->
</div>

<!-- Create/Edit Tier Dialog -->
<Dialog.Root bind:open={tierDialogOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {editingTier ? m.monetisation_tiers_edit() : m.monetisation_tiers_create()}
      </Dialog.Title>
    </Dialog.Header>

    <form class="tier-form" onsubmit={(e) => { e.preventDefault(); handleTierSubmit(); }}>
      <Dialog.Body>
        <div class="form-field">
          <Label for="tier-name">{m.monetisation_tier_name()}</Label>
          <Input
            id="tier-name"
            bind:value={tierName}
            placeholder={m.monetisation_tier_name_placeholder()}
            required
            maxlength={100}
          />
        </div>

        <div class="form-field">
          <Label for="tier-description">{m.monetisation_tier_description()}</Label>
          <TextArea
            id="tier-description"
            bind:value={tierDescription}
            placeholder={m.monetisation_tier_description_placeholder()}
            rows={3}
            maxlength={500}
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <Label for="tier-price-monthly">{m.monetisation_tier_price_monthly()}</Label>
            <Input
              id="tier-price-monthly"
              type="number"
              bind:value={tierPriceMonthly}
              min={100}
              step={1}
              required
            />
            <span class="form-hint">{formatPrice(tierPriceMonthly)}</span>
          </div>
          <div class="form-field">
            <Label for="tier-price-annual">{m.monetisation_tier_price_annual()}</Label>
            <Input
              id="tier-price-annual"
              type="number"
              bind:value={tierPriceAnnual}
              min={100}
              step={1}
              required
            />
            <span class="form-hint">{formatPrice(tierPriceAnnual)}</span>
          </div>
        </div>

        <!-- "Include everything from…" (Codex-2hxff.91): copies a tier's films
             and courses in the same server command as the create. Create only,
             and only when there is a tier to copy. Dearest first; the dearest
             is the default (U3). -->
        {#if !editingTier && copySources.length > 0}
          <fieldset class="choice-group" data-testid="tier-copy-from">
            <legend class="choice-legend">{m.monetisation_tier_copy_label()}</legend>
            {#each copySources as source (source.id)}
              {@const row = summaryByTier.get(source.id)}
              <label class="choice-card" data-selected={tierCopyFrom === source.id || undefined}>
                <input
                  type="radio"
                  name="tier-copy-from"
                  class="sr-only"
                  value={source.id}
                  checked={tierCopyFrom === source.id}
                  onchange={() => (tierCopyFrom = source.id)}
                />
                <span class="choice-text">
                  <span class="choice-label">{source.name}</span>
                  <span class="choice-desc">
                    {row
                      ? m.monetisation_tier_copy_option_desc({
                          counts: countsAnd(row.films, row.courses),
                          price: formatPrice(source.priceMonthly),
                        })
                      : m.monetisation_tier_copy_option_price({
                          price: formatPrice(source.priceMonthly),
                        })}
                  </span>
                </span>
                <span class="choice-check" aria-hidden="true"></span>
              </label>
            {/each}
            <label class="choice-card" data-selected={tierCopyFrom === null || undefined}>
              <input
                type="radio"
                name="tier-copy-from"
                class="sr-only"
                value=""
                checked={tierCopyFrom === null}
                onchange={() => (tierCopyFrom = null)}
              />
              <span class="choice-text">
                <span class="choice-label">{m.monetisation_tier_copy_none()}</span>
                <span class="choice-desc">{m.monetisation_tier_copy_none_desc()}</span>
              </span>
              <span class="choice-check" aria-hidden="true"></span>
            </label>
            <span class="form-hint">{m.monetisation_tier_copy_hint()}</span>
          </fieldset>

          {#if createGaps.length > 0}
            {@const first = createGaps[0]}
            {@const name = tierName.trim()}
            <PlanGuidanceNote
              data-testid="tier-create-gap"
              actions={[
                {
                  label: m.plan_gap_create_action({ tierName: first.tier.name }),
                  onclick: () => (tierCopyFrom = first.tier.id),
                },
              ]}
            >
              {#if createGaps.length === 1}
                {m.plan_gap_create_one({ name, items: itemsLabel(first.items), cheaper: first.tier.name })}
              {:else if createGaps.length === 2}
                {m.plan_gap_create_two({
                  name,
                  items: itemsLabel(first.items),
                  cheaper: first.tier.name,
                  count2: createGaps[1].items,
                  cheaper2: createGaps[1].tier.name,
                })}
              {:else}
                {m.plan_gap_create_many({
                  name,
                  items: itemsLabel(first.items),
                  cheaper: first.tier.name,
                  others: joinNames(createGaps.slice(1).map((gap) => gap.tier.name)),
                })}
              {/if}
            </PlanGuidanceNote>
          {/if}
        {/if}

        {#if tierFormError}
          <Alert variant="error">{tierFormError}</Alert>
        {/if}
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="ghost" type="button" onclick={() => { tierDialogOpen = false; }}>
          {m.monetisation_cancel()}
        </Button>
        <Button type="submit" loading={tierFormLoading}>
          {m.monetisation_save()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete Tier Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{m.monetisation_tiers_delete()}</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      {#if impact && impact.liveSubscriberCount > 0 && deletingTier}
        <!-- Refused, said up front (mockup D6): the worker refuses a tier with
             any subscription that isn't cancelled, and this count comes from
             the same read, so the dialog and the refusal can't disagree. -->
        <Alert variant="warning" data-testid="tier-delete-refused">
          <span class="alert-icon-row">
            <UsersIcon size={16} aria-hidden="true" />
            <span class="alert-copy">
              <span>
                <b>{m.monetisation_tier_delete_refused_title({ name: deletingTier.name })}</b>
                {impact.liveSubscriberCount === 1
                  ? m.monetisation_tier_delete_refused_body_one({ name: deletingTier.name })
                  : m.monetisation_tier_delete_refused_body_other({
                      count: impact.liveSubscriberCount,
                      name: deletingTier.name,
                    })}
              </span>
              <a class="alert-link" href="/studio/subscribers?tierId={deletingTier.id}">
                {m.monetisation_tier_delete_refused_view({ name: deletingTier.name })}
              </a>
            </span>
          </span>
        </Alert>
      {:else}
        <!-- Names the tier. WCAG 3.3.4 wants something to REVIEW before a
             revenue-bearing object is destroyed, and neither the trigger, the
             title nor this sentence used to identify which tier was about to go. -->
        <p class="delete-confirm">
          {deletingTier
            ? m.monetisation_tiers_delete_confirm_named({ name: deletingTier.name })
            : m.monetisation_tiers_delete_confirm()}
        </p>

        {#if impactState.kind === 'failed' && deletingTier}
          <!-- Never read as "nothing only here" (mockup D7). -->
          <Alert variant="error" data-testid="tier-delete-impact-failed">
            <span class="alert-row">
              <span>{m.monetisation_tier_delete_impact_failed({ name: deletingTier.name })}</span>
              <Button variant="secondary" size="sm" type="button" onclick={retryImpact}>
                {m.monetisation_tier_delete_impact_retry()}
              </Button>
            </span>
          </Alert>
        {:else if !impact}
          <div class="impact-skeleton" aria-hidden="true">
            <Skeleton width="70%" height="var(--text-sm)" />
            <Skeleton width="100%" height="var(--space-16)" />
          </div>
        {:else if deletingTier && onlyHereTotal === 0}
          <p class="impact-lede" data-testid="tier-delete-nothing-only-here">
            {alsoElsewhere > 0 && otherTierNames
              ? m.monetisation_tier_delete_nothing_only_here({
                  name: deletingTier.name,
                  tiers: otherTierNames,
                })
              : m.monetisation_tier_delete_empty({ name: deletingTier.name })}
          </p>
        {:else if deletingTier}
          {@const counts = countsAnd(onlyHereFilms, onlyHereCourses, true)}
          {@const one = onlyHereTotal === 1}
          <p class="impact-lede" data-testid="tier-delete-only-here">
            <b>
              {one
                ? m.monetisation_tier_delete_only_here_one({ counts, name: deletingTier.name })
                : m.monetisation_tier_delete_only_here_other({ counts, name: deletingTier.name })}
            </b>
          </p>
          <ul class="impact-list">
            {#each onlyHereShown as item (item.kind + item.id)}
              <li>
                <span class="impact-kind">
                  {item.kind === 'film' ? m.plan_item_kind_film() : m.plan_item_kind_course()}
                </span>
                <span>{item.title}</span>
              </li>
            {/each}
            {#if onlyHereTotal > onlyHereShown.length}
              <li class="impact-more">
                {m.monetisation_tier_delete_only_here_more({
                  count: onlyHereTotal - onlyHereShown.length,
                })}
              </li>
            {/if}
          </ul>

          <fieldset class="choice-group" data-testid="tier-delete-choice">
            <legend class="choice-legend">
              {one
                ? m.monetisation_tier_delete_choice_label_one()
                : m.monetisation_tier_delete_choice_label_other()}
            </legend>
            {#if moveOptions.length > 0}
              <label class="choice-card" data-selected={deleteChoice === 'move' || undefined}>
                <input
                  type="radio"
                  name="tier-delete-choice"
                  class="sr-only"
                  value="move"
                  checked={deleteChoice === 'move'}
                  onchange={() => (deleteChoice = 'move')}
                />
                <span class="choice-text">
                  <span class="choice-label">
                    {one ? m.monetisation_tier_delete_move_one() : m.monetisation_tier_delete_move_other()}
                  </span>
                  <span class="choice-desc">
                    {one
                      ? m.monetisation_tier_delete_move_desc_one()
                      : m.monetisation_tier_delete_move_desc_other()}
                  </span>
                </span>
                <span class="choice-check" aria-hidden="true"></span>
              </label>
              {#if deleteChoice === 'move'}
                <div class="choice-detail">
                  <!-- The shared picker, without "and above": one or more tiers. -->
                  <PlanPicker
                    tiers={moveOptions}
                    selected={deleteMoveTo}
                    label={one ? m.monetisation_tier_delete_move_one() : m.monetisation_tier_delete_move_other()}
                    disabled={deleteLoading}
                    onToggle={(id) => (deleteMoveTo = toggleTierId(deleteMoveTo, id))}
                  />
                  {#if deleteMoveTo.length === 0}
                    <span class="form-hint">
                      {one
                        ? m.monetisation_tier_delete_move_pick_one()
                        : m.monetisation_tier_delete_move_pick_other()}
                    </span>
                  {/if}
                  {#each moveGaps as gap (gap.dearer.id)}
                    <PlanGuidanceNote
                      actions={[
                        {
                          label: m.plan_gap_tick({ tierName: gap.dearer.name }),
                          onclick: () => (deleteMoveTo = toggleTierId(deleteMoveTo, gap.dearer.id)),
                        },
                      ]}
                    >
                      <b>
                        {one
                          ? m.plan_gap_delete_one({
                              dearer: gap.dearer.name,
                              cheaper: joinNames(gap.cheaper.map((t) => t.name)),
                            })
                          : m.plan_gap_delete_other({
                              dearer: gap.dearer.name,
                              count: onlyHereTotal,
                              cheaper: joinNames(gap.cheaper.map((t) => t.name)),
                            })}
                      </b>
                      {m.plan_gap_delete_body({ dearer: gap.dearer.name })}
                    </PlanGuidanceNote>
                  {/each}
                </div>
              {/if}
            {/if}
            <label class="choice-card" data-selected={deleteChoice === 'keep' || undefined}>
              <input
                type="radio"
                name="tier-delete-choice"
                class="sr-only"
                value="keep"
                checked={deleteChoice === 'keep'}
                onchange={() => (deleteChoice = 'keep')}
              />
              <span class="choice-text">
                <span class="choice-label">
                  {one ? m.monetisation_tier_delete_keep_one() : m.monetisation_tier_delete_keep_other()}
                </span>
                <span class="choice-desc">
                  {one
                    ? m.monetisation_tier_delete_keep_desc_one()
                    : m.monetisation_tier_delete_keep_desc_other()}
                  {#if onlyHereCourses > 0}
                    {onlyHereCourses === 1
                      ? m.monetisation_tier_delete_keep_course_one()
                      : m.monetisation_tier_delete_keep_course_other()}
                  {/if}
                </span>
              </span>
              <span class="choice-check" aria-hidden="true"></span>
            </label>
          </fieldset>

          {#if alsoElsewhere > 0 && otherTierNames}
            {@const elsewhere = countsAnd(
              impact.alsoInOtherPlans.films,
              impact.alsoInOtherPlans.courses,
              true
            )}
            <p class="impact-foot">
              {alsoElsewhere === 1
                ? m.monetisation_tier_delete_unaffected_one({ counts: elsewhere, tiers: otherTierNames })
                : m.monetisation_tier_delete_unaffected_other({ counts: elsewhere, tiers: otherTierNames })}
            </p>
          {/if}
        {/if}
      {/if}
      {#if deleteError}
        <Alert variant="error">{deleteError}</Alert>
      {/if}
    </Dialog.Body>
    <Dialog.Footer>
      {#if impact && impact.liveSubscriberCount > 0}
        <Button variant="ghost" onclick={() => { deleteDialogOpen = false; deletingTier = null; }}>
          {m.monetisation_tier_delete_close()}
        </Button>
      {:else}
        <Button variant="ghost" onclick={() => { deleteDialogOpen = false; deletingTier = null; }} disabled={deleteLoading}>
          {m.monetisation_cancel()}
        </Button>
        <Button
          variant="destructive"
          onclick={handleDeleteTier}
          loading={deleteLoading}
          disabled={!deleteReady}
        >
          {m.monetisation_tiers_delete()}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
{/if}

<style>
  .monetisation {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .card-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  /* Takes focus after a Retry that failed again; shown for keyboard users. */
  .load-error-focus:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-md);
  }

  /* Return-from-Stripe / readiness alerts: text and CTA side by side, the CTA
     immediately after the prose rather than at the far edge of the column. */
  .return-alert {
    display: grid;
    gap: var(--space-3);
    align-items: start;
  }

  @media (--breakpoint-sm) {
    .return-alert {
      grid-template-columns: minmax(0, auto) auto;
      justify-content: start;
      align-items: center;
      column-gap: var(--space-5);
    }
  }

  .return-alert__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: var(--measure-lede);
    min-width: 0;
  }

  /* Weight, not opacity — fading `inherit` would cut the Alert variant's
     verified contrast. */
  .return-alert__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: inherit;
  }

  .return-alert__description {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: inherit;
    text-wrap: pretty;
  }

  /* Connect */
  .connect-status-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  /* `--color-status-success-text`, NOT the raw `--color-success-600`. That token
     is a fixed sRGB literal (`#16a34a`) with no `[data-theme]` and no
     `[data-org-brand]` remap, so it painted the same green in all six org ×
     theme combos: 3.30:1 on white, 2.89:1 on the of-blood-and-bones cream —
     both AA failures for `--text-sm` body copy. The status triple is
     color-mixed back toward the page's own ink, so it tracks every surface.
     Same conversion this pass already made in AgreementCard's pills and the
     pricing-FAQ danger button; this selector was the last holdout. */
  .status-enabled {
    color: var(--color-status-success-text);
  }

  .connect-actions {
    margin-top: var(--space-3);
  }

  /* Connect requirements alert
   * Lives inside <Alert variant="warning">; the Alert component owns the
   * outer background/border/text-colour via design tokens (already WCAG AA
   * verified). These styles cover ONLY the inner content layout. */
  .requirements-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .requirements-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    /* Inherit colour from Alert variant — preserves WCAG AA contrast */
    color: inherit;
  }

  .requirements-description {
    margin: 0;
    font-size: var(--text-sm);
    color: inherit;
  }

  .requirements-list {
    margin: 0;
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: inherit;
  }

  .requirements-errors {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: inherit;
  }

  .requirements-errors summary {
    cursor: pointer;
    font-weight: var(--font-medium);
    /* Visible focus for keyboard users — Alert variant border colour is too
     * subtle for a focus indicator. */
    border-radius: var(--radius-sm);
    padding: var(--space-1) 0;
  }

  .requirements-errors summary:focus-visible {
    outline: var(--border-width) var(--border-style) currentColor;
    outline-offset: var(--space-1);
  }

  .requirements-errors ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* Feature toggle.
     `justify-content: space-between` here was the mechanism behind a measured
     1404px gap between "Enable Subscriptions" and the switch that enables it.
     The switch now leads the row and the label follows it, so the pair reads as
     one control at any studio width. */
  .feature-toggle-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .feature-toggle-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-width: var(--measure-lede);
    min-width: 0;
  }

  .feature-toggle-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .feature-toggle-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .feature-toggle-disabled-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }

  /* Tier list */
  .tier-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Explicit grid: rank · details · recommended · prices · [spacer] · actions.
     The spacer is the ONLY elastic track, so every meaning-bearing cluster packs
     against the one before it and only the row actions take the right edge —
     which is where row actions conventionally live and therefore the one
     position that needs no label to be understood.

     `--measure-lede` caps the details column so a long description wraps into a
     readable block instead of stretching one line across the column. A `ch`
     measure, so it tracks the row's own font-size and the org's text scale. This
     is a COLUMN constraint inside a card, not a page cap — the studio shell
     still owns the content width. */
  .tier-item {
    display: grid;
    /* rank · details · recommended · prices · actions · slack.
       The slack track is LAST, so every cluster packs against the one before it
       and the trailing space falls at the row's right edge. An earlier revision
       put the slack before the actions to pin them right, which still measured
       ~900px of empty row between a tier's name and the buttons that edit it —
       the same defect in a smaller size. Trailing whitespace inside a bordered
       row reads as breathing room; a 900px interior gap reads as broken. */
    grid-template-columns:
      auto
      minmax(0, var(--measure-lede))
      auto
      auto
      auto
      1fr;
    align-items: center;
    column-gap: var(--space-5);
    row-gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .tier-item:hover {
    background-color: var(--color-surface-secondary);
  }

  .tier-item--skeleton:hover {
    background-color: transparent;
  }

  /* Phones: one column, rank and details on the first line, the controls
     stacked under them. The old flex-wrap version squeezed the details to zero
     width and the tier name spilled over the toggle. */
  @media (--below-sm) {
    .tier-item {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .tier-recommended,
    .tier-prices,
    .tier-actions {
      grid-column: 1 / -1;
    }

  }

  .tier-rank {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .tier-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .tier-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* Wraps. `white-space: nowrap` + ellipsis truncated the description at every
     viewport — including the 1808px one with room for all of it. */
  .tier-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  /* Per-tier subscriber count, folded in from the deleted breakdown card. Links
     to the filtered subscriber list — a number you can walk into. */
  .tier-subscribers {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    align-self: flex-start;
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors);
  }

  .tier-subscribers:hover {
    color: var(--color-text);
    border-bottom-color: var(--color-border-strong, var(--color-border));
  }

  .tier-subscribers:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .tier-subscribers-mrr {
    font-variant-numeric: tabular-nums;
  }

  .tier-recommended {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  /* `aria-hidden` in the markup: the Switch already carries the full
     "Mark <tier> as recommended" accessible name, so exposing this too would
     make a screen reader announce the word twice for one control. It exists for
     sighted users, who had no label at all. */
  .tier-recommended-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .tier-prices {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  /* `--color-text-secondary`, not `--color-text-muted`: muted measures 2.52:1 on
     the platform light theme and never clears 4.5:1 in any org × theme, and
     this is a NEW 12px price fact. Secondary derives back toward the page ink.
     (`.tier-interval` below is a pre-existing consumer of the same token —
     systemic, ~320 call sites, tracked in Codex-rj4xm.) */
  .tier-saving {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .tier-price {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .tier-price-secondary {
    color: var(--color-text-secondary);
  }

  .tier-interval {
    font-weight: var(--font-normal);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .tier-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  /* Tier form */
  .tier-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  /* Two price inputs side-by-side crush below ~155px each on phones; stack. */
  @media (--below-sm) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }

  .form-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Delete confirm */
  .delete-confirm {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Plan access (Codex-2hxff.91) ───────────────────────────────────── */

  /* The row's count, a link into "What's in <tier>", styled as the
     subscriber count beside it. */
  .tier-content-link {
    align-items: center;
    gap: var(--space-1);
  }

  /* The guidance notes span the row under its clusters. */
  .tier-gaps {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  @media (--breakpoint-sm) {
    .tier-gaps {
      grid-column: 2 / -1;
    }
  }

  /* A radio group in the content editor's access-card look: the create
     dialog's "Include everything from…" and the delete dialog's choice. */
  .choice-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .choice-legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .choice-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .choice-card:hover {
    border-color: color-mix(in srgb, var(--color-interactive) 50%, var(--color-border));
  }

  .choice-card:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .choice-card[data-selected] {
    border-color: var(--color-interactive);
    background-color: color-mix(in srgb, var(--color-interactive) 5%, var(--color-surface));
  }

  .choice-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .choice-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .choice-desc {
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .choice-check {
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .choice-card[data-selected] .choice-check {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive);
    box-shadow: inset 0 0 0 var(--space-1) var(--color-surface);
  }

  .choice-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline-start: var(--space-4);
  }

  /* The delete dialog's impact block. */
  .impact-lede {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text);
  }

  .impact-lede b {
    font-weight: var(--font-semibold);
  }

  .impact-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    list-style: none;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .impact-list li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }

  .impact-kind {
    flex: none;
    min-width: var(--space-14);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .impact-more {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .impact-foot {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .impact-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* An alert's sentence, then its action. */
  .alert-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }

  /* An alert with a leading icon. */
  .alert-icon-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-2);
    align-items: start;
    line-height: var(--leading-normal);
  }

  .alert-icon-row :global(svg) {
    margin-top: var(--space-0-5);
  }

  .alert-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .alert-copy b {
    font-weight: var(--font-semibold);
  }

  .alert-link {
    align-self: flex-start;
    color: inherit;
    font-weight: var(--font-semibold);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
  }

</style>
