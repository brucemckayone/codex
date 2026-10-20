<!--
  @component OwnershipOfferDialog

  The owner's two-step offer (mockup states 2 and 3, variant A): choose an
  eligible admin or creator, then confirm by typing the organisation's name.

  The confirmation is deliberate because the offer moves the organisation's
  money. Step 2 states every consequence in plain words, warns when the owner
  holds no subscription agreement ("Agreements decide" — their subscription
  income stops), and warns when the recipient has no payouts set up. Send
  enables only when the typed name matches the way the server compares it
  (trimmed, any case — `confirmNameMatches`).

  State resets whenever the dialog closes, however it closes: from inside
  (Cancel / Close / a successful send, via `close()`) or by Melt (Escape, the
  overlay, the X — via `onOpenChange`). The parent only ever OPENS it.

  @prop {boolean} open - Bindable.
  @prop {string} orgName - Shown in the copy and matched by the name check.
  @prop {OwnershipEligibleRecipient[]} recipients - Active admins and creators.
  @prop {boolean} ownerHasSubscriptionAgreement - False shows the state 3 note.
  @prop {(recipientUserId: string, confirmName: string) => Promise<void>} onSubmit
    Resolves on success (the dialog closes); a rejection is shown in place.
  @prop {(error: unknown) => string} errorMessage - Maps a rejection to copy.
  @prop {CreateDialogProps['closeFocus']} [closeFocus] - Where focus returns.
