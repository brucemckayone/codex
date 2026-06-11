<!--
  @component CreatorEarningsError
  Fallback error page for the creator earnings hub.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
</script>

<div class="error-state">
  <h1 class="error-state__title">{m.studio_error_title()}</h1>
  <p class="error-state__description">{page.error?.message ?? m.studio_error_description()}</p>
  <a href="/studio" class="error-state__link">{m.studio_error_back_to_org()}</a>
</div>

<style>
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-12) var(--space-6);
    text-align: center;
  }

  .error-state__title {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .error-state__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .error-state__link {
    font-size: var(--text-sm);
    color: var(--color-primary-600);
    text-decoration: none;
  }

  .error-state__link:hover {
    text-decoration: underline;
  }
</style>
