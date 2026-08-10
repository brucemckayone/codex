<!--
  @component StudioBilling

  What Codex charged this organisation, and what was left. Owner-only.

  ── WHY THIS PAGE LOOKS LIKE THIS ────────────────────────────────────────
  Billing used to render 3 of the 7 fields it fetches from
  `getOrgRevenue`, and the 4 it dropped (`platformFeeCents`,
  `organizationFeeCents`, `creatorPayoutCents`, `revenueByDay`) were exactly
  the ones that describe the only charge Codex makes to an organisation — a
  per-transaction platform fee (`fee_config_platform.platform_fee_percent`,
  1000bps today). With Sales owning transactions, Payouts owning transfers
  out and Monetisation owning prices, "what the platform took" was the only
  unclaimed territory, so the fee ledger below is now the page's subject.

  ── THE WINDOW IS 30 DAYS, NOT ALL-TIME ──────────────────────────────────
  `getOrgRevenue` passes no date params, so `AnalyticsService`
  `computeRevenueBlock` falls back to `ANALYTICS.TREND_DAYS_DEFAULT` (30).
  Every figure here is therefore a 30-day figure and is labelled as one.
  Measured on studio-alpha: 30-day = 6 purchases / £99.94, all-time = 12 /
  £174.88 — which is why the old unqualified "Total Revenue £100" read as a
  bug against `/studio/customers`' £174.88. Do NOT "fix" this by passing
  startDate/endDate: choosing the window is choosing the page's job, and
  `adminRevenueQuerySchema` caps a range at 365 days so "all-time" is not
  even expressible.

  @prop data - Org info and userRole from parent studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Table from '$lib/components/ui/Table';
  import { Alert, Card, EmptyState, PageHeader } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { portalSessionForm, getOrgRevenue, getTopContent } from '$lib/remote/billing.remote';
  import { formatPrice } from '$lib/utils/format';
  import { queryErrorMessage, type QueryResult } from '$lib/remote/query-result';

  // Shape of the slice of `getOrgRevenue`'s payload this page reads. The
  // remote query's return type is loose (see query-result.ts), so the cast
  // below names what is actually consumed rather than asserting the whole
  // `RevenueStats` contract.
  type RevenueBlock = {
    totalRevenueCents: number;
    totalPurchases: number;
    averageOrderValueCents: number;
    platformFeeCents: number;
    organizationFeeCents: number;
    creatorPayoutCents: number;
  };
  type TopContentPage = {
    items: Array<{
      contentId: string;
      contentTitle: string;
      revenueCents: number;
      purchaseCount: number;
    }>;
  };

  let { data } = $props();

  // Role guard: owner only. Wait for data.userRole to populate —
  // ssr=false means first render has data.userRole === undefined.
  $effect(() => {
    if (data.userRole !== undefined && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');

  const revenueQuery = $derived(
    isOwner ? getOrgRevenue({ organizationId: data.org.id }) : null
  );

  const topContentQuery = $derived(
    isOwner ? getTopContent({ organizationId: data.org.id, limit: 5 }) : null
  );

  // Split per query (was one combined `loading`): the revenue tiles and the
  // top-content table are independent round-trips, so neither should sit on a
  // skeleton waiting for the other.
  const revenueLoading = $derived(
    (revenueQuery as QueryResult<RevenueBlock> | null)?.loading ?? true
  );
  const topContentLoading = $derived(
    (topContentQuery as QueryResult<TopContentPage> | null)?.loading ?? true
  );

  // In-page failure reporting, matching sales/payouts/subscribers/settings.
  // Billing alone had none, so a failed analytics call replaced the WHOLE page
  // with +error.svelte and took the Stripe portal button — which does not
  // depend on that call — down with it. Read through `queryErrorMessage`:
  // SvelteKit rejects with HttpError, whose text is at `.body.message`, so
  // `.error?.message` is always undefined (Codex-xo3bl).
  const revenueError = $derived(
    queryErrorMessage((revenueQuery as QueryResult<RevenueBlock> | null)?.error)
  );
  const topContentError = $derived(
    queryErrorMessage(
      (topContentQuery as QueryResult<TopContentPage> | null)?.error
    )
  );

  const revenue = $derived(
    (revenueQuery as QueryResult<RevenueBlock> | null)?.current
  );

  // Derived stats from revenue data
  const totalRevenue = $derived(revenue?.totalRevenueCents ?? 0);
  const totalPurchases = $derived(revenue?.totalPurchases ?? 0);
  const avgOrder = $derived(revenue?.averageOrderValueCents ?? 0);

  // ── The fee ledger ───────────────────────────────────────────────────
  // `platformFeeCents` is the platform's slice, summed per purchase over the
  // window. Everything that is NOT the platform's slice stayed on the
  // organisation's side of the boundary — verified as an identity in the DB
  // for all three seeded orgs (gross − platform fee === org fee + creator
  // payout), so deriving it by subtraction is both simpler and robust to a
  // writer that leaves one of the two component columns null.
  const platformFee = $derived(revenue?.platformFeeCents ?? 0);
  const orgFee = $derived(revenue?.organizationFeeCents ?? 0);
  const creatorPayout = $derived(revenue?.creatorPayoutCents ?? 0);
  const leftWithOrg = $derived(Math.max(0, totalRevenue - platformFee));

  // Guard the divide: an org with no purchases in the window has gross 0 and
  // no meaningful rate. `organizationFeeCents` is 0 on two of the three seeded
  // orgs, so the org-fee disclosure is conditional — a flat "£0 org fee" line
  // reads as a broken tile rather than as "this org takes no cut".
  const effectiveRate = $derived(
    totalRevenue > 0 ? (platformFee / totalRevenue) * 100 : null
  );
  const showSplitDisclosure = $derived(orgFee > 0 && creatorPayout > 0);

  // Top content items
  const topContentItems = $derived(
    (topContentQuery as QueryResult<TopContentPage> | null)?.current?.items ?? []
  );
</script>

<svelte:head>
  <title>{m.billing_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting... -->
{:else}
<div class="billing">
  <PageHeader
    kicker={m.studio_section_money()}
    title={m.billing_title()}
    description="What Codex charged this organisation over the last 30 days, and what was left with you. Sales lists the individual transactions; Payouts tracks the transfers."
  />
  <!-- i18n: `description` above replaces m.billing_description(), which claimed
       an all-time window the query never requests and "where your own Codex
       subscription is billed" — a product with no column behind it
       (`organizations` has no plan/tier/subscription; `subscription_tiers` are
       fan→org). New value listed for billing_description in the WP report. -->

  {#if revenueError}
    <Alert variant="error">Could not load the revenue summary: {revenueError}</Alert>
  {:else}
    <!-- Revenue Summary Cards. Period-labelled: an unqualified "Total Revenue"
         next to /studio/customers' all-time £174.88 reads as a bug in the
         money, which is the worst thing a billing page can look like.

         EXACT PENCE, not formatPriceCompact. The tile labelled
         "Gross · last 30 days" sits ~200px above a ledger row with the
         IDENTICAL label, and compact rounding made the pair disagree on every
         real org — bones £83 vs £82.96, alpha £100 vs £99.94, beta £30 vs
         £29.99. Two different numbers under one label is the same "reads as a
         bug in the money" failure the period label was added to fix, so the
         summary now agrees with the statement to the penny. `.stat-value` gets
         tabular figures page-side (StatCard declares none) so the tile digits
         sit on the same rhythm as the ledger they summarise.
         i18n: billing_stat_gross_30d / billing_stat_purchases_30d /
         billing_stat_avg_order / billing_stats_region_label. -->
    <section class="stats-grid" aria-label="Revenue summary">
      <StatCard
        label="Gross · last 30 days"
        value={formatPrice(totalRevenue)}
        loading={revenueLoading}
      />
      <StatCard
        label="Purchases · last 30 days"
        value={totalPurchases}
        loading={revenueLoading}
      />
      <StatCard
        label="Average order"
        value={formatPrice(avgOrder)}
        loading={revenueLoading}
      />
    </section>

    <!-- ── Fee ledger: the page's subject ───────────────────────────────
         Exact pence. This block is a statement of account, so a rounded figure
         here would be a defect rather than a headline — and the tiles above now
         match it to the penny for the aggregate they share. -->
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>What Codex charged</Card.Title>
        <Card.Description>
          Codex takes a percentage of each sale. Nothing else is billed to
          this organisation — there is no plan or subscription fee.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if revenueLoading}
          <div class="fee-ledger-skeleton">
            <Skeleton width="100%" height="var(--space-6)" />
            <Skeleton width="100%" height="var(--space-6)" />
            <Skeleton width="100%" height="var(--space-6)" />
          </div>
        {:else}
          <dl class="fee-ledger">
            <div class="fee-ledger__row">
              <dt>Gross · last 30 days</dt>
              <dd>{formatPrice(totalRevenue)}</dd>
            </div>
            <div class="fee-ledger__row">
              <dt>
                Codex fee
                {#if effectiveRate !== null}
                  <span class="fee-ledger__rate">
                    · {effectiveRate.toFixed(1)}% effective rate
                  </span>
                {/if}
              </dt>
              <!-- The U+2212 MINUS SIGN is the accounting convention and stays,
                   but several screen readers do not announce it — on the page
                   whose subject is "what Codex charged", the charge line would
                   then be read out identically to the Gross line above it. The
                   sr-only word is the non-glyph carrier. (The former
                   `class="fee-ledger__deduction"` here had no rule anywhere in
                   the file — dead attribute, removed.) -->
              <dd><span class="sr-only">minus </span>−{formatPrice(platformFee)}</dd>
            </div>
            <div class="fee-ledger__row fee-ledger__row--total">
              <dt>Left with your organisation</dt>
              <dd>{formatPrice(leftWithOrg)}</dd>
            </div>
          </dl>

          {#if showSplitDisclosure}
            <p class="fee-ledger__note">
              Of that, {formatPrice(orgFee)} is the organisation's own share and
              {formatPrice(creatorPayout)} is owed to creators.
            </p>
          {/if}

          <p class="fee-ledger__note">
            <a href="/studio/payouts">Payouts</a> tracks how that money was
            transferred, including anything Stripe could not send yet.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Top Content by Revenue -->
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>Top content by revenue · last 30 days</Card.Title>
      <!-- i18n: billing_top_content -->
    </Card.Header>
    <Card.Content>
    {#if topContentError}
      <Alert variant="error">Could not load top content: {topContentError}</Alert>
    {:else if topContentLoading}
      <div class="table-skeleton">
        <Skeleton class="table-skeleton-header" width="100%" height="var(--space-10)" />
        {#each Array(3) as _, i (i)}
          <div class="table-skeleton-row">
            <Skeleton width="{40 + (i % 3) * 8}%" height="var(--space-5)" />
            <Skeleton width="20%" height="var(--space-5)" />
            <Skeleton width="15%" height="var(--space-5)" />
          </div>
        {/each}
      </div>
    {:else if topContentItems.length > 0}
      <div class="table-wrapper">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.billing_top_content_column_title()}</Table.Head>
              <Table.Head class="revenue-head">
                {m.billing_top_content_column_revenue()}
              </Table.Head>
              <Table.Head class="purchases-head">
                {m.billing_top_content_column_purchases()}
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each topContentItems as item (item.contentId)}
              <Table.Row>
                <Table.Cell class="content-title-cell">
                  {item.contentTitle}
                </Table.Cell>
                <!-- Exact pence, was formatPriceCompact: billing was the only
                     money page rounding per-row figures (sales + payouts both
                     use formatPrice), so a £4.99 item rendered "£5" beside its
                     own £4.99 price badge. -->
                <Table.Cell class="revenue-cell">
                  {formatPrice(item.revenueCents)}
                </Table.Cell>
                <Table.Cell class="purchases-cell">
                  {item.purchaseCount}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
      <!-- `AnalyticsService.getTopContent` inner-joins `content`, so course and
           portal purchases are counted in the totals above but have no row
           here. On of-blood-and-bones that is 2 of 4 purchases (£24.99 + £24.99
           of £82.96) — 60% of the money, absent and unexplained, which reads as
           data loss. Fixing the join is a change to packages/admin and would
           benefit the dashboard and analytics page too; until then, say so. -->
      <p class="table-note">
        Course and portal sales count towards the totals above but are not
        listed here.
      </p>
    {:else}
      <!-- billing_top_content_empty_description was written and never wired
           (zero call sites outside en.json). It is rendered here in the `action`
           slot rather than passed as `description`, because
           EmptyState's `.empty-state__description` paints
           `--color-text-muted` — measured 2.52:1 light / 3.19:1 dark, a WCAG AA
           body-text failure that belongs to the primitive (Codex-227yr). An org
           with no content purchases in the 30-day window is the COMMON state on
           this page, so its only explanatory sentence must be legible. Same
           correction the payouts empty state carries. -->
      <EmptyState title={m.billing_top_content_empty()}>
        {#snippet action()}
          <p class="empty-note">
            {m.billing_top_content_empty_description()}
          </p>
        {/snippet}
      </EmptyState>
    {/if}
    </Card.Content>
  </Card.Root>

  <!-- ── Personal Stripe portal ────────────────────────────────────────
       `portalSessionForm` re-exports account.remote's form, which resolves to
       PurchaseService.createPortalSession(ctx.user.email, ctx.user.id, …) —
       USER-scoped, not org-scoped. It is the identical form, with the identical
       "Manage Billing" label, that already sits on (platform)/account/payment
       under a card titled "Billing Information". Retitled and relabelled so the
       two are distinguishable and so an owner does not click it expecting the
       organisation's payout account (that lives under Monetisation).
       i18n: billing_manage_stripe (title), billing_manage_stripe_action. -->
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>Your own Codex payments</Card.Title>
      <Card.Description>{m.billing_manage_stripe_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <div class="portal-block">
        <!-- No `class="portal-form"`: it had no rule in this file (dead
             attribute; `.portal-block` owns the column layout). -->
        <form {...portalSessionForm}>
          <Button type="submit" variant="secondary" loading={portalSessionForm.pending > 0}>
            {portalSessionForm.pending > 0 ? m.common_loading() : 'Open Stripe portal'}
          </Button>
        </form>

        <!-- A FIXED sentence, never `portalSessionForm.result.error`.
             account.remote.ts:398-405 sets that field to the raw `error.message`
             off `api.checkout.createPortalSession`, so whatever Stripe said
             landed verbatim in a role="alert" element — "No such customer:
             'cus_QRr8xK2aLmN9'" puts a live Stripe customer id in the DOM for
             any session-replay or error-scraping tool to collect, and announces
             it immediately. It is also unqualified provider jargon for the
             operator. The raw message still needs to be logged server-side and
             the same echo still exists on (platform)/account/payment — both
             beaded. i18n: billing_portal_generic_error. -->
        {#if portalSessionForm.result?.error}
          <Alert variant="error">
            We couldn't open the Stripe portal. Try again in a moment.
          </Alert>
        {/if}

        <p class="portal-note">
          This is not the organisation's payout account — that lives under
          <a href="/studio/monetisation">Monetisation</a>.
        </p>
      </div>
    </Card.Content>
  </Card.Root>
</div>
{/if}

<style>
  /* No max-width here on purpose: the studio shell owns the content column
     via --container-studio. This page is where the old 1200px literal lived;
     re-adding a cap is a regression. */
  .billing {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  /* StatCard declares no `font-variant-numeric`, so these three tiles were the
     only proportional-digit money on the page, directly above a tabular ledger.
     Added here rather than in the primitive: `studio/StatCard.svelte` is shared
     with the dashboard and other studio surfaces, and this round owns neither.
     No conflict to win — the property is simply undeclared upstream. */
  .stats-grid :global(.stat-value) {
    font-variant-numeric: tabular-nums;
  }

  @media (--breakpoint-sm) {
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* ── Fee ledger ──────────────────────────────────────────────────── */

  .fee-ledger {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .fee-ledger__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: var(--text-sm);
  }

  .fee-ledger__row dt {
    color: var(--color-text-secondary);
  }

  .fee-ledger__row dd {
    margin: 0;
    font-weight: var(--font-medium);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  .fee-ledger__rate {
    color: var(--color-text-secondary);
  }

  .fee-ledger__row--total {
    padding-top: var(--space-2);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-base);
  }

  .fee-ledger__row--total dt {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .fee-ledger__row--total dd {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .fee-ledger__note {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .fee-ledger-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Column gap replaces the `style="margin-top: var(--space-3)"` that was
     inline on the error Alert. */
  .portal-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .portal-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .table-wrapper {
    overflow-x: auto;
    margin-top: var(--space-4);
  }

  .table-note {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* The sentence EmptyState would otherwise paint on --color-text-muted. */
  .empty-note {
    margin: 0;
    max-width: var(--measure-lede);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* Scoped via parent — class is applied to inner Skeleton component's
     root via its class prop. */
  .table-skeleton :global(.table-skeleton-header) {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .table-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  /* Scoped under .table-wrapper. These were declared bare — `:global(.revenue-cell)`
     etc. — which leaks three generic names into the app-wide namespace for any
     future table to collide with. */
  .table-wrapper :global(.content-title-cell) {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* What beats TableHead's own `text-align: left` here is the `.table-wrapper`
     DESCENDANT SCOPE, not the `th`. Svelte compiles this selector to
     `.table-wrapper.svelte-XXXX th.revenue-head` = (0,3,1), against TableHead's
     `.table-head.svelte-YYYY` = (0,2,0); with `th` removed it is still (0,3,0)
     and still wins. `th` is a readability hint only — verified by compiling both
     forms. If a sticky-header or overflow refactor ever removes the
     `.table-wrapper` element, this rule drops to (0,1,1), LOSES, and the money
     column header silently goes back to left-aligned over right-aligned tabular
     figures — so the wrapper, or replacement specificity, is the thing to
     preserve. */
  .table-wrapper :global(th.revenue-head),
  .table-wrapper :global(.revenue-cell) {
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .table-wrapper :global(th.purchases-head),
  .table-wrapper :global(.purchases-cell) {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>
