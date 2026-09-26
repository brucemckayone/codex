<!--
  @component ButtonRow

  The primary call to action with its optional second link and small print —
  the one place a block turns the page's state into its next step.

    buy         → the creator's label (or "Join now") to the checkout
    continue    → "Continue" to the member's dashboard; sales small print hidden
    unavailable → an explicit notice where the button would be

  The second link is navigation, not a sale, so it stays in every state.
-->
<script lang="ts">
  import { safeHref } from '../../render/safe-href';
  import type { JourneySalesContext } from '../../render/types';
  import { COPY } from '../model/copy';
  import { resolvePrimaryCta } from '../model/cta';
  import type { SectionTypeId } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import Button from './Button.svelte';
  import { editAttrs } from './edit';
  import Notice from './Notice.svelte';

  interface Props {
    context: JourneySalesContext;
    section: SectionTypeId;
    /** The creator's `ctaLabel`. */
    label?: string;
    /** The creator's `note`; shown only under a buy button. */
    note?: string;
    secondaryLabel?: string;
    secondaryHref?: string;
    edit?: BlockEdit | null;
    size?: 'md' | 'lg';
    align?: 'start' | 'center';
    class?: string;
  }

  const {
    context,
    section,
    label,
    note,
    secondaryLabel,
    secondaryHref,
    edit = null,
    size = 'lg',
    align = 'start',
    class: className,
  }: Props = $props();

  const cta = $derived(resolvePrimaryCta(context, label));
  const noteAttrs = $derived(editAttrs(section, 'note', edit));
</script>

<div class="lp-actions {className ?? ''}" data-align={align}>
  {#if cta.state === 'unavailable'}
    <Notice title={COPY.cta.unavailableTitle} body={COPY.cta.unavailableBody} />
  {/if}
  {#if cta.href || secondaryLabel}
    <div class="lp-actions__row">
      {#if cta.href}
        <Button
          href={cta.href}
          label={cta.label}
          {size}
          {section}
          field={cta.state === 'buy' ? 'ctaLabel' : undefined}
          {edit}
          name={cta.state === 'continue'
            ? `${cta.label}: ${context.course.title}`
            : undefined}
        />
      {/if}
      {#if secondaryLabel}
        <Button
          href={safeHref(secondaryHref)}
          label={secondaryLabel}
          variant="secondary"
          {size}
          {section}
          field="secondaryLabel"
          {edit}
        />
      {/if}
    </div>
  {/if}
  {#if note && cta.state === 'buy'}
    <p class="lp-actions__note" {...noteAttrs}>{note}</p>
  {/if}
</div>

<style>
  /* Alignment is one value: the `align` prop, or `--lp-actions-align` from a
     block that centres one Style's layout in CSS alone. */
  .lp-actions {
    --_align: var(--lp-actions-align, start);
    display: grid;
    gap: var(--space-3);
    justify-items: var(--_align);
    text-align: var(--_align);
  }

  .lp-actions[data-align='center'] {
    --_align: center;
  }

  .lp-actions__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: var(--_align);
    gap: var(--space-3) var(--space-5);
  }

  /* A phone-width band never shows a ragged stack: the buttons share the row,
     or each takes a full row of its own. A link-styled way in keeps its width.
     `justify-self` so the row fills its cell however the block aligns it. */
  @container (max-width: 30rem) {
    .lp-actions,
    .lp-actions__row {
      justify-self: stretch;
    }

    .lp-actions__row > :global(.lp-button) {
      flex: 1 1 auto;
    }

    .lp-actions__row > :global(.lp-button[data-variant='quiet']),
    :global(.lp[data-lp-style='bold']) .lp-actions__row > :global(.lp-button[data-variant='secondary']) {
      flex: 0 0 auto;
    }
  }

  .lp-actions__note {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }
</style>
