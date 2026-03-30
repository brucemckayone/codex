<script lang="ts">
  import { page } from '$app/state';
  import { AccountErrorPage } from '$lib/components/ui/AccountErrorPage';
</script>

<AccountErrorPage status={page.status} returnHref="/account/payment" pageTitle="Payments" />
