<!--
  @component ProposeAgreementDialog

  Dialog for proposing (round-1) or amending a revenue-share agreement with
  one creator. Uses BrandSliderField for the share% input + a radio group
  for term-month picker + optional note.

  Copy explicitly says "X% of post-platform [revenue_type] revenue" so the
  user understands the post-platform-pool semantic (per the C1 math
  decision; see project_revenue_share_decisions Q2).

  Idempotent open-state handler per [[melt-controlled-components]] —
  `onOpenChange` early-returns when next === current to avoid spurious
  side-effect echoes from Melt UI's controlled-component lifecycle.

  Currency: GBP (£). Used inside the studio settings → revenue-share tab
  for both the round-1 propose flow AND the amend flow (amend just
  pre-fills the slider with the current share).
-->
<script lang="ts">
  import { formatRevenueTypeLabel } from '@codex/agreements';
  import BrandSliderField from '$lib/components/brand-editor/BrandSliderField.svelte';
  import { DialogForm } from '$lib/components/ui/DialogForm';

  type RevenueType = 'subscription' | 'content_purchase';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    creatorName: string;
    revenueType: RevenueType;
    /** Pre-fill share % in basis points. Defaults to 3000 (30%). */
    initialShareBp?: number;
    /** Pre-fill term months. Defaults to 12. */
    initialTermMonths?: number;
    /**
     * Submit handler. Returns when the propose succeeds; the dialog closes
     * on success. Throw to surface an error message inline.
     */
    onSubmit: (input: {
      sharePercent: number;
      termMonths: number;
      note?: string;
    }) => Promise<void>;
    /**
     * Title + submit-label variant. Distinguishes a round-1 propose flow
     * from an amendment to an existing active agreement, and from a counter
     * to a creator-initiated proposal — the form fields are identical but
     * the copy must match the user's actual action.
     */
    mode?: 'propose' | 'amend' | 'counter';
  }

  const {
    open,
    onOpenChange,
    creatorName,
    revenueType,
    initialShareBp = 3000,
    initialTermMonths = 12,
    onSubmit,
    mode = 'propose',
  }: Props = $props();

  // ─── Form state ──────────────────────────────────────────────────────────
  //
  // Initial value comes from props; the `$effect` below re-syncs whenever
  // the dialog (re-)opens — covers switching creators / amend defaults
  // without losing the user's in-progress slider position when the dialog
  // is already open. Capturing the prop in `$state(...)` at init is the
  // documented Svelte 5 pattern for "seed from a prop, then own it".

  let shareBp = $state(initialShareBp);
  let termMonths = $state(initialTermMonths);
  let note = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Reset when the dialog opens (e.g. switching creator/revenue-type).
  // The boolean `open` is the tracked dependency; reading the initial-*
  // props inside is fine because we explicitly want their CURRENT value
  // each time the dialog opens, not a snapshot taken at component mount.
  $effect(() => {
    if (open) {
      shareBp = initialShareBp;
      termMonths = initialTermMonths;
      note = '';
      error = null;
    }
  });

  const revenueLabel = $derived(formatRevenueTypeLabel(revenueType));
  const sharePercent = $derived(shareBp / 100);
  const formattedShare = $derived(
    Number.isInteger(sharePercent)
      ? `${sharePercent}%`
      : `${sharePercent.toFixed(1)}%`
  );
  const ariaValueText = $derived(
    `${formattedShare} of post-platform ${revenueLabel} revenue`
  );

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

    submitting = true;
    try {
      await onSubmit({
        sharePercent: shareBp,
        termMonths,
        note: note.trim() || undefined,
      });
      // Parent will close on success; the form resets via the $effect above
      // when `open` flips next.
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to submit proposal';
    } finally {
      submitting = false;
    }
  }

  /**
   * Idempotent open-change handler — when Melt UI fires onOpenChange during
   * its controlled-component sync (mount/unmount), short-circuit if the next
   * value matches the current to avoid re-running side effects.
   */
  function handleOpenChange(next: boolean) {
    if (next === open) return;
    onOpenChange(next);
  }

  const dialogTitle = $derived.by(() => {
    switch (mode) {
      case 'amend':
        return `Amend ${revenueLabel} agreement with ${creatorName}`;
      case 'counter':
        return `Counter ${revenueLabel} proposal from ${creatorName}`;
      default:
        return `Propose ${revenueLabel} agreement with ${creatorName}`;
    }
  });
  const submitLabel = $derived.by(() => {
    switch (mode) {
      case 'amend':
        return 'Send amendment';
      case 'counter':
        return 'Send counter';
      default:
        return 'Send proposal';
    }
  });
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
  {submitLabel}
>
  <div class="propose-form">
    <BrandSliderField
      id="propose-share"
      label="Creator share"
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
    <p class="propose-form__hint">
      {formattedShare} of post-platform {revenueLabel} revenue goes to {creatorName}.
      The remaining {Number.isInteger(100 - sharePercent) ? `${100 - sharePercent}%` : `${(100 - sharePercent).toFixed(1)}%`} stays with the org.
    </p>

    <fieldset class="propose-form__field">
      <legend class="propose-form__field-label">Soft-lock term</legend>
      <p class="propose-form__field-hint">
        How long this rate is locked before either side can amend.
      </p>
      <div
        class="propose-form__term-options"
        role="radiogroup"
        aria-label="Soft-lock term"
        data-testid="propose-term-group"
      >
        {#each termOptions as option (option.value)}
          <label class="propose-form__term-option">
            <input
              type="radio"
              name="propose-term"
              value={option.value}
              checked={termMonths === option.value}
              onchange={() => (termMonths = option.value)}
              disabled={submitting}
              data-testid="propose-term-{option.value}"
            />
            <span>{option.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="propose-form__field">
      <label class="propose-form__field-label" for="propose-note">
        Note (optional)
      </label>
      <p class="propose-form__field-hint">
        Visible to the creator. Use this to explain the rate or term.
      </p>
      <textarea
        id="propose-note"
        class="propose-form__textarea"
        bind:value={note}
        rows="3"
        maxlength="500"
        disabled={submitting}
        placeholder="e.g. Initial team agreement for season 1 content."
        data-testid="propose-note-input"
      ></textarea>
      <span class="propose-form__char-count" aria-live="polite">
        {note.length} / 500
      </span>
    </div>
  </div>
</DialogForm>

<style>
  .propose-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .propose-form__hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .propose-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: none;
    padding: 0;
    margin: 0;
  }

  .propose-form__field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .propose-form__field-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .propose-form__term-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .propose-form__term-option {
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

  .propose-form__term-option:hover {
    background: var(--color-surface-secondary);
  }

  .propose-form__term-option:has(input:checked) {
    background: var(--color-interactive-subtle);
    border-color: var(--color-interactive);
    color: var(--color-text);
  }

  .propose-form__term-option:has(input:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .propose-form__textarea {
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

  .propose-form__textarea:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-color: var(--color-border-focus);
  }

  .propose-form__char-count {
    align-self: flex-end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
