<script lang="ts">
  /**
   * Platform landing page - codex main domain
   */
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
    <h1 class="hero-title">Transform Your Content Journey</h1>
    <p class="tagline">Discover and stream premium content from independent creators and organizations.</p>
    <div class="cta-group">
      <a href="/discover" class="cta cta-primary">Explore Content</a>
      <a href="/register" class="cta cta-secondary">Join Free</a>
    </div>
  </section>

  <section class="features">
    <h2 class="features-title">Why Codex?</h2>
    <div class="feature-grid">
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <h3>Curated Content</h3>
        <p>Premium content from verified creators, organized by topic and skill level.</p>
      </div>
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 2v5" />
            <path d="M8 2v5" />
            <path d="M2 12h20" />
          </svg>
        </div>
        <h3>Organization Spaces</h3>
        <p>Browse complete content libraries from your favorite organizations.</p>
      </div>
      <div class="feature">
        <div class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h3>Creator Profiles</h3>
        <p>Follow creators across multiple organizations and track your progress.</p>
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
    background-color: var(--color-primary-500);
    color: white;
  }

  .cta-primary:hover {
    background-color: var(--color-primary-600);
  }

  .cta-secondary {
    background-color: transparent;
    color: var(--color-primary-500);
    border: var(--border-width) var(--border-style) var(--color-primary-500);
  }

  .cta-secondary:hover {
    background-color: var(--color-primary-50);
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

  @media (min-width: 768px) {
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
    width: 3rem;
    height: 3rem;
    margin: 0 auto var(--space-4);
    color: var(--color-primary-500);
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
