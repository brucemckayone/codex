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
  <header class="page-header">
    <div class="header-content">
      <h1 class="page-title">{m.team_title()}</h1>
    </div>
    <button class="btn btn-primary" onclick={() => (inviteDialogOpen = true)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <line x1="19" y1="8" x2="19" y2="14"></line>
        <line x1="22" y1="11" x2="16" y2="11"></line>
      </svg>
      {m.team_invite()}
    </button>
  </header>

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

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
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
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-primary-500);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .members-section {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }
</style>
