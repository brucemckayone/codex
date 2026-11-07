<!--
  @component LayoutBrandInputsHarness

  The org layout's brand binding (_org/[slug]/+layout.svelte), cut down to what
  Codex-q01h8 is about: `style:` directives and the two brand attributes read
  from one record, with no `style` attribute that could change on close. With
  `writeBack`, the effect the layout runs writes the record back whenever the
  brand editor is closed; without it, the harness shows the bug.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { applyLayoutBrandInputs, brandEditor } from '$lib/brand-editor';

  let { writeBack }: { writeBack: boolean } = $props();

  const brandInputVars = $derived({
    '--brand-color': '#2563EB',
    '--brand-density': '1',
    '--brand-radius': '0.5rem',
  });
  const brandInputAttributes = $derived({
    'data-org-brand': true,
    'data-org-bg': true,
  });

  $effect(() => {
    if (!writeBack || !browser || !brandEditor.isClosed) return;
    const el = document.querySelector('.org-layout') as HTMLElement | null;
    if (!el) return;
    applyLayoutBrandInputs(el, brandInputVars, brandInputAttributes);
  });
</script>

<div
  class="org-layout"
  data-org-brand={brandInputAttributes['data-org-brand'] ? '' : undefined}
  data-org-bg={brandInputAttributes['data-org-bg'] ? '' : undefined}
  style:--brand-color={brandInputVars['--brand-color']}
  style:--brand-density={brandInputVars['--brand-density']}
  style:--brand-radius={brandInputVars['--brand-radius']}
></div>
