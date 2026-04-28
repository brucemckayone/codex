<!--
  @component TeamManagement

  Team management page for organization admins/owners.
  Displays a table of members with role management and invite functionality.
  Uses command() remote functions for invite, role change, and remove actions.

  @prop {PageData} data - Org info and userRole from parent studio layout
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import MemberTable from '$lib/components/studio/MemberTable.svelte';
  import InviteMemberDialog from '$lib/components/studio/InviteMemberDialog.svelte';
  import { PageHeader } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { UserPlusIcon } from '$lib/components/ui/Icon';
  import {
    getOrgMembers,
    inviteMember,
    updateMemberRole,
    removeMember,
  } from '$lib/remote/org.remote';

  let { data } = $props();

  let inviteDialogOpen = $state(false);

  // Role guard: admin/owner only
  $effect(() => {
    if (data.userRole !== 'admin' && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');

  const membersQuery = $derived(
    isAuthorized ? getOrgMembers({ orgId: data.org.id, limit: 50 }) : null
  );

  async function handleInvite(email: string, role: string) {
    await inviteMember({
      orgId: data.org.id,
      email,
      role: role as 'admin' | 'creator' | 'member',
    });
    membersQuery?.refresh();
  }

  async function handleChangeRole(userId: string, role: string) {
    await updateMemberRole({
      orgId: data.org.id,
      userId,
      role: role as 'owner' | 'admin' | 'creator' | 'member',
    });
    membersQuery?.refresh();
  }

  async function handleRemove(userId: string) {
    await removeMember({
      orgId: data.org.id,
      userId,
    });
    membersQuery?.refresh();
  }
</script>

<svelte:head>
  <title>{m.team_title()} | {data.org.name}</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirecting... -->
{:else}
<div class="team-page">
  <PageHeader title={m.team_title()}>
    {#snippet actions()}
      <button class="btn btn-primary" onclick={() => (inviteDialogOpen = true)}>
        <UserPlusIcon size={16} />
        {m.team_invite()}
      </button>
    {/snippet}
  </PageHeader>

  <section class="members-section">
    {#if membersQuery?.loading}
      <div class="table-skeleton">
        <Skeleton class="table-skeleton-header" width="100%" height="var(--space-10)" />
        {#each Array(5) as _, i}
          <div class="table-skeleton-row">
            <Skeleton width="{30 + (i % 3) * 8}%" height="var(--space-5)" />
            <Skeleton width="30%" height="var(--space-5)" />
            <Skeleton width="15%" height="var(--space-5)" />
            <Skeleton width="10%" height="var(--space-5)" />
          </div>
        {/each}
      </div>
    {:else}
      <MemberTable
        members={(membersQuery?.current?.items ?? []).filter((m) => m.role !== 'subscriber')}
        onChangeRole={handleChangeRole}
        onRemove={handleRemove}
      />
    {/if}
  </section>

  {#if browser}
    <InviteMemberDialog
      bind:open={inviteDialogOpen}
      onInvite={handleInvite}
    />
  {/if}
</div>
{/if}

<style>
  .team-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }
  .members-section {
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    overflow: hidden;
  }

  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* Scoped via parent — class is applied to the inner Skeleton
     component's root element via its class prop. */
  .table-skeleton :global(.table-skeleton-header) {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .table-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    border: none;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
  }

  .btn:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .btn-primary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

</style>
