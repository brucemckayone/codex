<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ErrorCard } from '$lib/components/ui/ErrorCard';
</script>

<ErrorCard
  detail={page.error?.message}
  titleSuffix="Creator"
>
  {#snippet actions()}
    <a href="/discover" class="error-btn error-btn--primary">{m.errors_browse_discover()}</a>
    {#if page.status === 401 || page.status === 403}
      <a href="/login" class="error-btn error-btn--secondary">{m.errors_login()}</a>
    {:else}
      <button class="error-btn error-btn--secondary" onclick={() => history.back()}>
        {m.org_error_go_back()}
      </button>
    {/if}
  {/snippet}
</ErrorCard>
