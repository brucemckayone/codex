<script lang="ts">
  /**
   * Pricing page - plans and pricing information
   */
  import * as m from '$paraglide/messages';
  import { Card } from '$lib/components/ui';
</script>

<svelte:head>
  <title>Pricing - Codex</title>
  <meta name="description" content="Explore Codex pricing plans for creators and learners." />
  <meta property="og:title" content="Pricing - Codex" />
  <meta property="og:description" content="Explore Codex pricing plans for creators and learners." />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Pricing - Codex" />
  <meta name="twitter:description" content="Explore Codex pricing plans for creators and learners." />
</svelte:head>

<div class="pricing">
  <section class="pricing-hero">
    <h1>{m.pricing_title()}</h1>
    <p class="lead">{m.pricing_subtitle()}</p>
  </section>

  <div class="plans-grid">
    <Card.Root class="plan-card">
      <Card.Header class="plan-header">
        <Card.Title level={2} class="plan-name">{m.pricing_plan_free()}</Card.Title>
        <p class="plan-price"><span class="price-amount">{m.pricing_plan_free_price()}</span><span class="price-period">{m.pricing_plan_period()}</span></p>
      </Card.Header>
      <Card.Content class="plan-body">
        <ul class="plan-features">
          <li>{m.pricing_plan_free_feature_1()}</li>
          <li>{m.pricing_plan_free_feature_2()}</li>
          <li>{m.pricing_plan_free_feature_3()}</li>
        </ul>
      </Card.Content>
      <Card.Footer class="plan-footer">
        <a href="/register" class="plan-cta plan-cta-secondary">{m.pricing_plan_free_cta()}</a>
      </Card.Footer>
    </Card.Root>

    <Card.Root class="plan-card plan-featured">
      <Card.Header class="plan-header">
        <Card.Title level={2} class="plan-name">{m.pricing_plan_creator()}</Card.Title>
        <p class="plan-price"><span class="price-amount">{m.pricing_plan_creator_price()}</span><span class="price-period">{m.pricing_plan_period()}</span></p>
      </Card.Header>
      <Card.Content class="plan-body">
        <ul class="plan-features">
          <li>{m.pricing_plan_creator_feature_1()}</li>
          <li>{m.pricing_plan_creator_feature_2()}</li>
          <li>{m.pricing_plan_creator_feature_3()}</li>
          <li>{m.pricing_plan_creator_feature_4()}</li>
          <li>{m.pricing_plan_creator_feature_5()}</li>
        </ul>
      </Card.Content>
      <Card.Footer class="plan-footer">
        <a href="/register" class="plan-cta plan-cta-primary">{m.pricing_plan_creator_cta()}</a>
      </Card.Footer>
    </Card.Root>

    <Card.Root class="plan-card">
      <Card.Header class="plan-header">
        <Card.Title level={2} class="plan-name">{m.pricing_plan_enterprise()}</Card.Title>
        <p class="plan-price"><span class="price-amount">{m.pricing_plan_enterprise_price()}</span></p>
      </Card.Header>
      <Card.Content class="plan-body">
        <ul class="plan-features">
          <li>{m.pricing_plan_enterprise_feature_1()}</li>
          <li>{m.pricing_plan_enterprise_feature_2()}</li>
          <li>{m.pricing_plan_enterprise_feature_3()}</li>
          <li>{m.pricing_plan_enterprise_feature_4()}</li>
          <li>{m.pricing_plan_enterprise_feature_5()}</li>
        </ul>
      </Card.Content>
      <Card.Footer class="plan-footer">
        <a href="/about" class="plan-cta plan-cta-secondary">{m.pricing_plan_enterprise_cta()}</a>
      </Card.Footer>
    </Card.Root>
  </div>
</div>

<style>
  .pricing {
    padding: var(--space-8) 0;
  }

  .pricing-hero {
    text-align: center;
    padding: var(--space-12) 0;
    margin-bottom: var(--space-8);
  }

  .pricing-hero h1 {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-4);
  }

  .lead {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
  }

  .plans-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
    max-width: 64rem;
    margin: 0 auto;
  }

  @media (--breakpoint-md) {
    .plans-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  :global(.plan-card) {
    text-align: center;
  }

  :global(.plan-featured) {
    border-color: var(--color-brand-accent);
    box-shadow: var(--shadow-lg);
  }

  :global(.plan-header) {
    align-items: center;
  }

  :global(.plan-body) {
    flex: 1;
  }

  :global(.plan-footer) {
    justify-content: center;
  }

  :global(.plan-name) {
    font-size: var(--text-xl);
  }

  .plan-price {
    margin-bottom: var(--space-6);
  }

  .price-amount {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .price-period {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .plan-features {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-8);
    width: 100%;
  }

  .plan-features li {
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .plan-features li:last-child {
    border-bottom: none;
  }

  .plan-cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    transition: var(--transition-colors);
    text-decoration: none;
    margin-top: auto;
  }

  .plan-cta-primary {
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  .plan-cta-primary:hover {
    background-color: var(--color-interactive-hover);
  }

  .plan-cta-secondary {
    background-color: transparent;
    color: var(--color-interactive);
    border: var(--border-width) var(--border-style) var(--color-interactive);
  }

  .plan-cta-secondary:hover {
    background-color: var(--color-interactive-subtle);
  }
</style>
