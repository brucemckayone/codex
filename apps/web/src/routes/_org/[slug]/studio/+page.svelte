<!--
  @component StudioDashboard

  Editorial studio dashboard. Production-grade creator-first surface built
  to the house style established by ContentForm (numbered ordinals,
  backdrop-filter command bar, brand-tinted OKLCH accents, focus rail).

  Layout (from top):
    01  Sticky DashboardCommandBar        — org identity + today narrative + actions
    02  TodayStat hero + inline stat row  — feature stat (revenue if admin, else content)
                                             with 14-point sparkline, supporting tiles
    03  Two-column: FocusRail + ActivityStream
                                           — what needs you / what just happened

  Role gating preserves the original rules:
   - Admin/owner see revenue + customers stats and the revenue-feature tile
   - All roles see content + views
   - Admin-only actions (Create, branding focus) hidden for members

  All remote function calls and request shapes are preserved —
  getDashboardStats(orgId) + getActivityFeed({ organizationId, limit }).
-->
<script lang="ts">
  import DashboardCommandBar from '$lib/components/studio/dashboard/DashboardCommandBar.svelte';
  import TodayStat from '$lib/components/studio/dashboard/TodayStat.svelte';
  import FocusRail from '$lib/components/studio/dashboard/FocusRail.svelte';
  import ActivityStream from '$lib/components/studio/dashboard/ActivityStream.svelte';
  import type { FocusItem } from '$lib/components/studio/dashboard/FocusRail.svelte';
  import {
    PlusIcon,
    EditIcon,
    UsersIcon,
    FileTextIcon,
  } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import { getDashboardStats, getActivityFeed } from '$lib/remote/admin.remote';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const isAdmin = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );

  // Preserve original remote function calls and param shapes exactly.
  const statsQuery = $derived(
    data.org?.id ? getDashboardStats(data.org.id) : null
  );
  const activitiesQuery = $derived(
    data.org?.id
      ? getActivityFeed({ organizationId: data.org.id, limit: 12 })
      : null
  );

  const stats = $derived(statsQuery?.current ?? null);
  const statsLoading = $derived(statsQuery?.loading ?? false);
  const activities = $derived(activitiesQuery?.current?.items ?? []);
  const activitiesLoading = $derived(activitiesQuery?.loading ?? false);

  // ── Sparkline series (14-day revenue for the admin feature tile) ──────────
  const revenueSeries = $derived.by(() => {
    const days = stats?.revenue?.revenueByDay ?? [];
    return days.slice(-14).map((d) => d.revenueCents ?? 0);
  });

  // ── Today narrative ───────────────────────────────────────────────────────
  // Single-line English summary. Graceful for missing fields.
  // TODO i18n — key: studio_dashboard_narrative_placeholder
  const narrative = $derived.by(() => {
    if (!stats) return 'Pulling today\u2019s numbers together…';

    const parts: string[] = [];
    const drafts = data.badgeCounts?.draftContent ?? 0;
    const todayRevenue = (stats.revenue?.revenueByDay ?? []).slice(-1)[0]
      ?.revenueCents ?? 0;
    const newCustomers = stats.customers?.change ?? 0;

    if (isAdmin && todayRevenue > 0) {
      parts.push(`${formatPrice(todayRevenue)} earned today`);
    }
    if (drafts > 0) {
      parts.push(drafts === 1 ? '1 draft in progress' : `${drafts} drafts in progress`);
    }
    if (isAdmin && newCustomers > 0) {
      parts.push(
        newCustomers === 1
          ? '1 new customer this week'
          : `${newCustomers} new customers this week`
      );
    }

    if (parts.length === 0) {
      return isAdmin
        ? 'Quiet so far. A good time to publish something new.'
        : 'Nothing pressing — plenty of room to create.';
    }
    return parts.join(' · ') + '.';
  });

  // ── Focus items (contextual — real work, not generic links) ──────────────
  const focusItems = $derived.by<FocusItem[]>(() => {
    const items: FocusItem[] = [];
    const drafts = data.badgeCounts?.draftContent ?? 0;

    if (drafts > 0) {
      items.push({
        id: 'drafts-ready',
        eyebrow: drafts === 1 ? '1 draft' : `${drafts} drafts`,
        title: 'Continue a draft',
        description:
          'Pick up where you left off — finish the details, attach media, and publish.',
        href: '/studio/content?status=draft',
        tone: 'action',
        icon: EditIcon,
      });
    }

    // Empty-state nudges — only shown when there's nothing else pressing
    if (items.length === 0 && (stats?.contentCount?.value ?? 0) === 0) {
      items.push({
        id: 'first-content',
        eyebrow: 'First step',
        title: 'Create your first piece of content',
        description:
          'Upload a video, record audio, or write an article. Your audience is waiting.',
        href: '/studio/content?action=create',
        tone: 'action',
        icon: PlusIcon,
      });
    }

    if (isAdmin) {
      // Customers tile — visible only to admin/owner, prompts CRM review
      const customerCount = stats?.customers?.value ?? 0;
      if (customerCount > 0) {
        items.push({
          id: 'review-customers',
          eyebrow: customerCount === 1 ? '1 customer' : `${customerCount} customers`,
          title: 'Review customer activity',
          description:
            'See recent purchases, top spenders, and who to thank personally.',
          href: '/studio/customers',
          tone: 'muted',
          icon: UsersIcon,
        });
      }

      // Branding nudge — always useful for an admin, especially new orgs
      items.push({
        id: 'refine-brand',
        eyebrow: 'Craft',
        title: 'Refine your brand',
        description:
          'Colour, typography, and hero shader presets — your public face.',
        href: '/studio/settings/branding',
        tone: 'muted',
        icon: EditIcon,
      });
    } else {
      // Non-admin surface: point them at creating/viewing content
      items.push({
        id: 'browse-content',
        eyebrow: 'Library',
        title: 'Browse your content',
        description: 'Search, filter, and jump straight into any piece.',
        href: '/studio/content',
        tone: 'muted',
        icon: FileTextIcon,
      });
    }

    return items;
  });

  // ── Supporting stat config ───────────────────────────────────────────────
  // `feature` for the hero tile, `inline` for the compact row beneath
  const statConfig = $derived.by(() => {
    if (isAdmin) {
      return [
        {
          ordinal: '01',
          label: m.studio_stat_revenue(),
          value: stats ? formatPrice(stats.revenue.value) : '£–',
          change: stats?.revenue.change,
          series: revenueSeries,
          variant: 'feature' as const,
        },
        {
          ordinal: '02',
          label: m.studio_stat_customers(),
          value: stats?.customers.value ?? '–',
          change: stats?.customers.change,
          variant: 'inline' as const,
        },
        {
          ordinal: '03',
          label: m.studio_stat_content(),
          value: stats?.contentCount.value ?? '–',
          change: stats?.contentCount.change,
          variant: 'inline' as const,
        },
        {
          ordinal: '04',
          label: m.studio_stat_views(),
          value: stats?.views.value ?? '–',
          change: stats?.views.change,
          variant: 'inline' as const,
        },
      ];
    }
    // Non-admin: only content + views; use content as feature tile
    return [
      {
        ordinal: '01',
        label: m.studio_stat_content(),
        value: stats?.contentCount.value ?? '–',
        change: stats?.contentCount.change,
        series: undefined,
        variant: 'feature' as const,
      },
      {
        ordinal: '02',
        label: m.studio_stat_views(),
        value: stats?.views.value ?? '–',
        change: stats?.views.change,
        variant: 'inline' as const,
      },
    ];
  });

  const featureStat = $derived(statConfig[0]);
  const inlineStats = $derived(statConfig.slice(1));
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | {data.org.name}</title>
</svelte:head>

