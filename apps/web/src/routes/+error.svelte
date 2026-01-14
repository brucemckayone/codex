<script lang="ts">
  /**
   * Global error page
   */
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>Error | Revelations</title>
</svelte:head>

<div class="error-page">
  <div class="error-content">
    <h1 class="error-code">{$page.status}</h1>
    <p class="error-message">{$page.error?.message || 'Something went wrong'}</p>
    <a href="/" class="error-link">Return Home</a>
  </div>
</div>


