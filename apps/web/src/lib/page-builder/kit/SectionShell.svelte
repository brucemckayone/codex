<!--
  @component SectionShell

  One section's band: its anchor, its resolved type / layout / scheme / spacing
  as data attributes (the only way CSS learns them), the query container, and
  the content grid. A block's direct children sit in the content column; one
  that carries `.lp-bleed` runs edge to edge.

  `editing` adds the canvas's hooks — the section id and the selection mark —
  and nothing else, so public markup is untouched by the editor.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ResolvedSection } from './model/types';

  interface Props {
    section: ResolvedSection;
    editing?: boolean;
    selected?: boolean;
    children: Snippet;
  }

  const { section, editing = false, selected = false, children }: Props = $props();
</script>

<section
  class="lp-section"
  id={section.anchor}
  data-lp-type={section.type}
  data-lp-layout={section.layout}
  data-lp-scheme={section.scheme}
  data-lp-spacing={section.spacing}
  data-lp-section={editing ? section.id : undefined}
  data-lp-selected={editing && selected ? '' : undefined}
>
  <div class="lp-inner">{@render children()}</div>
</section>
