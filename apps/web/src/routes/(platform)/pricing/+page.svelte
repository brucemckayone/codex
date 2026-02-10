<script lang="ts">
  /**
   * Pricing page - plans and pricing information
   */
</script>

<svelte:head>
  <title>Pricing - Codex</title>
  <meta name="description" content="Explore Codex pricing plans for creators and learners." />
  <meta property="og:title" content="Pricing - Codex" />
  <meta property="og:description" content="Explore Codex pricing plans for creators and learners." />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="pricing">
  <section class="pricing-hero">
    <h1>Simple, Transparent Pricing</h1>
    <p class="lead">Pay only for what you need. No hidden fees.</p>
  </section>

  <div class="plans-grid">
    <div class="plan-card">
      <h2 class="plan-name">Free</h2>
      <p class="plan-price"><span class="price-amount">$0</span><span class="price-period">/month</span></p>
      <ul class="plan-features">
        <li>Access free content</li>
        <li>Track your progress</li>
        <li>Build your library</li>
      </ul>
      <a href="/register" class="plan-cta plan-cta-secondary">Get Started</a>
    </div>

    <div class="plan-card plan-featured">
      <h2 class="plan-name">Creator</h2>
      <p class="plan-price"><span class="price-amount">$19</span><span class="price-period">/month</span></p>
      <ul class="plan-features">
        <li>Create an organization</li>
        <li>Upload unlimited content</li>
        <li>Adaptive HLS streaming</li>
        <li>Analytics dashboard</li>
        <li>Custom branding</li>
      </ul>
      <a href="/register" class="plan-cta plan-cta-primary">Start Creating</a>
    </div>

    <div class="plan-card">
      <h2 class="plan-name">Enterprise</h2>
      <p class="plan-price"><span class="price-amount">Custom</span></p>
      <ul class="plan-features">
        <li>Everything in Creator</li>
        <li>Multiple organizations</li>
        <li>Priority support</li>
        <li>Custom integrations</li>
        <li>SLA guarantee</li>
      </ul>
      <a href="/about" class="plan-cta plan-cta-secondary">Contact Us</a>
    </div>
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

  @media (min-width: 768px) {
    .plans-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .plan-card {
    padding: var(--space-8);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .plan-featured {
    border-color: var(--color-primary-500);
    box-shadow: var(--shadow-lg);
  }

  .plan-name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-4);
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
    background-color: var(--color-primary-500);
    color: white;
  }

  .plan-cta-primary:hover {
    background-color: var(--color-primary-600);
  }

  .plan-cta-secondary {
    background-color: transparent;
    color: var(--color-primary-500);
    border: var(--border-width) var(--border-style) var(--color-primary-500);
  }

  .plan-cta-secondary:hover {
    background-color: var(--color-primary-50);
  }
</style>
