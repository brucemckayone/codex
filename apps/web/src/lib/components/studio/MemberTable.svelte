<!--
  @component MemberTable

  Table of organisation members for the studio team page: name + avatar, email,
  role, joined date, optional revenue-share summary, and Remove.

  THE ROLE COLUMN IS THE ROLE CONTROL. It used to render a coloured badge while
  the Actions column rendered a 256px-wide Select showing the same value, so
  every row said "Creator" twice, two columns apart — 16 times over on
  of-blood-and-bones, a wall of identical dropdowns down the right-hand side.
  Collapsing them into one control per row removes the restatement, drops a
  256px column's worth of width (which is what pushed Actions off-screen behind
  an undiscoverable horizontal scroll at 390px), and leaves Actions holding the
  one thing that is genuinely an action. The owner row keeps a plain badge:
  its role is not editable.

  @prop {OrgMemberItem[]} members - Array of members to display
  @prop {(userId: string, role: string) => void} onChangeRole - Callback when role is changed
  @prop {(userId: string) => void} onRemove - Callback when member is removed
  @prop {() => void} [onInvite] - Opens the invite flow from the empty state.
    Omitted → the empty state renders without a call to action.
  @prop {boolean} loading - Whether the data is loading
  @prop {string} [class] - Optional class forwarded to the root element of each conditional branch
-->
<script lang="ts">
  import type { OrgMemberItem } from '$lib/types';
  import * as Table from '$lib/components/ui/Table';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { Button, ConfirmDialog } from '$lib/components/ui';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { formatDate, getInitials } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    members: OrgMemberItem[];
    onChangeRole?: (userId: string, role: string) => void;
    onRemove?: (userId: string) => void;
    onInvite?: () => void;
    loading?: boolean;
    class?: string;
    /**
     * Optional per-member active revenue-share summary, keyed by userId.
     * When provided, a "Revenue share" column is rendered with a deep-link
     * into the Monetisation > Revenue share tab. Owner-only (Codex-dhxjz);
     * callers pass undefined to hide the column entirely.
     */
    revenueShareByUser?: Map<string, { label: string; active: boolean }>;
  }

  const {
    members,
    onChangeRole,
    onRemove,
    onInvite,
    loading = false,
    class: className = '',
    revenueShareByUser,
  }: Props = $props();

  const isEmpty = $derived(members.length === 0);

  const showRevenueShare = $derived(revenueShareByUser !== undefined);

  // Confirm dialog state for member removal
  let showRemoveConfirm = $state(false);
  let pendingRemoveUserId = $state<string | null>(null);

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

