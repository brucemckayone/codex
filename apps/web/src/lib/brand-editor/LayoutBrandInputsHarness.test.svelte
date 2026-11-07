<!--
  @component LayoutBrandInputsHarness

  The org layout's brand binding (_org/[slug]/+layout.svelte), cut down to what
  Codex-q01h8 is about: `style:` directives and the two brand attributes read
  from one record, with no `style` attribute that could change on close. With
  `writeBack`, it registers the layout's own write-back,
  `writeBackLayoutBrandInputs`, once at mount as the layout does; without it,
  the harness shows the bug.
-->
<script lang="ts">
  import { writeBackLayoutBrandInputs } from '$lib/brand-editor';

  const { writeBack }: { writeBack: boolean } = $props();

  const brandInputVars = $derived({
    '--brand-color': '#2563EB',
    '--brand-density': '1',
    '--brand-radius': '0.5rem',
  });
  const brandInputAttributes = $derived({
    'data-org-brand': true,
    'data-org-bg': true,
  });

  // Read once: the layout registers its write-back once, at mount.
  // svelte-ignore state_referenced_locally
  if (writeBack) {
    writeBackLayoutBrandInputs(() => brandInputVars, () => brandInputAttributes);
  }
</script>

<div
  class="org-layout"
  data-org-brand={brandInputAttributes['data-org-brand'] ? '' : undefined}
  data-org-bg={brandInputAttributes['data-org-bg'] ? '' : undefined}
  style:--brand-color={brandInputVars['--brand-color']}
  style:--brand-density={brandInputVars['--brand-density']}
  style:--brand-radius={brandInputVars['--brand-radius']}
></div>
