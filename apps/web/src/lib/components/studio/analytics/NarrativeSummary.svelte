<!--
  @component NarrativeSummary

  Prose "at-a-glance" block for the studio analytics page. Given the four
  analytics responses (revenue, subscribers, followers, content-performance),
  renders 1–3 short encouraging sentences summarising what changed vs the
  compare window.

  Template-based prose — no LLM call. Picks the most significant sentences
  by magnitude of signed % change (floored at ±10% to avoid noise). Voice is
  warm-but-specific; wins celebrated, challenges framed constructively.

  @prop {RevenueStats} revenue            Revenue block with optional `previous`.
  @prop {SubscriberStats} subscribers     Subscriber block with optional `previous`.
  @prop {FollowerStats} followers         Follower block with optional `previous`.
  @prop {TopContentItem[]} [topContent]   Top-content rows (revenue-ranked).
  @prop {ContentPerformanceItem[]} [topPerformance]  Per-content engagement rows.
  @prop {boolean} hasCompareWindow        True when both compareFrom/compareTo are set.
  @prop {boolean} [loading]               Shimmer skeleton state.
-->
<script lang="ts">
  import type {
    ContentPerformanceItem,
    FollowerStats,
    RevenueStats,
    SubscriberStats,
    TopContentItem,
  } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { formatPriceCompact } from '$lib/utils/format';

  interface Props {
    revenue: RevenueStats;
    subscribers: SubscriberStats;
    followers: FollowerStats;
    topContent?: TopContentItem[];
    topPerformance?: ContentPerformanceItem[];
    hasCompareWindow: boolean;
    loading?: boolean;
  }

  const {
    revenue,
    subscribers,
    followers,
    topContent,
    topPerformance,
    hasCompareWindow,
    loading = false,
  }: Props = $props();

  // ─── Thresholds ────────────────────────────────────────────────────────
  // Signed-percent magnitudes below this are treated as "flat" — avoids
  // inflating noise into narrative sentences.
  const FLAT_THRESHOLD = 10;
  // Above this, revenue gets the "big win / big loss" framing.
  const BIG_THRESHOLD = 20;

  // A sentence candidate for the priority picker. `score` is the absolute
  // signed % change used to rank competing second/third sentences.
  type Sentence =
    | { kind: 'text'; text: string; score: number }
    | {
        kind: 'rich';
        prefix: string;
        emphasis: string;
        suffix: string;
        score: number;
      };

  // ─── Helpers ───────────────────────────────────────────────────────────
  function pctChange(current: number, previous: number): number {
    if (previous === 0 || !Number.isFinite(previous)) return 0;
    return Math.round(((current - previous) / Math.abs(previous)) * 100);
  }

  // ─── Revenue sentence ─────────────────────────────────────────────────
  const revenueSentence = $derived.by<Sentence | null>(() => {
    if (!hasCompareWindow) return null;
    const prev = revenue.previous;
    if (!prev) return null;

    const curr = revenue.totalRevenueCents;
    const prevVal = prev.totalRevenueCents;

    // First-revenue celebration — org just made its first money in a compare window.
    if (prevVal === 0 && curr > 0) {
      return {
        kind: 'text',
        text: m.analytics_narrative_revenue_first({
          amount: formatPriceCompact(curr),
        }),
        score: 100,
      };
    }

    if (prevVal === 0) return null;

    const percent = pctChange(curr, prevVal);
    const amount = formatPriceCompact(curr);
    const absPercent = Math.abs(percent);
    const percentStr = String(absPercent);

    let text: string;
    if (percent >= BIG_THRESHOLD) {
      text = m.analytics_narrative_revenue_big_win({
        percent: percentStr,
        amount,
      });
    } else if (percent > 0) {
      text = m.analytics_narrative_revenue_win({ percent: percentStr, amount });
    } else if (absPercent < FLAT_THRESHOLD) {
      text = m.analytics_narrative_revenue_flat({ amount });
    } else if (percent > -BIG_THRESHOLD) {
      text = m.analytics_narrative_revenue_loss({
        percent: percentStr,
        amount,
      });
    } else {
      text = m.analytics_narrative_revenue_big_loss({
        percent: percentStr,
        amount,
      });
    }

    return { kind: 'text', text, score: absPercent };
  });

  // ─── Subscriber sentence ─────────────────────────────────────────────
  const subscriberSentence = $derived.by<Sentence | null>(() => {
    if (!hasCompareWindow) return null;
    const prev = subscribers.previous;
    if (!prev) return null;

    const curr = subscribers.newSubscribers;
    const prevVal = prev.newSubscribers;
    if (curr === 0 && prevVal === 0) return null;

    // Near-doubling → celebratory "almost Nx" framing. Avoids div-by-zero on prev=0.
    if (prevVal > 0 && curr >= prevVal * 1.8) {
      const multiplier = (curr / prevVal).toFixed(1).replace(/\.0$/, '');
      return {
        kind: 'text',
        text: m.analytics_narrative_subscribers_big_win({
          count: String(curr),
          multiplier,
        }),
        // Cap noise: huge multipliers shouldn't completely dominate ranking.
        score: Math.min(200, pctChange(curr, prevVal) || 200),
      };
    }

    const percent = pctChange(curr, prevVal);
    const absPercent = Math.abs(percent);
    if (absPercent < FLAT_THRESHOLD) return null;

    const percentStr = String(absPercent);
    const text =
      percent > 0
        ? m.analytics_narrative_subscribers_win({
            count: String(curr),
            percent: percentStr,
          })
        : m.analytics_narrative_subscribers_loss({
            count: String(curr),
            percent: percentStr,
          });

    return { kind: 'text', text, score: absPercent };
  });

  // ─── Follower sentence ───────────────────────────────────────────────
  const followerSentence = $derived.by<Sentence | null>(() => {
    if (!hasCompareWindow) return null;
    const prev = followers.previous;
    if (!prev) return null;

    const curr = followers.newFollowers;
    const prevVal = prev.newFollowers;
    if (curr === 0 && prevVal === 0) return null;
    if (prevVal === 0) return null;

    const percent = pctChange(curr, prevVal);
    const absPercent = Math.abs(percent);
    if (absPercent < FLAT_THRESHOLD) return null;

    const percentStr = String(absPercent);
    const text =
      percent > 0
        ? m.analytics_narrative_followers_win({ percent: percentStr })
        : m.analytics_narrative_followers_loss({ percent: percentStr });

    return { kind: 'text', text, score: absPercent };
  });

  // ─── Top performer (revenue leader) ──────────────────────────────────
  const topPerformerSentence = $derived.by<Sentence | null>(() => {
    const top = topContent?.[0];
    if (!top || top.revenueCents <= 0) return null;

    return {
      kind: 'rich',
      prefix: '',
      emphasis: top.contentTitle,
      suffix: `, pulling in ${formatPriceCompact(top.revenueCents)}.`,
      score: 50, // Floor score so it can compete but not crowd bigger % moves.
    };
  });

  // The default paraglide template for top performer — used when we go the
  // "text" route. We don't actually use this; rich version gives us <em>.
  // Keeping the key in messages for i18n completeness.

  // ─── Rising star (content-performance trend delta) ───────────────────
  const risingStarSentence = $derived.by<Sentence | null>(() => {
    if (!hasCompareWindow) return null;
    const rows = topPerformance ?? [];
    // Find the row with the largest positive trendDelta in watch-time.
    let best: ContentPerformanceItem | null = null;
    for (const row of rows) {
      if (row.trendDelta == null || row.trendDelta <= 0) continue;
      if (!best || row.trendDelta > (best.trendDelta ?? 0)) best = row;
    }
    if (!best) return null;

    // Require a meaningful jump — at least 50% of current watch-time.
    const curr = best.totalWatchTimeSeconds;
    const delta = best.trendDelta ?? 0;
    if (curr <= 0 || delta < curr * 0.5) return null;

    return {
      kind: 'rich',
      prefix: '',
      emphasis: best.title,
      suffix: ' is on the rise — watch time up meaningfully vs last period.',
      score: Math.round((delta / Math.max(1, curr)) * 100),
    };
  });

  // ─── Zero-data detection ────────────────────────────────────────────
  // An org with no revenue, subscribers, followers, and no top content is
  // genuinely brand-new. Render a friendly placeholder instead of silence.
  const hasAnyData = $derived(
    revenue.totalRevenueCents > 0 ||
      subscribers.activeSubscribers > 0 ||
      subscribers.newSubscribers > 0 ||
      followers.totalFollowers > 0 ||
      (topContent?.length ?? 0) > 0
  );

  // ─── Sentence selection ──────────────────────────────────────────────
  const selectedSentences = $derived.by<Sentence[]>(() => {
    if (!hasAnyData) {
      return [
        {
          kind: 'text',
          text: m.analytics_narrative_no_data(),
          score: 0,
        },
      ];
    }

    if (!hasCompareWindow) {
      return [
        {
          kind: 'text',
          text: m.analytics_narrative_no_compare(),
          score: 0,
        },
      ];
    }

    const out: Sentence[] = [];

    // 1. Revenue sentence first — always render if we have a comparable figure.
    if (revenueSentence) out.push(revenueSentence);

    // 2. Second sentence — highest-scoring of sub / follower / top performer.
    const secondCandidates: Sentence[] = [];
    if (subscriberSentence) secondCandidates.push(subscriberSentence);
    if (followerSentence) secondCandidates.push(followerSentence);
    if (topPerformerSentence) secondCandidates.push(topPerformerSentence);
    secondCandidates.sort((a, b) => b.score - a.score);
    if (secondCandidates[0]) out.push(secondCandidates[0]);

    // 3. Third sentence — only if genuinely newsworthy (rising-star content).
    if (risingStarSentence) out.push(risingStarSentence);

    // Guarantee something renders if we have data but nothing newsworthy yet.
    if (out.length === 0) {
      out.push({
        kind: 'text',
        text: m.analytics_narrative_no_compare(),
        score: 0,
      });
    }

    return out.slice(0, 3);
  });
