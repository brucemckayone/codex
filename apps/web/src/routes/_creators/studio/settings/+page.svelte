<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ProfileForm from '$lib/components/ProfileForm.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Settings | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Profile Settings" description="Manage your creator profile and social links" />

<ProfileForm profile={data.profile} />
