<!--
  @component CounterProposalDialog

  Dialog the creator uses to counter an open owner proposal (WP-8 —
  Codex-bw2wf). Pre-fills the slider + term picker with the OWNER's
  current offer, and shows a "their offer was X%; your counter:" hint
  comparing the new value against the pre-filled baseline.

  Mirrors `ProposeAgreementDialog` (WP-7) in layout and tone — same
  BrandSliderField + radio-group term picker + optional note — but with
  copy that frames the action as a counter rather than a fresh proposal.

  Idempotent open-state handler per [[melt-controlled-components]] —
  `onOpenChange` early-returns when next === current to avoid spurious
  side-effect echoes from Melt UI's controlled-component lifecycle.

  Copy explicitly says "X% of post-platform [revenue_type] revenue" so
  the creator understands the post-platform-pool semantic (per the C1
  math decision; see project_revenue_share_decisions Q2). Currency GBP.
-->
<script lang="ts">
  import { formatRevenueTypeLabel } from '@codex/agreements';
  import BrandSliderField from '$lib/components/brand-editor/BrandSliderField.svelte';
  import { DialogForm } from '$lib/components/ui/DialogForm';

  type RevenueType = 'subscription' | 'content_purchase';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The owner's current proposed share % in basis points (0-10000). */
    currentSharePercent: number;
    /** The owner's current proposed term in months. */
    currentTermMonths: number | null;
    /** Human name of the party currently waiting on a response. */
    ownerName: string;
    revenueType: RevenueType;
    /**
     * Submit handler. Returns when the counter succeeds; the dialog closes
     * on success. Throw to surface an error message inline.
     */
    onSubmit: (input: {
      sharePercent: number;
      termMonths: number;
      note?: string;
    }) => Promise<void>;
  }

  const {
    open,
    onOpenChange,
    currentSharePercent,
    currentTermMonths,
    ownerName,
    revenueType,
    onSubmit,
  }: Props = $props();

  // ─── Form state ──────────────────────────────────────────────────────────
  // Seed from the owner's current offer; the user owns the values from
  // there. Reset on (re-)open so switching proposals does not bleed prior
  // edits into a different counter (per the Svelte 5 "seed from a prop,
  // then own it" pattern documented in ProposeAgreementDialog).

  let shareBp = $state(currentSharePercent);
  let termMonths = $state(currentTermMonths ?? 12);
  let note = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) {
      shareBp = currentSharePercent;
      termMonths = currentTermMonths ?? 12;
      note = '';
      error = null;
    }
  });

  const revenueLabel = $derived(formatRevenueTypeLabel(revenueType));
  const sharePercent = $derived(shareBp / 100);
  const ownerSharePercent = $derived(currentSharePercent / 100);
  const formattedShare = $derived(
    Number.isInteger(sharePercent)
      ? `${sharePercent}%`
      : `${sharePercent.toFixed(1)}%`
  );
  const formattedOwnerShare = $derived(
    Number.isInteger(ownerSharePercent)
      ? `${ownerSharePercent}%`
      : `${ownerSharePercent.toFixed(1)}%`
  );
  const ariaValueText = $derived(
    `${formattedShare} of post-platform ${revenueLabel} revenue`
  );
  const isChanged = $derived(shareBp !== currentSharePercent || termMonths !== (currentTermMonths ?? 12));

  const termOptions = [
    { value: 3, label: '3 months' },
    { value: 6, label: '6 months' },
    { value: 12, label: '12 months' },
    { value: 24, label: '24 months' },
    { value: 36, label: '36 months' },
  ];

  function onShareInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const raw = Number(target.value);
    if (!Number.isFinite(raw)) return;
    shareBp = Math.min(10000, Math.max(0, Math.round(raw * 100)));
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (note.length > 500) {
      error = 'Note must be 500 characters or less';
      return;
    }
    if (!isChanged) {
      error =
        'Counters must change either the share or term. Use Accept to take the existing offer.';
      return;
    }

    submitting = true;
    try {
      await onSubmit({
        sharePercent: shareBp,
        termMonths,
        note: note.trim() || undefined,
      });
      // Parent closes on success; the form resets via the $effect above
      // when `open` flips next.
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send counter';
    } finally {
      submitting = false;
    }
  }

  /**
   * Idempotent open-change handler — Melt UI fires onOpenChange during
   * its controlled-component sync (mount/unmount); short-circuit if the
   * next value matches the current to avoid re-running side effects.
   */
  function handleOpenChange(next: boolean) {
    if (next === open) return;
    onOpenChange(next);
  }

  const dialogTitle = $derived(
    `Counter ${revenueLabel} proposal from ${ownerName}`
  );
  const dialogDescription =
    'Share is calculated against post-platform revenue. The platform fee is taken first; this percentage applies to what remains.';