</script>

<section
  class="narrative-summary"
  aria-label={m.analytics_narrative_aria_label()}
  data-loading={loading ? 'true' : 'false'}
  aria-busy={loading}
  aria-live={loading ? 'polite' : undefined}
>
  {#if loading}
    <span class="sr-only">{m.analytics_narrative_loading_label()}</span>
    <div class="narrative-summary__skeleton" aria-hidden="true"></div>
    <div class="narrative-summary__skeleton narrative-summary__skeleton--short" aria-hidden="true"></div>
    <div class="narrative-summary__skeleton" aria-hidden="true"></div>
  {:else}
    {#each selectedSentences as sentence, i (i)}
      <p class="narrative-summary__line">
        {#if sentence.kind === 'rich'}
          {#if sentence.prefix}{sentence.prefix}{/if}<em class="narrative-summary__emphasis">{sentence.emphasis}</em>{sentence.suffix}
        {:else}
          {sentence.text}
        {/if}
      </p>
    {/each}
  {/if}
</section>

<style>
  .narrative-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-6);
    background-color: var(--color-surface-card);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .narrative-summary__line {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  /* First line carries the headline revenue sentence — lift it visually
     without shouting. Kept to body-copy scale so the block reads as prose,
     not a KPI tile. */
  .narrative-summary__line:first-of-type {
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .narrative-summary__emphasis {
    font-style: normal;
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* Skeleton — three lines matching the loaded layout so the swap doesn't
     introduce CLS (ref 03 §9 Skeleton Contract). */
  .narrative-summary__skeleton {
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
    height: var(--text-base);
    width: 100%;
    animation: narrative-summary-pulse 1.5s ease-in-out infinite;
  }

  .narrative-summary__skeleton--short {
    width: 75%;
  }

  @keyframes narrative-summary-pulse {
    0%,
    100% {
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  /* Infinite-iteration animations bypass token-level duration collapse;
     neutralise explicitly for vestibular safety (ref 04 §3). */
  @media (prefers-reduced-motion: reduce) {
    .narrative-summary__skeleton {
      animation: none;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
