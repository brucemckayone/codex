<script lang="ts">
  /**
   * About page - platform information
   */
</script>

<svelte:head>
  <title>About - Codex</title>
  <meta name="description" content="Learn about Codex, the platform for independent creators to share premium content." />
  <meta property="og:title" content="About - Codex" />
  <meta property="og:description" content="Learn about Codex, the platform for independent creators." />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="about">
  <section class="about-hero">
    <h1>About Codex</h1>
    <p class="lead">Empowering independent creators to share premium content with the world.</p>
  </section>

  <section class="about-section">
    <h2>Our Mission</h2>
    <p>Codex provides a modern platform for creators and organizations to distribute high-quality video content. We handle the infrastructure so creators can focus on what they do best.</p>
  </section>

  <section class="about-section">
    <h2>For Creators</h2>
    <p>Upload, organize, and monetize your content. Set up your organization, invite team members, and build your audience with powerful tools and analytics.</p>
  </section>

  <section class="about-section">
    <h2>For Learners</h2>
    <p>Discover content from creators you trust. Track your progress, build your library, and learn at your own pace with adaptive streaming.</p>
  </section>

  <section class="about-cta">
    <a href="/register" class="cta">Get Started</a>
  </section>
</div>

<style>
  .about {
    padding: var(--space-8) 0;
    max-width: 48rem;
    margin: 0 auto;
  }

  .about-hero {
    text-align: center;
    padding: var(--space-12) 0;
    margin-bottom: var(--space-8);
  }

  .about-hero h1 {
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
    line-height: var(--leading-relaxed);
  }

  .about-section {
    margin-bottom: var(--space-10);
  }

  .about-section h2 {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-3);
  }

  .about-section p {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .about-cta {
    text-align: center;
    padding: var(--space-8) 0;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-3) var(--space-6);
    background-color: var(--color-primary-500);
    color: white;
    border-radius: var(--radius-lg);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    transition: var(--transition-colors);
    text-decoration: none;
  }

  .cta:hover {
    background-color: var(--color-primary-600);
  }
</style>
