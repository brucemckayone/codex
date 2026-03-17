<script lang="ts">
  import { page } from '$app/stores';
  import { AccountErrorPage } from '$lib/components/ui/AccountErrorPage';
</script>

<AccountErrorPage status={$page.status} returnHref="/account/notifications" pageTitle="Notifications" />