-->
<script lang="ts">
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Badge, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import ActionLink from '$lib/components/studio/ActionLink.svelte';
  import { formatDate, getInitials } from '$lib/utils/format';
  import type { OwnershipEligibleRecipient } from '$lib/types';
  import { confirmNameMatches, estimatedOfferExpiry } from './ownership-view';

  interface Props {
    open?: boolean;
    orgName: string;
    recipients: OwnershipEligibleRecipient[];
    ownerHasSubscriptionAgreement: boolean;
    onSubmit: (recipientUserId: string, confirmName: string) => Promise<void>;
    errorMessage: (error: unknown) => string;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let {
    open = $bindable(false),
    orgName,
    recipients,
    ownerHasSubscriptionAgreement,
    onSubmit,
    errorMessage,
    closeFocus,
  }: Props = $props();

  let step = $state<'choose' | 'confirm'>('choose');
  let selectedId = $state<string | null>(null);
  let typedName = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  /** Stamped on entering step 2, so the date does not drift while it is open. */
  let expiresOn = $state<Date | null>(null);

  const selected = $derived(
    recipients.find((r) => r.userId === selectedId) ?? null
  );
  const nameMatches = $derived(confirmNameMatches(typedName, orgName));

  function roleLabel(role: OwnershipEligibleRecipient['role']): string {
    return role === 'admin' ? m.team_role_admin() : m.team_role_creator();
  }

  function reset() {
    step = 'choose';
    selectedId = null;
    typedName = '';
    submitting = false;
    submitError = null;
    expiresOn = null;
  }

  function close() {
    open = false;
    reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
  }

  function toConfirm() {
    if (!selected) return;
    expiresOn = estimatedOfferExpiry();
    step = 'confirm';
  }

  function back() {
    step = 'choose';
    typedName = '';
    submitError = null;
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!selected || !nameMatches || submitting) return;
    submitting = true;
    submitError = null;
    try {
      await onSubmit(selected.userId, typedName);
      close();
    } catch (error) {
      submitError = errorMessage(error);
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange} {closeFocus}>
  <Dialog.Content size="sm">
    {#if recipients.length === 0}
      <!-- State 2, empty: nobody is eligible yet. -->
      <Dialog.Header>
        <Dialog.Title>{m.ownership_choose_title({ orgName })}</Dialog.Title>
        <Dialog.Description>{m.ownership_choose_empty_title()}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <p class="ownership-dialog__note">{m.ownership_choose_empty_body()}</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>{m.common_close()}</Button>
        <ActionLink href="/studio/team">{m.ownership_choose_go_to_team()}</ActionLink>
      </Dialog.Footer>
    {:else if step === 'choose' || !selected}
      <!-- State 2: choose who. -->
      <Dialog.Header>
        <Dialog.Title>{m.ownership_choose_title({ orgName })}</Dialog.Title>
        <Dialog.Description>{m.ownership_choose_description()}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <fieldset class="ownership-dialog__recipients">
          <legend class="sr-only">{m.ownership_choose_legend()}</legend>
          {#each recipients as recipient (recipient.userId)}
            <label class="ownership-recipient">
              <input
                type="radio"
                name="ownership-recipient"
                value={recipient.userId}
                bind:group={selectedId}
              />
              <span class="ownership-recipient__avatar" aria-hidden="true">
                {getInitials(recipient.name)}
              </span>
              <span class="ownership-recipient__text">
                <span class="ownership-recipient__name">{recipient.name}</span>
                <span class="ownership-recipient__meta">
                  {m.ownership_choose_meta({
                    role: roleLabel(recipient.role),
                    date: formatDate(recipient.joinedAt),
                  })}
                </span>
              </span>
              <Badge variant={recipient.payoutsReady ? 'success' : 'warning'}>
                {recipient.payoutsReady
                  ? m.ownership_payouts_ready()
                  : m.ownership_payouts_not_ready()}
              </Badge>
            </label>
          {/each}
        </fieldset>
        <p class="ownership-dialog__note">{m.ownership_choose_note()}</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>{m.common_cancel()}</Button>
        <Button onclick={toConfirm} disabled={!selected}>
          {m.ownership_choose_continue()}
        </Button>
      </Dialog.Footer>
    {:else}
      <!-- State 3, variant A: confirm by typing the organisation's name. -->
      <form class="ownership-dialog__confirm" onsubmit={send} novalidate>
        <Dialog.Header>
          <Dialog.Title>{m.ownership_confirm_title({ name: selected.name })}</Dialog.Title>
          <Dialog.Description>
            {m.ownership_confirm_lede({
              name: selected.name,
              date: formatDate(expiresOn ?? estimatedOfferExpiry()),
            })}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <div class="ownership-dialog__stack">
            <ul class="ownership-dialog__consequences">
              <li>{m.ownership_confirm_money({ name: selected.name })}</li>
              <li>{m.ownership_confirm_earned()}</li>
              <li>{m.ownership_confirm_admin()}</li>
            </ul>

            {#if !ownerHasSubscriptionAgreement}
              <Alert variant="info">
                <p class="ownership-dialog__alert-title">
                  {m.ownership_confirm_subscription_title()}
                </p>
                <p>{m.ownership_confirm_subscription_body({ orgName })}</p>
                <a class="ownership-dialog__link" href="/studio/monetisation/revenue-share">
                  {m.ownership_confirm_subscription_cta()}
                </a>
              </Alert>
            {/if}

            {#if !selected.payoutsReady}
              <Alert variant="warning">
                <p class="ownership-dialog__alert-title">
                  {m.ownership_confirm_payouts_title({ name: selected.name })}
                </p>
                <p>{m.ownership_confirm_payouts_body()}</p>
              </Alert>
            {/if}

            <div class="ownership-dialog__field">
              <Label for="ownership-confirm-name">
                {m.ownership_confirm_type_label({ orgName })}
              </Label>
              <Input
                id="ownership-confirm-name"
                bind:value={typedName}
                autocomplete="off"
                spellcheck={false}
                required
              />
            </div>

            <p class="ownership-dialog__note">
              {m.ownership_confirm_email_note({ name: selected.name })}
            </p>

            {#if submitError}
              <Alert variant="error">{submitError}</Alert>
            {/if}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" onclick={back} disabled={submitting}>
            {m.ownership_confirm_back()}
          </Button>
          <Button
            type="submit"
            disabled={!nameMatches}
            loading={submitting}
            aria-label={m.ownership_confirm_send()}
          >
            {m.ownership_confirm_send()}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /* The form exists for Enter-to-submit and submit semantics only. Without
     `contents` it would sit between `.dialog-content`'s flex column and the
     header / body / footer, and the body would stop being the part that
     scrolls in a short viewport. */
  .ownership-dialog__confirm {
    display: contents;
  }

  .ownership-dialog__recipients {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: none;
  }

  .ownership-recipient {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .ownership-recipient:hover {
    background-color: var(--color-surface-secondary);
  }

  /* The whole row is the target, so the ring goes on the row when the radio
     inside it has keyboard focus. */
  .ownership-recipient:has(input:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .ownership-recipient:has(input:checked) {
    border-color: var(--color-border-focus);
  }

  .ownership-recipient input {
    flex-shrink: 0;
    margin: 0;
  }

  .ownership-recipient__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }

  .ownership-recipient__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .ownership-recipient__name {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .ownership-recipient__meta,
  .ownership-dialog__note {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .ownership-dialog__note {
    margin: var(--space-3) 0 0;
  }

  .ownership-dialog__stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ownership-dialog__stack .ownership-dialog__note {
    margin: 0;
  }

  .ownership-dialog__consequences {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-inline-start: var(--space-5);
    color: var(--color-text);
  }

  .ownership-dialog__alert-title {
    margin: 0 0 var(--space-1);
    font-weight: var(--font-medium);
  }

  .ownership-dialog__stack :global(.alert p) {
    margin: 0;
  }

  /* Inherits the Alert's ink rather than painting brand colour as small text
     (see MemberTable's `.rev-link` for the contrast measurements). */
  .ownership-dialog__link {
    display: inline-block;
    margin-top: var(--space-2);
    color: inherit;
    font-weight: var(--font-medium);
    text-decoration: underline;
  }

  .ownership-dialog__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .ownership-dialog__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
