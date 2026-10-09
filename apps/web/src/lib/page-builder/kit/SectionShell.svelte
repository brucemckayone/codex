<!--
  @component SectionShell

  One section's band: its anchor, its resolved type / layout / scheme / spacing
  as data attributes (the only way CSS learns them), the query container, and
  the content grid. A block's direct children sit in the content column; one
  that carries `.lp-bleed` runs edge to edge.

  SURFACE (03 §5): `.lp-surface` is the decorative layer behind the content —
  the section's background image, and the textures, shapes and glow a Style
  opts into (`styles/surfaces.css`). It is the same element in every render,
  so public and editing markup stay identical. A background image
  (`props.background`) puts the whole section on the on-media colours over a
  uniform scrim. `hero` has its own media and `cta` its own backdrop (01 A5),
  so neither takes one here. An image that fails to load leaves the section in
  its own scheme, as if none were set.

  `editing` adds the canvas's hooks — the section id and the selection mark —
  and nothing else, so public markup is untouched by the editor.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolvePageImageUrl } from '../page-images';
  import type { SectionTypeId } from './model/ids';
  import type { ResolvedSection } from './model/types';

  interface Props {
    section: ResolvedSection;
    /** The section's `props.background`: an `ImageRef` when set (01 A3). */
    background?: unknown;
    /** The page-image CDN base (`context.mediaBaseUrl`). */
    mediaBaseUrl?: string | null;
    editing?: boolean;
    selected?: boolean;
    children: Snippet;
  }

  /** Types that draw their own backdrop, so the shell never adds a second. */
  const OWN_BACKDROP: readonly SectionTypeId[] = ['hero', 'cta'];

  const {
    section,
    background,
    mediaBaseUrl = null,
    editing = false,
    selected = false,
    children,
  }: Props = $props();

  let failed = $state<string | null>(null);
  const backdrop = $derived.by(() => {
    if (OWN_BACKDROP.includes(section.type)) return null;
    const url = resolvePageImageUrl(background, 'lg', mediaBaseUrl);
    return url && url !== failed ? url : null;
  });
</script>

<section
  class="lp-section"
  id={section.anchor}
  data-lp-type={section.type}
  data-lp-layout={section.layout}
  data-lp-scheme={section.scheme}
  data-lp-spacing={section.spacing}
  data-lp-on-media={backdrop ? '' : undefined}
  data-lp-section={editing ? section.id : undefined}
  data-lp-selected={editing && selected ? '' : undefined}
>
  <div class="lp-surface" aria-hidden="true">
    {#if backdrop}
      <img
        class="lp-surface__image"
        src={backdrop}
        alt=""
        loading="lazy"
        decoding="async"
        onerror={() => (failed = backdrop)}
      />
    {/if}
  </div>
  <div class="lp-inner">{@render children()}</div>
</section>
