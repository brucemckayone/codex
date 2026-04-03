<!--
  @component TeamManagement

  Team management page for organization admins/owners.
  Displays a table of members with role management and invite functionality.
  Uses command() remote functions for invite, role change, and remove actions.

  @prop {PageData} data - Server-loaded member data + org info from parent
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import MemberTable from '$lib/components/studio/MemberTable.svelte';
  import InviteMemberDialog from '$lib/components/studio/InviteMemberDialog.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { UserPlusIcon } from '$lib/components/ui/Icon';
  import {
    inviteMember,
    updateMemberRole,
    removeMember,
  } from '$lib/remote/org.remote';

  let { data } = $props();

  let inviteDialogOpen = $state(false);

  async function handleInvite(email: string, role: string) {
    await inviteMember({
      orgId: data.org.id,
      email,
      role: role as 'admin' | 'creator' | 'member',
    });
    // Refresh member list after invite
    await invalidateAll();
  }

  async function handleChangeRole(userId: string, role: string) {
    await updateMemberRole({
      orgId: data.org.id,
      userId,
      role: role as 'owner' | 'admin' | 'creator' | 'member',
    });
    // Refresh member list after role change
    await invalidateAll();
  }

  async function handleRemove(userId: string) {
    await removeMember({
      orgId: data.org.id,
      userId,
    });
    // Refresh member list after removal
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.team_title()} | {data.org.name}</title>
</svelte:head>

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
    <MemberTable
      members={data.members ?? []}
      onChangeRole={handleChangeRole}
      onRemove={handleRemove}
    />
  </section>

  {#if browser}
    <InviteMemberDialog
      bind:open={inviteDialogOpen}
      onInvite={handleInvite}
    />
  {/if}
</div>

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
    outline-offset: 2px;
  }

</style>
