<!--
  @component VariantPicker

  The visual "options per component" picker (Codex-2pryk.3.3 · WP-5) — a faithful
  port of the prototype's `.vpick`. Each option shows a schematic thumbnail (a
  tiny abstract of the layout, built from lines + boxes), its label and a hint.
  Selecting one calls `onselect(id)`; the rail maps that to
  `pageBuilder.setSectionVariant`. Only shown when a type offers ≥2 variants.
-->
<script lang="ts">
  import type { SectionVariant } from '$lib/page-builder';

  interface Props {
    variants: readonly SectionVariant[];
    selected: string;
    onselect: (id: string) => void;
  }

  const { variants, selected, onselect }: Props = $props();
</script>

{#snippet schematic(thumb: string)}
  <span class="vp-thumb" aria-hidden="true">
    {#if thumb === 'center'}
      <i class="vp-line" style="width:70%"></i><i class="vp-line" style="width:48%"></i>
    {:else if thumb === 'minimal'}
      <i class="vp-line" style="width:44%"></i>
    {:else if thumb === 'left'}
      <i class="vp-line vp-line--start" style="width:72%"></i><i class="vp-line vp-line--start" style="width:46%"></i>
    {:else if thumb === 'statement'}
      <i class="vp-line" style="width:82%;height:6px"></i>
    {:else if thumb === 'twocol'}
      <span class="vp-row"><span class="vp-col"><i class="vp-line" style="width:90%"></i></span><span class="vp-col"><i class="vp-line" style="width:90%"></i><i class="vp-line" style="width:65%"></i></span></span>
    {:else if thumb === 'split'}
      <span class="vp-row"><span class="vp-box" style="width:34%;height:22px"></span><span class="vp-col" style="flex:1"><i class="vp-line vp-line--start" style="width:85%"></i><i class="vp-line vp-line--start" style="width:60%"></i></span></span>
    {:else if thumb === 'media'}
      <span class="vp-box" style="width:100%;height:22px"></span>
    {:else if thumb === 'banner'}
      <span class="vp-row"><span class="vp-box" style="flex:2;height:12px"></span><span class="vp-box" style="flex:1;height:12px"></span></span>
    {:else if thumb === 'card'}
      <span class="vp-box" style="width:66%;height:20px"></span>
    {:else if thumb === 'rows'}
      <i class="vp-line" style="width:100%"></i><i class="vp-line" style="width:100%"></i><i class="vp-line" style="width:100%"></i>
    {:else if thumb === 'grid'}
      <span class="vp-row"><span class="vp-box" style="flex:1;height:22px"></span><span class="vp-box" style="flex:1;height:22px"></span><span class="vp-box" style="flex:1;height:22px"></span></span>
    {:else if thumb === 'stack'}
      <span class="vp-box" style="width:100%;height:8px"></span><span class="vp-box" style="width:100%;height:8px"></span>
    {:else if thumb === 'boxes'}
      <span class="vp-box" style="width:100%;height:9px"></span><span class="vp-box" style="width:100%;height:9px"></span>
    {:else if thumb === 'spine'}
      <span class="vp-row" style="gap:6px"><span class="vp-box" style="width:3px;height:24px"></span><span class="vp-col" style="flex:1"><i class="vp-line vp-line--start" style="width:55%"></i><span class="vp-row" style="gap:3px"><span class="vp-box" style="flex:1;height:9px"></span><span class="vp-box" style="flex:1;height:9px"></span></span></span></span>
    {:else if thumb === 'accordion'}
      <span class="vp-row" style="justify-content:space-between"><i class="vp-line vp-line--start" style="width:62%"></i><span class="vp-dot"></span></span>
      <span class="vp-row" style="justify-content:space-between"><i class="vp-line vp-line--start" style="width:52%"></i><span class="vp-dot"></span></span>
    {:else if thumb === 'quote'}
      <i class="vp-line" style="width:80%;height:6px"></i><i class="vp-line" style="width:40%"></i>
    {:else}
      <i class="vp-line" style="width:60%"></i>
    {/if}
  </span>
{/snippet}

<div class="vp">
  {#each variants as v (v.id)}
    <button
      type="button"
      class="vp-opt"
      class:vp-opt--on={selected === v.id}
      aria-pressed={selected === v.id}
      onclick={() => onselect(v.id)}
    >
      {@render schematic(v.thumb)}
      <span class="vp-opt__label">{v.label}</span>
      <span class="vp-opt__hint">{v.hint}</span>
    </button>
  {/each}
</div>

<style>
  .vp {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-2);
  }

  .vp-opt {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .vp-opt:hover {
    color: var(--color-text);
    border-color: var(--color-border-hover, var(--color-border-strong));
  }

  .vp-opt:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .vp-opt--on {
    border-color: var(--color-interactive);
    color: var(--color-text);
    background-color: color-mix(in oklab, var(--color-interactive) 10%, var(--color-surface));
  }

  .vp-opt__label {
    font-weight: var(--font-medium);
  }

  /* `--color-text-secondary`, and NO font-size of its own (Codex-6nb7i).
     This hint is the only text distinguishing two options that share a
     thumbnail, so it carries meaning and cannot be the weakest ink on the
     panel: measured by canvas readback on the studio panel,
     `--color-text-muted` is 2.52:1 light / 3.19:1 dark against a 4.5 floor,
     where secondary is 7.81 / 10.21. The `font-size: 0.66rem` it used to carry
     was both a raw-literal token violation and ~10.6px — SMALLER than
     `--text-xs`, and no weight makes that WCAG large text. Inheriting
     `.vp-opt`'s `--text-xs` is the fix; the hierarchy is carried by
     `.vp-opt__label`'s weight, not by shrinking the hint below the scale. */
  .vp-opt__hint {
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  /* The SELECTED option's hint — the one string a creator re-reads to confirm
     the choice they just made — so it least of all may be muted. The
     interactive tint stays: it is what marks the selection. */
  .vp-opt--on .vp-opt__hint {
    color: color-mix(in oklab, var(--color-interactive) 55%, var(--color-text-secondary));
  }

  /* schematic thumbnail */
  .vp-thumb {
    height: 32px;
    margin-bottom: var(--space-1);
    padding: 5px 7px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    justify-content: center;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
  }

  .vp-opt--on .vp-thumb {
    border-color: color-mix(in oklab, var(--color-interactive) 32%, var(--color-border));
    background-color: color-mix(in oklab, var(--color-interactive) 6%, var(--color-surface-secondary));
  }

  /* The schematic ink is NOT decoration — it is the only thing that shows what
     each composition does, so WCAG 1.4.11's 3:1 non-text floor applies to it.
     Base moved off `--color-text-muted` for the same reason as the hint above;
     the 55% mixes below stay, because the step from line to box/dot is what
     makes the wireframe legible as a wireframe. */
  .vp-line {
    height: 3px;
    border-radius: 2px;
    margin-inline: auto;
    background-color: var(--color-text-secondary);
  }

  .vp-line--start {
    margin-inline: 0;
  }

  .vp-box {
    border-radius: 3px;
    background-color: color-mix(in oklab, var(--color-text-secondary) 55%, transparent);
  }

  .vp-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: color-mix(in oklab, var(--color-text-secondary) 55%, transparent);
  }

  .vp-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .vp-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .vp-opt--on .vp-line {
    background-color: color-mix(in oklab, var(--color-interactive) 72%, var(--color-text-secondary));
  }

  .vp-opt--on .vp-box,
  .vp-opt--on .vp-dot {
    background-color: color-mix(in oklab, var(--color-interactive) 40%, transparent);
  }
</style>
