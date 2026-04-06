<!--
  @component InviteMemberDialog

  Dialog for inviting a new member to the organization.
  Uses DialogForm for the shared dialog + form boilerplate.

  @prop {boolean} open - Whether the dialog is open
  @prop {(open: boolean) => void} onOpenChange - Callback for open state change
  @prop {(email: string, role: string) => Promise<void>} onInvite - Callback when invite is submitted
-->
<script lang="ts">
  import { DialogForm } from '$lib/components/ui/DialogForm';
  import { Select } from '$lib/components/ui';
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
  let role = $state<string>('creator');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const roleOptions = $derived([
    { value: 'admin', label: m.team_role_admin() },
    { value: 'creator', label: m.team_role_creator() },
    { value: 'member', label: m.team_role_member() },
  ]);

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
    if (!isOpen) {
      // Reset form state on close
      email = '';
      role = 'creator';
      error = null;
    }
    onOpenChange?.(isOpen);
  }
</script>

<DialogForm
  title={m.team_invite()}
  bind:open
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel={m.team_invite_send()}
>
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
    <Select
      options={roleOptions}
      bind:value={role}
      label={m.team_invite_role()}
      placeholder={m.team_invite_role()}
    />
  </div>
</DialogForm>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
