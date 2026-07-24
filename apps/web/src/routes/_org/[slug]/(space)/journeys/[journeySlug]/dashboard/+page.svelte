<!--
  @component JourneyDashboardShell

  The member journey portal (SPEC §8.3). This is the WP-3 STRUCTURAL shell: a
  client-rendered placeholder that establishes the route so the post-purchase
  funnel resolves. The real dashboard — the `canEnterCourse` gate, the playlist
  rail + working pane + map-with-progress, resume, and `progressCollection`
  wiring — lands in WP-4 (flagged in `+page.ts`).
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildJourneyUrl } from '@codex/urls';

  const journeySlug = $derived(page.params.journeySlug ?? '');

  const salesUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: journeySlug, id: journeySlug },
      { surface: 'sales' }
    )
  );
</script>

<svelte:head>
  <title>Your journey</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="dashboard">
  <div class="dashboard__inner">
    <p class="dashboard__eyebrow">Your journey</p>
    <h1 class="dashboard__title">This is where the work lives.</h1>
    <p class="dashboard__body">
      Once you've joined, your practices, progress and the descent map appear
      here. The full member dashboard is on its way.
    </p>
    <a class="dashboard__link" href={salesUrl}>View the journey →</a>
  </div>
</section>

<style>
  .dashboard {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .dashboard__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 40rem;
    margin-inline: auto;
    text-align: center;
  }

  .dashboard__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .dashboard__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    color: var(--color-heading);
    text-wrap: balance;
  }

  .dashboard__body {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .dashboard__link {
    align-self: center;
    margin-top: var(--space-2);
    font-weight: var(--font-semibold);
    color: var(--color-brand-primary);
    text-decoration: none;
  }

  .dashboard__link:hover {
    text-decoration: underline;
  }
</style>
