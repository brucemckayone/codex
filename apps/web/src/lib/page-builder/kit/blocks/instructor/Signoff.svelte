<!--
  @component Signoff

  The guide's sign-off: their signature mark (streamed, and only when one was
  uploaded), then their name and role set in type. The mark is decorative;
  the name beneath it is what reads.
-->
<script lang="ts">
  import type { JourneySalesContext } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import { editAttrs } from '../../primitives/edit';
  import Signature from './Signature.svelte';

  interface Props {
    context: JourneySalesContext;
    name?: string;
    role?: string;
    edit?: BlockEdit | null;
  }

  const { context, name, role, edit = null }: Props = $props();

  const nameAttrs = $derived(editAttrs('instructor', 'name', edit));
  const roleAttrs = $derived(editAttrs('instructor', 'role', edit));
</script>

<div class="signoff">
  {#await context.sellPreview then preview}
    {#if preview?.signatureUrl}<Signature src={preview.signatureUrl} />{/if}
  {/await}
  {#if name}<p class="signoff__name" {...nameAttrs}>{name}</p>{/if}
  {#if role}<p class="signoff__role" {...roleAttrs}>{role}</p>{/if}
</div>

<style>
  .signoff {
    display: grid;
    justify-items: var(--signoff-align, start);
    gap: var(--space-1);
  }

  /* Nothing to sign with: no empty row in the block's rhythm. */
  .signoff:empty {
    display: none;
  }

  .signoff :global(.sig) {
    margin-block-end: var(--space-2);
  }

  .signoff__name,
  .signoff__role {
    margin: 0;
  }

  .signoff__name {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    color: var(--lp-ink);
  }

  .signoff__role {
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    color: var(--lp-ink-soft);
  }
</style>
