<!--
  @component ActivityStream

  Day-grouped activity timeline. Replaces the flat ActivityFeed list with
  editorial day separators (ordinal date + weekday) and a continuous
  vertical rule threading the timeline dots — a visual system closer to
  Linear/Slack than a generic activity card.

  Accepts the same ActivityItem[] the old ActivityFeed did. Grouping is
  pure client-side: items are sorted by timestamp desc (trust the caller)
  and bucketed by local-date ISO key.

  @prop activities  Activity items, newest first
  @prop loading     True while parent query is pending
-->
<script lang="ts">
  import type { ActivityItem, ActivityItemType } from '@codex/admin';
  import {
    ShoppingBagIcon,
    DownloadIcon,
    UserPlusIcon,
  } from '$lib/components/ui/Icon';

  interface Props {
    activities: ActivityItem[];
    loading?: boolean;
  }

  const { activities, loading = false }: Props = $props();

  const typeMeta: Record<
    ActivityItemType,
    { tone: 'purchase' | 'publish' | 'signup'; verb: string }
  > = {
    purchase: { tone: 'purchase', verb: 'Purchase' },
    content_published: { tone: 'publish', verb: 'Published' },
    member_joined: { tone: 'signup', verb: 'New member' },
  };

  const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
  const dayFormatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  function dayKey(ts: string): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function isToday(ts: string): boolean {
    const d = new Date(ts);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  function isYesterday(ts: string): boolean {
    const d = new Date(ts);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return (
      d.getFullYear() === y.getFullYear() &&
      d.getMonth() === y.getMonth() &&
      d.getDate() === y.getDate()
    );
  }

  interface DayGroup {
    key: string;
    heading: string;
    subhead: string;
    items: ActivityItem[];
  }

  const groups = $derived.by<DayGroup[]>(() => {
    const buckets = new Map<string, ActivityItem[]>();
    for (const item of activities) {
      const k = dayKey(item.timestamp);
      const list = buckets.get(k) ?? [];
      list.push(item);
      buckets.set(k, list);
    }
    const out: DayGroup[] = [];
    for (const [k, list] of buckets) {
      const first = list[0];
      const heading = isToday(first.timestamp)
        ? 'Today'
        : isYesterday(first.timestamp)
          ? 'Yesterday'
          : weekdayFormatter.format(new Date(first.timestamp));
      const subhead = dayFormatter.format(new Date(first.timestamp));
      out.push({ key: k, heading, subhead, items: list });
    }
    return out;
  });
</script>

<section class="activity-stream" aria-labelledby="activity-stream-heading">
  <header class="stream-header">
    <span class="stream-eyebrow">Stream</span>
    <h2 id="activity-stream-heading" class="stream-title">Recent activity</h2>
  </header>

  {#if loading}
    <div class="stream-skeleton" aria-hidden="true">
      {#each Array(3) as _, i (i)}
        <div class="skel-row">
          <div class="skel-dot"></div>
          <div class="skel-block"></div>
        </div>
      {/each}
    </div>
  {:else if activities.length === 0}
    <p class="stream-empty">
      No activity yet. When people purchase or join, you'll see them here first.
    </p>
  {:else}
    <ol class="stream" aria-live="polite">
      {#each groups as group (group.key)}
        <li class="day-group">
          <header class="day-header">
            <span class="day-heading">{group.heading}</span>
            <span class="day-subhead" aria-hidden="true">{group.subhead}</span>
          </header>
          <ol class="day-items">
            {#each group.items as item (item.id)}
              {@const meta = typeMeta[item.type]}
              <li class="event" data-tone={meta.tone}>
                <span class="event-dot" aria-hidden="true">
                  {#if item.type === 'purchase'}
                    <ShoppingBagIcon size={12} />
                  {:else if item.type === 'content_published'}
                    <DownloadIcon size={12} />
                  {:else}
                    <UserPlusIcon size={12} />
                  {/if}
                </span>
                <div class="event-body">
                  <div class="event-title-row">
                    <span class="event-verb">{meta.verb}</span>
                    <span class="event-title">{item.title}</span>
                  </div>
                  {#if item.description}
                    <p class="event-description">{item.description}</p>
                  {/if}
                </div>
                <time class="event-time" datetime={item.timestamp}>
                  {timeFormatter.format(new Date(item.timestamp))}
                </time>
              </li>
            {/each}
          </ol>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .activity-stream {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Header ──────────────────────────────────────────────── */
  .stream-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .stream-eyebrow {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .stream-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  /* ── Empty + skeleton ────────────────────────────────────── */
  .stream-empty {
    margin: 0;
    padding: var(--space-6) 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .stream-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .skel-row {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: center;
  }

  .skel-dot,
  .skel-block {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1500ms linear infinite;
    border-radius: var(--radius-md);
  }

  .skel-dot {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full, 9999px);
  }

  .skel-block {
    height: var(--space-10);
  }

  @media (prefers-reduced-motion: reduce) {
    .skel-dot,
    .skel-block { animation: none; }
  }

  /* ── Stream ──────────────────────────────────────────────── */
  .stream {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .day-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .day-header {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .day-heading {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .day-subhead {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .day-items {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Vertical rule threading the event dots — continuous timeline feel */
  .day-items::before {
    content: '';
    position: absolute;
    left: calc(var(--space-3) - var(--border-width-thick) / 2);
    top: var(--space-3);
    bottom: var(--space-3);
    width: var(--border-width);
    background: linear-gradient(
      to bottom,
      var(--color-border),
      color-mix(in srgb, var(--color-border) 30%, transparent)
    );
  }

  /* ── Event row ───────────────────────────────────────────── */
  .event {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-3);
    position: relative;
  }

  .event-dot {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full, 9999px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--border-width-thick) var(--border-style) var(--color-surface);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    /* pull the dot above the vertical rule */
    position: relative;
    z-index: 1;
    box-shadow: 0 0 0 var(--border-width) var(--color-border);
  }

  .event[data-tone='purchase'] .event-dot {
    background-color: color-mix(in srgb, var(--color-success-500) 14%, var(--color-surface));
    color: var(--color-success-700);
    box-shadow: 0 0 0 var(--border-width)
      color-mix(in srgb, var(--color-success-500) 35%, transparent);
  }

  .event[data-tone='publish'] .event-dot {
    background-color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 14%, var(--color-surface));
    color: var(--color-brand-primary, var(--color-interactive));
    box-shadow: 0 0 0 var(--border-width)
      color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 35%, transparent);
  }

  .event-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    padding-top: var(--space-0-5);
  }

  .event-title-row {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .event-verb {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .event[data-tone='purchase'] .event-verb { color: var(--color-success-700); }
  .event[data-tone='publish'] .event-verb { color: var(--color-brand-primary, var(--color-interactive)); }

  .event-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .event-description {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .event-time {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    padding-top: var(--space-0-5);
    white-space: nowrap;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
