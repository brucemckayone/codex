<!--
  @component InviteMemberDialog

  Dialog for inviting a new member to the organization.
  Contains email and role select fields with validation.

  @prop {boolean} open - Whether the dialog is open
  @prop {(open: boolean) => void} onOpenChange - Callback for open state change
  @prop {(email: string, role: string) => Promise<void>} onInvite - Callback when invite is submitted
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as m from '$paraglide/messages';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onInvite: (email: string, role: string) => Promise<void>;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    onInvite,
  }: Props = $props();

  let email = $state('');
  let role = $state<'admin' | 'creator' | 'member'>('creator');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!email.trim()) {
      error = 'Email is required';
      return;
    }

    submitting = true;
    try {
      await onInvite(email.trim(), role);
      // Reset and close on success
      email = '';
      role = 'creator';
      open = false;
      onOpenChange?.(false);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send invite';
    } finally {
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
    if (!isOpen) {
      // Reset form state on close
      email = '';
      role = 'creator';
      error = null;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.team_invite()}</Dialog.Title>
    </Dialog.Header>

    <form onsubmit={handleSubmit} class="invite-form">
      {#if error}
        <div class="form-error" role="alert">{error}</div>
      {/if}

      <div class="form-field">
        <label class="field-label" for="invite-email">
          {m.team_invite_email()}
        </label>
        <input
          type="email"
          id="invite-email"
          class="field-input"
          bind:value={email}
          placeholder="name@example.com"
          required
          disabled={submitting}
        />
      </div>

      <div class="form-field">
        <label class="field-label" for="invite-role">
          {m.team_invite_role()}
        </label>
        <select
          id="invite-role"
          class="field-input field-select"
          bind:value={role}
          disabled={submitting}
        >
          <option value="admin">{m.team_role_admin()}</option>
          <option value="creator">{m.team_role_creator()}</option>
          <option value="member">{m.team_role_member()}</option>
        </select>
      </div>

      <Dialog.Footer>
        <button
          type="button"
          class="btn btn-secondary"
          onclick={() => handleOpenChange(false)}
          disabled={submitting}
        >
          {m.common_cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={submitting}>
          {#if submitting}
            {m.common_loading()}
          {:else}
            {m.team_invite_send()}
          {/if}
        </button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .invite-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-input:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .field-select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    padding-right: var(--space-8);
    cursor: pointer;
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .btn-secondary {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--color-surface);
  }

</style>
