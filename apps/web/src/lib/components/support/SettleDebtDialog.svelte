<!--
  @component SettleDebtDialog

  Settle a creator debt, with a confirm (Codex-2hxff.28, mockup D3). Three
  answers, none chosen in advance:

  - `creator_absorbed`: the payee paid it back (Q8: this records a repayment
    that already happened; nothing is taken from later payouts yet);
  - `platform_absorbed`: the platform keeps the loss. On a chargeback's debt,
    a later win pays nothing back to the payee for it;
  - `manually_reversed`: support reversed the transfer in the Stripe
    Dashboard. A note is required (Q6).

  `dispute_won` is never offered: the won-chargeback code writes it, with its
  re-pay (Q7).

  @prop {CreatorDebtItem | null} item
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished
  @prop {() => HTMLElement | null} [closeFocus] - Where focus goes on close.

  While its request runs the dialog can't be dismissed, and the answer names
  the payee that was sent, captured then.
-->
<script lang="ts">
  import type { CreatorDebtItem, CreatorDebtResolution } from '@codex/admin';
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { formatPrice } from '$lib/utils/format';
  import { resolveCreatorDebt } from '$lib/remote/support.remote';
  import { resolutionLabel } from './support-format';
  import type { SettleNotice } from './settle-notice';

  interface Props {
    item: CreatorDebtItem | null;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let { item, open = $bindable(false), onFinished, closeFocus }: Props = $props();

  /** The choices support may make. Deliberately not `dispute_won`. */
  const CHOICES: CreatorDebtResolution[] = [
    'creator_absorbed',
    'platform_absorbed',
    'manually_reversed',
  ];

  let choice = $state<CreatorDebtResolution | null>(null);
  let note = $state('');
  let busy = $state(false);
  let problem = $state<'failed' | null>(null);
  let choiceMissing = $state(false);
  let noteMissing = $state(false);

  const uid = $props.id();
  const noteId = `${uid}-note`;
  const groupName = `${uid}-choice`;

  $effect(() => {
    void item?.reviewId;
    choice = null;
    note = '';
    problem = null;
    choiceMissing = false;
    noteMissing = false;
  });

  $effect(() => {
    if (note.trim() !== '') noteMissing = false;
  });

  const name = $derived(item ? item.payee.name || m.support_debt_unnamed() : '');
  const owed = $derived(item ? formatPrice(item.owedCents) : '');
  const fromDispute = $derived(item?.cause?.type === 'dispute');
  const noteRequired = $derived(choice === 'manually_reversed');

  const description = $derived.by(() => {
    if (!item) return '';
    const parts = [item.title, item.buyerName].filter(Boolean);
    const cause = item.cause;
    if (cause?.type === 'refund' && cause.amountCents != null) {
      parts.push(m.support_history_cause_refund({ amount: formatPrice(cause.amountCents) }));
    } else if (cause?.type === 'dispute') {
      parts.push(m.support_history_cause_dispute_plain());
    }
    return parts.join(' · ');
  });

  function optionTitle(value: CreatorDebtResolution): string {
    if (value === 'creator_absorbed') return m.support_debt_option_creator_absorbed({ name });
    if (value === 'platform_absorbed') return m.support_debt_option_platform_absorbed();
    return m.support_debt_option_manually_reversed();
  }

  function optionHint(value: CreatorDebtResolution): string {
    if (value === 'creator_absorbed') return m.support_debt_option_creator_absorbed_hint();
    if (value === 'platform_absorbed') {
      const keeps = m.support_debt_option_platform_absorbed_hint({ name, amount: owed });
      return fromDispute
        ? m.support_sentences_two({
            first: keeps,
            second: m.support_debt_option_platform_absorbed_dispute({ name }),
          })
        : keeps;
    }
    return m.support_debt_option_manually_reversed_hint();
  }

  async function handleSubmit() {
    if (busy || !item) return;
    if (!choice) {
      choiceMissing = true;
      return;
    }
    if (noteRequired && note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    const resolution = choice;
    // The payee the answer's text names, as sent.
    const settlingName = name;
    try {
      const answer = await resolveCreatorDebt({
        reviewId: item.reviewId,
        body: { resolution, note: note.trim() },
      });
      if (answer.outcome === 'done') {
        open = false;
        onFinished({
          variant: 'success',
          text: m.support_settled_debt({
            name: settlingName,
            resolution: resolutionLabel(resolution),
          }),
        });
      } else if (answer.detailsCode === 'ALREADY_SETTLED' || answer.status === 409) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_already() });
      } else if (answer.status === 404) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_gone() });
      } else if (answer.status === 400 && noteRequired) {
        noteMissing = true;
      } else {
        problem = 'failed';
      }
    } catch {
      problem = 'failed';
    } finally {
      busy = false;
    }
  }
</script>

{#if item}
  <Dialog.Root bind:open dismissible={!busy} {closeFocus}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>{m.support_debt_title({ name, amount: owed })}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <fieldset class="radio-group">
          <legend class="legend">{m.support_debt_what_happened()}</legend>
          {#each CHOICES as value (value)}
            <label class="radio-row">
              <input
                type="radio"
                name={groupName}
                {value}
                checked={choice === value}
                onchange={() => {
                  choice = value;
                  choiceMissing = false;
                }}
              />
              <span class="radio-row__text">
                <span class="radio-row__title">{optionTitle(value)}</span>
                <span class="radio-row__hint">{optionHint(value)}</span>
              </span>
            </label>
          {/each}
          {#if choiceMissing}
            <p class="error-text" role="alert">{m.support_debt_choose()}</p>
          {/if}
        </fieldset>
        <div class="field">
          <Label for={noteId}>
            {m.support_note_label()}
            <span class="field__hint">
              {noteRequired ? m.support_note_required() : m.support_note_optional()}
            </span>
          </Label>
          <TextArea
            id={noteId}
            bind:value={note}
            maxlength={SUPPORT_NOTE_MAX_LENGTH}
            required={noteRequired}
            error={noteMissing ? m.support_note_missing() : undefined}
          />
        </div>
        {#if problem}
          <Alert variant="error" data-testid="settle-problem" data-problem={problem}>
            <p>{m.support_settle_failed()}</p>
          </Alert>
        {/if}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (open = false)} disabled={busy}>
          {m.support_confirm_cancel()}
        </Button>
        <Button variant="primary" loading={busy} onclick={handleSubmit} data-testid="settle-submit">
          {m.support_debt_submit()}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .radio-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .radio-row:has(input:checked) {
    border-color: var(--color-border-focus);
  }

  .radio-row input {
    flex-shrink: 0;
    margin: var(--space-0-5) 0 0;
    accent-color: var(--color-interactive);
  }

  .radio-row input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .radio-row__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .radio-row__title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .radio-row__hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .error-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field__hint {
    margin-left: var(--space-1);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }
</style>
