<script lang="ts">
  import type { LayoutUser, LayoutOrganization } from '$lib/types';
  import PlatformHeader from './PlatformHeader.svelte';
  import OrgHeader from './OrgHeader.svelte';
  import StudioHeader from './StudioHeader.svelte';

  interface Props {
    variant: 'platform' | 'org' | 'studio';
    user: LayoutUser | null;
    org?: LayoutOrganization;
    context?: 'personal' | 'org';
    orgs?: LayoutOrganization[];
  }

  const { variant, user, org, context = 'personal', orgs = [] }: Props = $props();
</script>

{#if variant === 'platform'}
  <PlatformHeader {user} />
{:else if variant === 'org' && org}
  <OrgHeader {user} {org} />
{:else if variant === 'studio'}
  <StudioHeader {user} {context} {org} {orgs} />
{/if}