<div class="dashboard">
  <!-- ── 01  Command bar (sticky editorial header) ── -->
  <DashboardCommandBar
    orgName={data.org.name}
    logoUrl={data.org.logoUrl}
    userName={data.studioUser.name}
    {narrative}
    {isAdmin}
  />

  <!-- ── 02  Stat tiles (feature + inline row) ── -->
  <section class="stat-grid" aria-label="Dashboard statistics">
    <div class="stat-feature">
      <TodayStat
        ordinal={featureStat.ordinal}
        label={featureStat.label}
        value={featureStat.value}
        change={featureStat.change}
        series={'series' in featureStat ? featureStat.series : undefined}
        loading={statsLoading || !stats}
        variant="feature"
      />
    </div>
    <div class="stat-inline-row">
      {#each inlineStats as stat (stat.ordinal)}
        <TodayStat
          ordinal={stat.ordinal}
          label={stat.label}
          value={stat.value}
          change={stat.change}
          loading={statsLoading || !stats}
          variant="inline"
        />
      {/each}
    </div>
  </section>

  <!-- ── 03  Split: Focus rail + Activity stream ── -->
  <section class="below-fold">
    <FocusRail items={focusItems} />
    <ActivityStream
      activities={activities}
      loading={activitiesLoading}
    />
  </section>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    /* Let the parent studio layout govern width; `--container-studio` is
       intentionally unset in tokens (removed on purpose). Falling back to
       `none` = full studio width, which is what we want here. */
    max-width: var(--container-studio);
    width: 100%;
  }

  /* ── Stat tiles ────────────────────────────────────────────── */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .stat-feature {
    min-width: 0;
  }

  .stat-inline-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    min-width: 0;
  }

  /* Small tablet: inline stats become 2-up */
  @media (--breakpoint-sm) {
    .stat-inline-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Wide: feature tile takes the left half, inline stats fill a 3-up row
     to the right. The feature tile is intentionally tall + sparkline-rich,
     so it balances against three tighter supporting tiles. */
  @media (--breakpoint-lg) {
    .stat-grid {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.9fr);
      gap: var(--space-5);
      align-items: stretch;
    }
    .stat-inline-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  /* Non-admin path only has one supporting stat — keep it single-column on lg */
  @media (--breakpoint-lg) {
    .stat-inline-row:has(> :only-child) {
      grid-template-columns: 1fr;
    }
  }

  /* ── Below the fold: focus + activity ──────────────────────── */
  .below-fold {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-lg) {
    .below-fold {
      /* Focus rail is narrower than activity — editorial asymmetry.
         minmax(0, …) prevents intrinsic min-content from blowing the grid. */
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
      gap: var(--space-5);
      align-items: start;
    }
  }
</style>
