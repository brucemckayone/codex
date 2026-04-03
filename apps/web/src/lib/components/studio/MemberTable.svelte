<!--
  @component MemberTable

  Displays a table of organization members for the studio team management page.
  Shows name + avatar, email, role (colored badge), joined date, and actions.

  @prop {OrgMemberItem[]} members - Array of members to display
  @prop {(userId: string, role: string) => void} onChangeRole - Callback when role is changed
  @prop {(userId: string) => void} onRemove - Callback when member is removed
  @prop {boolean} loading - Whether the data is loading
-->
<script lang="ts">
  import type { OrgMemberItem } from '$lib/server/api';
  import * as Table from '$lib/components/ui/Table';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    members: OrgMemberItem[];
    onChangeRole?: (userId: string, role: string) => void;
    onRemove?: (userId: string) => void;
    loading?: boolean;
  }

  const { members, onChangeRole, onRemove, loading = false }: Props = $props();

  const isEmpty = $derived(members.length === 0);

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

  /**
   * Format a date string for display
   */
  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Get initials from name for avatar fallback
   */
  function getInitials(name: string | null): string {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const roles = ['admin', 'creator', 'member'] as const;

  function handleRoleChange(userId: string, event: Event) {
    const target = event.target as HTMLSelectElement;
    onChangeRole?.(userId, target.value);
  }

  function handleRemove(userId: string) {
    if (confirm(m.team_remove_confirm())) {
      onRemove?.(userId);
    }
  }
</script>

{#if loading}
  <div class="loading-state">
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </div>
{:else if isEmpty}
  <div class="empty-state">
    <UsersIcon size={48} stroke-width="1" class="empty-icon" />
    <h3 class="empty-title">{m.team_empty()}</h3>
  </div>
{:else}
  <div class="table-wrapper">
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
                  <select
                    class="role-select"
                    value={member.role}
                    onchange={(e) => handleRoleChange(member.userId, e)}
                    aria-label={m.team_change_role()}
                  >
                    {#each roles as role}
                      <option value={role} selected={role === member.role}>
                        {getRoleText(role)}
                      </option>
                    {/each}
                  </select>
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
    width: 32px;
    height: 32px;
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
    line-height: 1;
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

  .role-select {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    cursor: pointer;
  }

  .role-select:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
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
    outline: 2px solid var(--color-error-500);
    outline-offset: 2px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-title {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 320px;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .skeleton-row {
    height: 48px;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: var(--opacity-50);
    }
    50% {
      opacity: 1;
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

  /* Dark mode */
  :global([data-theme='dark']) .member-name {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .avatar {
    background-color: var(--color-interactive-subtle);
    color: var(--color-brand-primary-subtle);
  }

  :global([data-theme='dark']) .role-select {
    background-color: var(--color-background);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted);
  }
</style>
