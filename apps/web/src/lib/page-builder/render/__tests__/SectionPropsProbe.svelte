<!--
  @component SectionPropsProbe — TEST FIXTURE, not a product surface.

  A minimal section component that renders its received props into `data-*`
  attributes. `SectionRenderer.svelte.test.ts` swaps it into `SECTION_COMPONENTS`
  so "the variant / design / edit seam REACHES the component" is asserted against
  what the component actually got, rather than against a proxy.

  It exists because none of the 11 real sections branch on `variant` yet — that is
  each component work-package's job — so there is no observable rendering to
  assert on, and Codex-qcgo3 (variant absent from the props type entirely) is
  exactly the kind of regression that a proxy assertion would miss.

  Inert on purpose: it imports only the shared props type, so it stays inside the
  CE-4 PUBLIC_LIB_ROOT boundary like every other module in this tree.
-->
<script lang="ts">
  import type { SectionComponentProps } from '../section-registry';

  const { config, variant, design, editable, onEdit }: SectionComponentProps =
    $props();
</script>

<div
  data-probe="section-props"
  data-probe-variant={variant ?? '<undefined>'}
  data-probe-width={design?.width ?? '<undefined>'}
  data-probe-density={design?.density ?? '<undefined>'}
  data-probe-editable={String(editable ?? false)}
  data-probe-on-edit={typeof onEdit}
  data-probe-config-keys={Object.keys(config).join(',')}
></div>
