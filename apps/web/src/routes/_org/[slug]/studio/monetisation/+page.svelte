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
  import { TrashIcon, EditIcon, PlusIcon, CheckCircleIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { onMount } from 'svelte';
  import {
    listTiers,
    getConnectStatus,
    getSubscriptionStats,
    createTier,
    updateTier,
    deleteTier,
    connectOnboard,
    getConnectDashboardLink,
    updateSubscriptionFeature,
    syncConnectStatus,
  } from '$lib/remote/subscription.remote';
  import { getOrgSettings } from '$lib/remote/org.remote';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import { humanizeRequirement } from '$lib/utils/connect-requirement-humanization';
  import { isConnectReady, moneyReadiness } from '$lib/utils/connect-readiness';
  import type { ConnectRequirements, SubscriptionTier } from '$lib/types';

  /** Shape returned by SvelteKit's query() when called client-side */
  interface QueryResult<T> {
    current: T | undefined;
    loading?: boolean;
  }

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
  const connectQuery = $derived(orgId ? getConnectStatus(orgId) : null);
  const settingsQuery = $derived(orgId ? getOrgSettings(orgId) : null);
  const statsQuery = $derived(orgId ? getSubscriptionStats(orgId) : null);

  // Derived data from queries (with safe defaults)
  const tiers = $derived(
    ((tiersQuery as QueryResult<SubscriptionTier[]> | null)?.current ?? [])
  );
  const connectStatus = $derived(
    (connectQuery as QueryResult<{
      isConnected: boolean; accountId: string | null;
      chargesEnabled: boolean; payoutsEnabled: boolean; status: string | null;
      requirements: ConnectRequirements | null;
      requirementsFetchFailed?: boolean;
    }> | null)?.current ?? {
      isConnected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, status: null, requirements: null,
      requirementsFetchFailed: false,
    }
  );

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
  const stats = $derived(
    (statsQuery as QueryResult<{
      totalSubscribers: number; activeSubscribers: number;
      mrrCents: number; tierBreakdown: unknown[];
    }> | null)?.current ?? {
      totalSubscribers: 0, activeSubscribers: 0, mrrCents: 0, tierBreakdown: [],
    }
  );

  const dataLoading = $derived(
    (tiersQuery as QueryResult<unknown> | null)?.loading
    || (connectQuery as QueryResult<unknown> | null)?.loading
    || (settingsQuery as QueryResult<unknown> | null)?.loading
  );

  /**
   * The one money-readiness verdict for this page. `showTierPrompt` stays off in
   * the prompt below because the Tiers card owns its own empty state — saying
   * "add a tier" twice on one screen is the duplication this pass removed.
   */
  const readiness = $derived(
    moneyReadiness(connectStatus, {
      hasTiers: tiers.length > 0,
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
   */
  const showReadinessPrompt = $derived(
    (readiness.blocking && readiness.hasSubscribers) ||
      readiness.state === 'stripe_unknown'
  );

  /** Per-tier subscriber counts, so each row carries its own number instead of
      a second card restating the whole stats grid. */
  const subscribersByTier = $derived.by(() => {
    const map = new Map<string, { count: number; mrrCents: number }>();
    for (const row of stats.tierBreakdown as Array<{
      tierId: string; subscriberCount: number; mrrCents: number;
    }>) {
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

  // Delete dialog state
  let deleteLoading = $state(false);
  let deleteError = $state('');

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
    syncConnectStatus({ organizationId: orgId })
      .then(() => getConnectStatus(orgId).refresh())
      .then(() => {
        // Read the freshly-synced status, not the pre-sync snapshot.
        if (isConnectReady(connectStatus) && tiers.length === 0) {
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
   * Re-check status against Stripe. Only ever on an explicit click — this hits
   * the live Stripe API, so firing it on load would turn every page view into a
   * third-party round trip.
   */
  async function handleRecheckStatus() {
    if (!orgId) return;
    recheckingStatus = true;
    try {
      await syncConnectStatus({ organizationId: orgId });
      await getConnectStatus(orgId).refresh();
    } catch {
      connectError = m.monetisation_connect_dashboard_error();
    } finally {
      recheckingStatus = false;
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
    // Defense-in-depth: the button is disabled when !connectReady, but guard
    // the handler too so a stray programmatic call can't open a dialog that
    // would only fail on submit.
    if (!connectReady) return;
    editingTier = null;
    tierName = '';
    tierDescription = '';
    tierPriceMonthly = 499;
    tierPriceAnnual = 4990;
    tierFormError = '';
    tierDialogOpen = true;
  }

  function openEditTier(tier: SubscriptionTier) {
    editingTier = tier;
    tierName = tier.name;
    tierDescription = tier.description ?? '';
    tierPriceMonthly = tier.priceMonthly;
    tierPriceAnnual = tier.priceAnnual;
    tierFormError = '';
    tierDialogOpen = true;
  }

  function openDeleteTier(tier: SubscriptionTier) {
    deletingTier = tier;
    deleteError = '';
    deleteDialogOpen = true;
  }

  async function handleTierSubmit() {
    tierFormLoading = true;
    tierFormError = '';
    try {
      if (editingTier) {
        await updateTier({
          orgId,
          tierId: editingTier.id,
          name: tierName,
          description: tierDescription || undefined,
          priceMonthly: tierPriceMonthly,
          priceAnnual: tierPriceAnnual,
        });
      } else {
        await createTier({
          orgId,
          name: tierName,
          description: tierDescription || undefined,
          priceMonthly: tierPriceMonthly,
          priceAnnual: tierPriceAnnual,
        });
      }
      tierDialogOpen = false;
      await invalidateAll();
    } catch (error) {
      tierFormError = error instanceof Error ? error.message : m.monetisation_tier_save_error();
    } finally {
      tierFormLoading = false;
    }
  }

  async function handleDeleteTier() {
    if (!deletingTier) return;
    deleteLoading = true;
    deleteError = '';
    try {
      await deleteTier({ orgId, tierId: deletingTier.id });
      deleteDialogOpen = false;
      deletingTier = null;
      await invalidateAll();
    } catch (error) {
      deleteError = error instanceof Error ? error.message : m.monetisation_tier_delete_error();
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
      featureToggleError = error instanceof Error ? error.message : m.monetisation_feature_toggle_error();
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
      const result = await connectOnboard({
        organizationId: orgId,
        returnUrl,
        refreshUrl,
      });
      window.location.href = result.onboardingUrl;
    } catch (error) {
      connectError = error instanceof Error ? error.message : m.monetisation_connect_onboard_error();
      connectLoading = false;
    }
  }

  async function handleConnectDashboard() {
    connectLoading = true;
    connectError = '';
    try {
      const result = await getConnectDashboardLink({ organizationId: orgId });
      window.location.href = result.url;
    } catch (error) {
      const msg = error instanceof Error ? error.message : m.monetisation_connect_dashboard_error();
      connectError = msg.includes('test') || msg.includes('seed') || msg === 'API Error'
        ? m.monetisation_connect_dashboard_test_error()
        : msg;
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

  <!-- Stripe Connect Card -->
  <Card.Root>
    <Card.Header>
      <div class="card-header-row">
        <Card.Title level={3}>{m.monetisation_connect_title()}</Card.Title>
        {#if dataLoading}
          <Skeleton width="var(--space-20)" height="var(--space-6)" class="skeleton-circle" />
        {:else}
          <Badge
            variant={connectStatusVariant(connectStatus.status)}
            data-testid="connect-status-badge"
            data-connect-status={connectStatus.status ?? 'not_connected'}
          >
            {connectStatusLabel(connectStatus.status)}
          </Badge>
        {/if}
      </div>
      <Card.Description>{m.monetisation_connect_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if dataLoading}
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
      {#if featureToggleError}
        <Alert variant="error" style="margin-top: var(--space-3)">{featureToggleError}</Alert>
      {/if}
      {#if !dataLoading && (!connectStatus.isConnected || connectStatus.status !== 'active')}
        <p class="feature-toggle-disabled-hint">{m.monetisation_feature_requires_connect()}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Subscriber summary. Two of the three tiles link through to the people
       behind the number — there was previously no path at all from the stats to
       /studio/subscribers. Treatment matches studio/customers' band rather than
       StatCard, which measures visibly flatter on a dark page. -->
  {#if stats.totalSubscribers > 0}
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
        <Button onclick={openCreateTier} size="sm" disabled={dataLoading || !connectReady}>
          <PlusIcon size={14} />
          {m.monetisation_tiers_create()}
        </Button>
      </div>
    </Card.Header>
    <Card.Content>
      {#if !dataLoading && !connectReady}
        <Alert variant="info" style="margin-bottom: var(--space-4)">
          {m.monetisation_tiers_requires_connect()}
        </Alert>
      {/if}
      {#if dataLoading}
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
              <div class="tier-actions">
                <Button variant="ghost" size="sm" onclick={() => openEditTier(tier)} aria-label={m.monetisation_tiers_edit()}>
                  <EditIcon size={14} />
                </Button>
                <Button variant="ghost" size="sm" onclick={() => openDeleteTier(tier)} aria-label={m.monetisation_tiers_delete()}>
                  <TrashIcon size={14} />
                </Button>
              </div>
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
      <p class="delete-confirm">{m.monetisation_tiers_delete_confirm()}</p>
      {#if deleteError}
        <Alert variant="error">{deleteError}</Alert>
      {/if}
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => { deleteDialogOpen = false; deletingTier = null; }} disabled={deleteLoading}>
        {m.monetisation_cancel()}
      </Button>
      <Button variant="destructive" onclick={handleDeleteTier} loading={deleteLoading}>
        {m.monetisation_tiers_delete()}
      </Button>
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

  .status-enabled {
    color: var(--color-success-600);
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

  .tier-saving {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
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
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

</style>