</script>

<DialogForm
  title={dialogTitle}
  description={dialogDescription}
  {open}
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel="Send counter"
>
  <div class="counter-form">
    <BrandSliderField
      id="counter-share"
      label="Your share"
      value={formattedShare}
      min={0}
      max={100}
      step={1}
      current={sharePercent}
      minLabel="0%"
      maxLabel="100%"
      ariaValueText={ariaValueText}
      oninput={onShareInput}
    />
    <p class="counter-form__comparison" aria-live="polite">
      <span class="counter-form__comparison-baseline">
        {ownerName}'s offer was <strong>{formattedOwnerShare}</strong>.
      </span>
      <span class="counter-form__comparison-counter">
        Your counter: <strong>{formattedShare}</strong>
        of post-platform {revenueLabel} revenue.
      </span>
    </p>

    <fieldset class="counter-form__field">
      <legend class="counter-form__field-label">Soft-lock term</legend>
      <p class="counter-form__field-hint">
        How long this rate is locked before either side can amend.
      </p>
      <div
        class="counter-form__term-options"
        role="radiogroup"
        aria-label="Soft-lock term"
      >
        {#each termOptions as option (option.value)}
          <label class="counter-form__term-option">
            <input
              type="radio"
              name="counter-term"
              value={option.value}
              checked={termMonths === option.value}
              onchange={() => (termMonths = option.value)}
              disabled={submitting}
            />
            <span>{option.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="counter-form__field">
      <label class="counter-form__field-label" for="counter-note">
        Note (optional)
      </label>
      <p class="counter-form__field-hint">
        Visible to {ownerName}. Use this to explain your counter.
      </p>
      <textarea
        id="counter-note"
        class="counter-form__textarea"
        bind:value={note}
        rows="3"
        maxlength="500"
        disabled={submitting}
        placeholder="e.g. I'd like a longer term to reflect ongoing work."
      ></textarea>
      <span class="counter-form__char-count" aria-live="polite">
        {note.length} / 500
      </span>
    </div>
  </div>
</DialogForm>

<style>
  .counter-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .counter-form__comparison {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-info-50);
    color: var(--color-text);
    border-inline-start: var(--border-width-thick) solid var(--color-info-200);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }

  .counter-form__comparison-baseline {
    color: var(--color-text-secondary);
  }

  .counter-form__comparison-counter {
    color: var(--color-text);
  }

  .counter-form__comparison strong {
    font-family: var(--font-mono);
    color: var(--color-text);
  }

  .counter-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: none;
    padding: 0;
    margin: 0;
  }

  .counter-form__field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .counter-form__field-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .counter-form__term-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .counter-form__term-option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .counter-form__term-option:hover {
    background: var(--color-surface-secondary);
  }

  .counter-form__term-option:has(input:checked) {
    background: var(--color-interactive-subtle);
    border-color: var(--color-interactive);
    color: var(--color-text);
  }

  .counter-form__term-option:has(input:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .counter-form__textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    resize: vertical;
    min-height: var(--space-16);
  }

  .counter-form__textarea:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-color: var(--color-border-focus);
  }

  .counter-form__char-count {
    align-self: flex-end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
