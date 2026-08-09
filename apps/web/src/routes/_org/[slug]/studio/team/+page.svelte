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
  import { Button, PageHeader } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { UserPlusIcon } from '$lib/components/ui/Icon';
  import {
    getOrgMembers,
    inviteMember,
    updateMemberRole,
    removeMember,
  } from '$lib/remote/org.remote';
  import { listActiveAgreements } from '$lib/remote/agreements.remote';
  import type { CreatorOrganizationAgreement } from '@codex/agreements';

  let { data } = $props();

  let inviteDialogOpen = $state(false);

  // Role guard: admin/owner only. Wait for data.userRole to populate —
  // ssr=false means first render has data.userRole === undefined.
  $effect(() => {
    if (
      data.userRole !== undefined &&
      data.userRole !== 'admin' &&
      data.userRole !== 'owner'
    ) {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');

  const membersQuery = $derived(
    isAuthorized ? getOrgMembers({ orgId: data.org.id, limit: 50 }) : null
  );

  // Subscribers are not team members — the table filters them out, so the
  // header count must too. Named `member` rather than `m` so it does not
  // shadow the paraglide namespace inside the callback.
  const teamMembers = $derived(
    (membersQuery?.current?.items ?? []).filter((member) => member.role !== 'subscriber')
  );

  // Revenue-share lives in the owner-only Monetisation hub, so the per-member
  // status column + entry point are owner-gated too (Codex-dhxjz).
  const isOwner = $derived(data.userRole === 'owner');

  const agreementsQuery = $derived(
    isOwner ? listActiveAgreements({ organizationId: data.org.id }) : null
  );

  // Map userId → compact active-agreement summary for the table column. Share
  // derives from the legacy org-fee column (10000 - fee, in basis points),
  // matching the revenue-share page. Both revenue types fold into one label,
  // e.g. "30% subs · 20% sales". Undefined when not owner → column hidden.
  const revenueShareByUser = $derived.by(() => {
    if (!isOwner) return undefined;
    const rows = (agreementsQuery?.current?.items ??
      []) as CreatorOrganizationAgreement[];
    const map = new Map<string, { label: string; active: boolean }>();
    for (const a of rows) {
      const sharePercent = (10000 - a.organizationFeePercentage) / 100;
      const part =
        a.revenueType === 'subscription'
          ? `${sharePercent}% subs`
          : `${sharePercent}% sales`;
      const existing = map.get(a.creatorId);
      map.set(a.creatorId, {
        active: true,
        label: existing ? `${existing.label} · ${part}` : part,
      });
    }
    return map;
  });

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
  <PageHeader
    kicker={m.studio_section_organisation()}
    title={m.team_title()}
    description={m.team_description()}
  >
    {#snippet meta()}
      {#if !membersQuery?.loading && teamMembers.length > 0}
        <!-- Labelled stat, not "{n} members": paraglide-js 1.x has no plural
             form (zero ICU plurals repo-wide), so an interpolated noun would
             read "1 members". Matches the customers header's shape. -->
        <li>{m.team_meta_members()}: {teamMembers.length}</li>
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if isOwner}
        <!-- Stays an <a>, not a Button: it is navigation to another hub, so
             middle-click and open-in-new-tab must keep working. `ui/Button`
             renders a <button> only, hence the one remaining local class. -->
        <a class="link-action" href="/studio/monetisation/revenue-share">
          Manage revenue share
        </a>
      {/if}
      <Button onclick={() => (inviteDialogOpen = true)}>
        <UserPlusIcon size={16} />
        {m.team_invite()}
      </Button>
    {/snippet}
  </PageHeader>

  <section class="members-section">
    {#if membersQuery?.loading}
      <div class="table-skeleton">
        <Skeleton class="table-skeleton-header" width="100%" height="var(--space-10)" />
        {#each Array(5) as _, i (i)}
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
        members={teamMembers}
        onChangeRole={handleChangeRole}
        onRemove={handleRemove}
        onInvite={() => (inviteDialogOpen = true)}
        {revenueShareByUser}
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

  /* The residue of a ~50-line hand-rolled button block that duplicated
     `ui/Button` (which Customers uses, and which supplies the focus ring and
     aria-busy). Only the anchor variant survives, because Button cannot render
     an <a>. Matched to Button's `secondary` variant + `md` size so the two sit
     level in the header row. */
  .link-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: var(--space-10);
    padding-inline: var(--space-4);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-decoration: none;
    white-space: nowrap;
    transition: var(--transition-colors);
  }

  .link-action:hover {
    background-color: var(--color-surface-secondary);
  }

  .link-action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

</style>