<!-- Passed to EmptyState only when a caller supplied `onInvite`; EmptyState
     renders its action wrapper whenever the SNIPPET is present, so gating
     inside the snippet would leave an empty margin behind. -->
{#snippet inviteAction()}
  <Button size="sm" onclick={onInvite}>{m.team_invite()}</Button>
{/snippet}

{#if loading}
  <div class="loading-state {className}">
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </div>
{:else if isEmpty}
  <!-- Keep the `.empty-state` class: team.spec.ts locates it as one of the two
       terminal states of the members query. The empty state now carries the
       invite CTA — this is the one page whose entire purpose is inviting
       people, and it previously offered nothing to click. -->
  <div class="empty-state {className}">
    <EmptyState
      title={m.team_empty()}
      icon={UsersIcon}
      action={onInvite ? inviteAction : undefined}
    />
  </div>
{:else}
  <!-- No `overflow-x` here: Table.Root already emits `.table-container` with
       `overflow: auto`, and this box sits inside `.members-section`'s
       `overflow: hidden`, so the outer one could never scroll anyway. -->
  <div class="table-wrapper {className}">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.team_col_name()}</Table.Head>
          <Table.Head>{m.team_col_email()}</Table.Head>
          <Table.Head>{m.team_col_role()}</Table.Head>
          <Table.Head>{m.team_col_joined()}</Table.Head>
          {#if showRevenueShare}
            <!-- TODO(i18n): `team_col_revenue_share` = "Revenue share". Every
                 other header on this table goes through paraglide; en.json is
                 owned by another worktree this round. -->
            <Table.Head>Revenue share</Table.Head>
          {/if}
          <Table.Head>{m.team_col_actions()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each members as member (member.userId)}
          {@const memberLabel = member.name ?? member.email}
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
              {#if member.role === 'owner'}
                <!-- Neutral, not a status variant. The old mapping painted
                     owner as `warning` and admin as `info`, which borrowed
                     alert semantics for a role taxonomy: an amber "Owner"
                     chip reads as a problem to fix. -->
                <Badge variant="neutral">{getRoleText(member.role)}</Badge>
              {:else}
                <!-- Per-row accessible name. Select renders its `placeholder`
                     as an sr-only <label for> when no visible `label` is
                     given, and the trigger's visible text comes from the
                     SELECTED option, which is always set here — so this names
                     the control without adding a visible label. Without it the
                     AT tree carried 7 identical "Change Role" comboboxes on
                     studio-alpha (15 on of-blood-and-bones), the same defect
                     already fixed for Remove.
                     TODO(i18n): `team_change_role_for` = "Change role for
                     {name}" — listed for the orchestrator; en.json belongs to
                     another worktree this round. -->
                <Select
                  class="role-select"
                  options={roleOptions}
                  value={member.role}
                  onValueChange={(val) => handleRoleChange(member.userId, val)}
                  placeholder={`Change role for ${memberLabel}`}
                />
              {/if}
            </Table.Cell>
            <Table.Cell class="date-cell">
              {formatDate(member.joinedAt)}
            </Table.Cell>
            {#if showRevenueShare}
              {@const rs = revenueShareByUser?.get(member.userId)}
              <Table.Cell>
                <div class="rev-cell">
                  <!-- Per-row accessible names, same reason as Remove below.
                       Every one of these links points at a DIFFERENT member's
                       agreement (`?focus=<userId>`), but the visible text is
                       identical on every row — seven "Set up" entries on
                       studio-alpha, fifteen on of-blood-and-bones. The only
                       distinguishing context is the name in the first cell,
                       which is a <td>, not a <th scope="row">, so it is not
                       programmatically determined context under WCAG 2.4.4:
                       a links-list (NVDA Insert+F7 / VO rotor) shows N
                       indistinguishable entries that deep-link to different
                       people.
                       TODO(i18n): `team_rev_manage_for` = "Manage revenue share
                       for {name}", `team_rev_setup_for` = "Set up revenue share
                       for {name}". Listed for the orchestrator; en.json belongs
                       to another worktree this round. -->
                  {#if rs?.active}
                    <Badge variant="success">{rs.label}</Badge>
                    <a
                      class="rev-link"
                      href={`/studio/monetisation/revenue-share?focus=${member.userId}`}
                      aria-label={`Manage revenue share for ${memberLabel}`}
                    >
                      Manage
                    </a>
                  {:else if member.role === 'owner'}
                    <span class="rev-none">—</span>
                  {:else}
                    <!-- One affordance, not two. The row used to print "No
                         agreement" AND a "Set up" link; the absence of a
                         badge already says there is no agreement, so 15
                         consecutive rows were spending two labels on it. -->
                    <a
                      class="rev-link"
                      href={`/studio/monetisation/revenue-share?focus=${member.userId}`}
                      aria-label={`Set up revenue share for ${memberLabel}`}
                    >
                      Set up
                    </a>
                  {/if}
                </div>
              </Table.Cell>
            {/if}
            <Table.Cell>
              {#if member.role !== 'owner'}
                <button
                  class="remove-btn"
                  onclick={() => handleRemove(member.userId)}
                  aria-label="{m.team_remove()} {memberLabel}"
                >
                  {m.team_remove()}
                </button>
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

  /* The role Select carries no width of its own — `.select-container` is
     `width: 100%` — so in a full-width studio column it stretches across the
     cell and reads as unconsidered. Cap it to the inline-control measure.
     `:global` is required: the class belongs to Select's own style scope. */
  .table-wrapper :global(.role-select) {
    max-width: var(--control-width-md);
  }

  .rev-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .rev-none {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* `--color-text`, NOT `--color-interactive`. The latter resolves to the org's
     raw `--brand-color` under `[data-org-brand]`, i.e. arbitrary user input
     painted as 12px text: measured 3.22:1 on studio-alpha dark, 4.24:1 on
     of-blood-and-bones dark and 4.29:1 light — three AA failures against the
     4.5:1 that applies at this size, and unbounded, because a lighter brand
     makes it worse. The permanent underline carries the affordance instead;
     this is the pattern PageHeader already established, where brand ink is
     confined to a decorative rule that has no contrast requirement. */
  .rev-link {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: underline;
    white-space: nowrap;
  }

  .rev-link:hover {
    color: var(--color-text-secondary);
  }

  .rev-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  /* Status family, not the raw --color-error-* palette: those steps are fixed
     light-mode sRGB declared at :root only, so `--color-error-600` painted
     #dc2626 on `.members-section`'s dark `--color-surface` — 3.13:1, measured.
     The --color-status-error-* triple derives from the surface it sits on, so
     it follows both the theme and the org background. Declared on
     `:root, [data-org-brand]` in styles/themes/status.css, so it is safe even
     though this table can render outside .org-layout. */
  .remove-btn {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-status-error-border);
    background-color: transparent;
    color: var(--color-status-error-text);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .remove-btn:hover {
    background-color: var(--color-status-error-surface);
    border-color: var(--color-status-error-text);
  }

  .remove-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
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
