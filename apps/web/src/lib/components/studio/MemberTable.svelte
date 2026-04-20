<!--
  @component MemberTable

  Displays a table of organization members for the studio team management page.
  Shows name + avatar, email, role (colored badge), joined date, and actions.

  @prop {OrgMemberItem[]} members - Array of members to display
  @prop {(userId: string, role: string) => void} onChangeRole - Callback when role is changed
  @prop {(userId: string) => void} onRemove - Callback when member is removed
  @prop {boolean} loading - Whether the data is loading
  @prop {string} [class] - Optional class forwarded to the root element of each conditional branch
-->
<script lang="ts">
  import type { OrgMemberItem } from '$lib/types';
  import * as Table from '$lib/components/ui/Table';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { ConfirmDialog } from '$lib/components/ui';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { formatDate, getInitials } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    members: OrgMemberItem[];
    onChangeRole?: (userId: string, role: string) => void;
    onRemove?: (userId: string) => void;
    loading?: boolean;
    class?: string;
  }

  const {
    members,
    onChangeRole,
    onRemove,
    loading = false,
    class: className = '',
  }: Props = $props();

  const isEmpty = $derived(members.length === 0);

  // Confirm dialog state for member removal
  let showRemoveConfirm = $state(false);
  let pendingRemoveUserId = $state<string | null>(null);

  /**
   * Map role to Badge variant
   */
  function getRoleVariant(
    role: string
  ): 'success' | 'warning' | 'neutral' | 'info' {
    switch (role) {
      case 'owner':
        return 'warning';
      case 'admin':
        return 'info';
      case 'creator':
        return 'success';
      default:
        return 'neutral';
    }
  }

  /**
   * Get localized role text
   */
  function getRoleText(role: string): string {
    switch (role) {
      case 'owner':
        return m.team_role_owner();
      case 'admin':
        return m.team_role_admin();
      case 'creator':
        return m.team_role_creator();
      case 'member':
        return m.team_role_member();
      default:
        return role;
    }
  }

  const roleOptions = $derived([
    { value: 'admin', label: getRoleText('admin') },
    { value: 'creator', label: getRoleText('creator') },
    { value: 'member', label: getRoleText('member') },
  ]);

  function handleRoleChange(userId: string, value: string | undefined) {
    if (value) onChangeRole?.(userId, value);
  }

  function handleRemove(userId: string) {
    pendingRemoveUserId = userId;
    showRemoveConfirm = true;
  }

  function confirmRemove() {
    if (pendingRemoveUserId) {
      onRemove?.(pendingRemoveUserId);
    }
    pendingRemoveUserId = null;
  }

  function cancelRemove() {
    pendingRemoveUserId = null;
  }
</script>

{#if loading}
  <div class="loading-state {className}">
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </div>
{:else if isEmpty}
  <div class="empty-state {className}">
    <EmptyState title={m.team_empty()} icon={UsersIcon} />
  </div>
{:else}
  <div class="table-wrapper {className}">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.team_col_name()}</Table.Head>
          <Table.Head>{m.team_col_email()}</Table.Head>
          <Table.Head>{m.team_col_role()}</Table.Head>
          <Table.Head>{m.team_col_joined()}</Table.Head>
          <Table.Head>{m.team_col_actions()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each members as member (member.userId)}
          <Table.Row>
            <Table.Cell>
              <div class="member-name-cell">
                <div class="avatar" aria-hidden="true">
                  {#if member.avatarUrl}
                    <img
                      src={member.avatarUrl}
                      alt=""
                      class="avatar-img"
                      loading="lazy"
                    />
                  {:else}
                    <span class="avatar-initials">
                      {getInitials(member.name)}
                    </span>
                  {/if}
                </div>
                <span class="member-name">{member.name ?? 'Unknown'}</span>
              </div>
            </Table.Cell>
            <Table.Cell class="email-cell">
              {member.email}
            </Table.Cell>
            <Table.Cell>
              <Badge variant={getRoleVariant(member.role)}>
                {getRoleText(member.role)}
              </Badge>
            </Table.Cell>
            <Table.Cell class="date-cell">
              {formatDate(member.joinedAt)}
            </Table.Cell>
            <Table.Cell>
              {#if member.role !== 'owner'}
                <div class="actions">
                  <Select
                    options={roleOptions}
                    value={member.role}
                    onValueChange={(val) => handleRoleChange(member.userId, val)}
                    placeholder={m.team_change_role()}
                  />
                  <button
                    class="remove-btn"
                    onclick={() => handleRemove(member.userId)}
                    aria-label="{m.team_remove()} {member.name ?? member.email}"
                  >
                    {m.team_remove()}
                  </button>
                </div>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}

<ConfirmDialog
  bind:open={showRemoveConfirm}
  title={m.team_remove()}
  description={m.team_remove_confirm()}
  confirmText={m.team_remove()}
  variant="destructive"
  onConfirm={confirmRemove}
  onCancel={cancelRemove}
/>

<style>
  .table-wrapper {
    overflow-x: auto;
  }

  .member-name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .avatar {
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-brand-primary-subtle);
    color: var(--color-interactive-active);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-initials {
    line-height: var(--leading-none);
  }

  .member-name {
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .remove-btn {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    background-color: transparent;
    color: var(--color-error-600);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .remove-btn:hover {
    background-color: var(--color-error-50);
    border-color: var(--color-error-300);
  }

  .remove-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .skeleton-row {
    height: var(--space-12);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  /* Infinite-iteration animations bypass the token-level duration collapse;
     neutralise for vestibular safety (ref 03 §9 Skeleton Contract). */
  @media (prefers-reduced-motion: reduce) {
    .skeleton-row {
      animation: none;
    }
  }

  /* Global cell styles */
  :global(.email-cell) {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  :global(.date-cell) {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

</style>
</content>
