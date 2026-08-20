<!--
  @component ProseSection

  Editorial text block — backs `ache`, `turn` and `feel` (Codex-2pryk ·
  WP-3/WP-5), the prototype's single `prose` renderer. Variants: centered ·
  statement (oversized) · wide · twocol (heading | body). Styling in
  `../journey-sections.css`.

  SUPERSEDED — CONSOLIDATION DELETES THIS FILE. WT-1 has ported all four variants
  into the three unified public components (`render/sections/AcheSection.svelte`,
  `TurnSection.svelte`, `FeelSection.svelte`), which now honour `variant`, the
  nine design axes and the `editable`/`onEdit` seam. See the port map in
  `../journey-sections/_prose.css`.

  It is kept working rather than emptied because `render-edit/SectionRenderer`
  still renders it for the studio canvas; consolidation repoints the canvas at the
  public components and deletes this file, its siblings and the drained partials
  (contract A16).
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
</script>

{#snippet kick()}
  {#if has(props, 'kicker')}
    <EditableText tag="p" class="jp-prose__kick" field="kicker" value={text(props, 'kicker')} {editable} onEdit={edit('kicker')} />
  {/if}
{/snippet}
{#snippet heading()}
  <EditableText tag="h2" class="jp-prose__heading" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
{/snippet}
{#snippet body()}
  {#if has(props, 'body')}
    <EditableText tag="p" class="jp-prose__body" field="body" value={text(props, 'body')} {editable} onEdit={edit('body')} />
  {/if}
{/snippet}

<section class="jp-prose jp-prose--{variant}">
  {#if variant === 'twocol'}
    <div class="jp-prose__inner">
      <div>{@render kick()}{@render heading()}</div>
      <div>{@render body()}</div>
    </div>
  {:else}
    <div class="jp-prose__inner">{@render kick()}{@render heading()}{@render body()}</div>
  {/if}
</section>
