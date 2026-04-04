<script lang="ts">
  /**
   * Platform landing page - codex main domain
   */
  import * as m from '$paraglide/messages';
  import { ClockIcon, CalendarIcon, UserIcon } from '$lib/components/ui/Icon';
</script>

<svelte:head>
  <title>Codex - Transform Your Content Journey</title>
  <meta name="description" content="Discover transformative content from independent creators. Stream premium video courses, tutorials, and educational content." />
  <meta property="og:title" content="Codex - Transform Your Content Journey" />
  <meta property="og:description" content="Discover transformative content from independent creators." />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Codex - Transform Your Content Journey" />
  <meta name="twitter:description" content="Discover transformative content from independent creators." />
</svelte:head>

<div class="landing">
  <section class="hero">
    <h1 class="hero-title">{m.landing_hero_title()}</h1>
    <p class="tagline">{m.landing_hero_tagline()}</p>
    <div class="cta-group">
      <a href="/discover" class="cta cta-primary">{m.landing_hero_explore()}</a>
      <a href="/register" class="cta cta-secondary">{m.landing_hero_join()}</a>
    </div>
  </section>

  <section class="features">
    <h2 class="features-title">{m.landing_features_title()}</h2>
    <div class="feature-grid">
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <ClockIcon size={24} />
        </div>
        <h3>{m.landing_feature_curated_title()}</h3>
        <p>{m.landing_feature_curated_desc()}</p>
      </div>
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <CalendarIcon size={24} />
        </div>
        <h3>{m.landing_feature_org_title()}</h3>
        <p>{m.landing_feature_org_desc()}</p>
      </div>
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <UserIcon size={24} />
        </div>
        <h3>{m.landing_feature_creators_title()}</h3>
        <p>{m.landing_feature_creators_desc()}</p>
      </div>
    </div>
  </section>
</div>

<style>
  .landing {
    padding: var(--space-8) 0;
  }

  .hero {
    text-align: center;
    padding: var(--space-16) 0;
  }

  .hero-title {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-4);
  }

  .tagline {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 36rem;
    margin: 0 auto var(--space-8);
  }

  .cta-group {
    display: flex;
    gap: var(--space-4);
    justify-content: center;
    flex-wrap: wrap;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-lg);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    transition: var(--transition-colors);
    text-decoration: none;
  }

  .cta-primary {
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .cta-primary:hover {
    background-color: var(--color-interactive-hover);
  }

  .cta-secondary {
    background-color: transparent;
    color: var(--color-brand-accent);
    border: var(--border-width) var(--border-style) var(--color-brand-accent);
  }

  .cta-secondary:hover {
    background-color: var(--color-brand-accent-subtle);
  }

  .features {
    padding: var(--space-16) 0;
  }

  .features-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    text-align: center;
    margin-bottom: var(--space-10);
  }

  .feature-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-8);
  }

  @media (--breakpoint-md) {
    .feature-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .feature {
    text-align: center;
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .feature-icon {
    width: var(--space-12);
    height: var(--space-12);
    margin: 0 auto var(--space-4);
    color: var(--color-interactive);
  }

  .feature-icon svg {
    width: 100%;
    height: 100%;
  }

  .feature h3 {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .feature p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }
</style>
