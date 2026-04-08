<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ErrorCard } from '$lib/components/ui/ErrorCard';
  import { Button } from '$lib/components/ui';
</script>

<ErrorCard detail={page.error?.message}>
  {#snippet actions()}
    <a href="/discover" class="error-btn error-btn--primary">{m.errors_go_home()}</a>
    {#if page.status === 404}
      <Button variant="secondary" onclick={() => history.back()}>{m.errors_go_back()}</Button>
    {:else if page.status === 403}
      <a href="/login" class="error-btn error-btn--secondary">{m.errors_sign_in()}</a>
    {:else if page.status === 500}
      <Button variant="secondary" onclick={() => location.reload()}>{m.errors_try_again()}</Button>
    {/if}
  {/snippet}
</ErrorCard>
