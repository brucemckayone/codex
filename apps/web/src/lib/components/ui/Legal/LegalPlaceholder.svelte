<script lang="ts">
  /**
   * Placeholder shell for the legal pages (`/terms`, `/privacy`).
   *
   * WHY THIS EXISTS AT ALL. The global Footer links `/terms` and `/privacy` on
   * every page (`ui/Layout/Footer.svelte:14-15`) and neither route existed, so
   * two of its three internal links 404'd platform-wide — on a product that
   * takes payments, where these are the pages a buyer looks for before paying.
   * Production logs for 2026-09-06T21:28Z→2026-09-07T11:43Z show 6 hits on
   * `/terms` and 4 on `/privacy`, all 404. This stops that.
   *
   * WHY IT SAYS "NOT YET PUBLISHED" RATHER THAN CARRYING TERMS. Placeholder
   * legal copy is worse than no page: a visitor cannot tell invented wording
   * from the real thing, and would reasonably rely on it. So this states
   * plainly that nothing here is binding yet. Replace the whole page — not just
   * the body — when the real wording lands; see the bead referenced in the
   * route files.
   */
  import * as m from '$paraglide/messages';

  interface Props {
    /** Page heading, e.g. "Terms of Service". */
    title: string;
    /** One-line summary of what the finished page will cover. */
    lead: string;
  }

  let { title, lead }: Props = $props();
</script>

<div class="legal">
  <header class="legal-hero">
    <h1>{title}</h1>
    <p class="lead">{lead}</p>
  </header>

  <section class="legal-notice" aria-labelledby="legal-notice-heading">
    <h2 id="legal-notice-heading">{m.legal_placeholder_heading()}</h2>
    <p>{m.legal_placeholder_body()}</p>
    <p>{m.legal_placeholder_contact()}</p>
  </section>

  <nav class="legal-nav">
    <a href="/">{m.legal_back_home()}</a>
  </nav>
</div>

<style>
  .legal {
    padding: var(--space-8) 0;
    max-width: 48rem;
    margin: 0 auto;
  }

  .legal-hero {
    padding: var(--space-12) 0 var(--space-8);
  }

  .legal-hero h1 {
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

  .legal-notice {
    /* Bordered rather than filled: this is a status note about the page, not a
       section of it, and a filled surface would read as content. */
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-10);
  }

  .legal-notice h2 {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-3);
  }

  .legal-notice p {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .legal-notice p + p {
    margin-top: var(--space-3);
  }

  .legal-nav a {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .legal-nav a:hover {
    color: var(--color-interactive-hover);
  }
</style>
