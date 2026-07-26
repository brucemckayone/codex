<!--
  @component PagePricingPanel

  The "Access & pricing" page-mode panel (Codex-2pryk.3.3 · WP-5). Presents the
  journey's ways-in — membership tiers, a course subscription, a one-off purchase —
  as independent toggles + price fields, written to `PageBuilderState.offer` via
  the store. Prices are GBP (£), stored in pence. NOTE: the AUTHORITATIVE access
  rule lives on the course/content policy (SPEC §6.1); this panel is the sales
  page's PRESENTATION of the offer.
-->
<script lang="ts">
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  const offer = $derived(pageBuilder.pending?.offer ?? {});

  const poundsOf = (cents: number | null | undefined): string =>
    cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

  function setPounds(key: 'subscriptionPriceCents' | 'oneOffPriceCents', value: string): void {
    const pounds = Number.parseFloat(value);
    pageBuilder.updateOffer({
      [key]: Number.isFinite(pounds) ? Math.round(pounds * 100) : null,
    });
  }
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">Access &amp; pricing</h2>
    <p class="panel__sub">The journey’s offer · one source of truth</p>
  </header>

  <p class="panel__callout">
    This is the <b>journey’s offer</b> — set once here, shown on the sales page and honoured
    wherever the course appears.
  </p>

  <p class="panel__group">Ways in · turn on any combination</p>

  <div class="way" class:way--on={offer.tiersEnabled}>
    <button
      type="button"
      class="way__sw"
      aria-pressed={!!offer.tiersEnabled}
      aria-label="Toggle membership tiers"
      onclick={() => pageBuilder.updateOffer({ tiersEnabled: !offer.tiersEnabled })}
    ></button>
    <span class="way__copy">Membership tiers<small>which tiers include this</small></span>
    <span class="way__price">included</span>
  </div>

  <div class="way" class:way--on={offer.subscriptionEnabled}>
    <button
      type="button"
      class="way__sw"
      aria-pressed={!!offer.subscriptionEnabled}
      aria-label="Toggle course subscription"
      onclick={() => pageBuilder.updateOffer({ subscriptionEnabled: !offer.subscriptionEnabled })}
    ></button>
    <span class="way__copy">Course subscription<small>a gentler monthly entry</small></span>
    <span class="way__price">
      £<input
        class="way__input"
        inputmode="decimal"
        value={poundsOf(offer.subscriptionPriceCents)}
        oninput={(e) => setPounds('subscriptionPriceCents', e.currentTarget.value)}
      />/mo
    </span>
  </div>

  <div class="way" class:way--on={offer.oneOffEnabled}>
    <button
      type="button"
      class="way__sw"
      aria-pressed={!!offer.oneOffEnabled}
      aria-label="Toggle one-off purchase"
      onclick={() => pageBuilder.updateOffer({ oneOffEnabled: !offer.oneOffEnabled })}
    ></button>
    <span class="way__copy">One-off purchase<small>buy outright</small></span>
    <span class="way__price">
      £<input
        class="way__input"
        inputmode="decimal"
        value={poundsOf(offer.oneOffPriceCents)}
        oninput={(e) => setPounds('oneOffPriceCents', e.currentTarget.value)}
      />
    </span>
  </div>

  <p class="panel__callout">
    <b>Membership</b> unlocks every journey — the buyer should feel it’s more than this one course.
  </p>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .panel__group {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .panel__callout {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
  }

  .panel__callout b {
    color: var(--color-text-secondary);
  }

  .way {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .way--on {
    border-color: color-mix(in oklab, var(--color-interactive) 40%, var(--color-border));
  }

  .way__sw {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-tertiary, var(--color-surface-secondary));
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .way__sw::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-default), background-color var(--duration-fast) var(--ease-default);
  }

  .way--on .way__sw {
    background-color: color-mix(in oklab, var(--color-interactive) 55%, var(--color-surface-secondary));
  }

  .way--on .way__sw::after {
    transform: translateX(14px);
    background-color: var(--color-interactive);
  }

  .way__sw:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .way__copy {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .way__copy small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .way__price {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .way__input {
    width: 3.4rem;
    padding: var(--space-1) var(--space-1-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: right;
  }

  .way__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
  }
</style>
