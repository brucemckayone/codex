<!--
  @component ProofSection

  Testimonials / social proof (Codex-2pryk · WP-3/WP-5). Serif quote cards with a
  decorative quote mark + gradient avatar, plus an aggregate trust cue. Variants:
  grid (three across) · stack (one column) · spotlight (one big quote). A card
  renders only when its quote is non-empty. Styling in `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
  const slots = [1, 2, 3] as const;

  function initial(n: number): string {
    return text(props, `n${n}`).trim()[0] ?? '“';
  }
</script>

<section class="jp-proof jp-proof--{variant}">
  <div class="jp-proof__inner">
    <header class="jp-proof__head">
      {#if has(props, 'eyebrow')}
        <EditableText class="jp-eyebrow" field="eyebrow" value={text(props, 'eyebrow')} {editable} onEdit={edit('eyebrow')} />
      {/if}
      <EditableText tag="h2" class="jp-proof__title" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
    </header>

    <div class="jp-proof__grid">
      {#each slots as n (n)}
        {#if has(props, `q${n}`)}
          <figure class="jp-proof-card">
            <EditableText tag="blockquote" class="jp-proof-quote" field={`q${n}`} value={text(props, `q${n}`)} {editable} onEdit={edit(`q${n}`)} />
            <figcaption class="jp-proof-who">
              <span class="jp-proof-av" aria-hidden="true">{initial(n)}</span>
              <span class="jp-proof-id">
                <EditableText class="jp-proof-name" field={`n${n}`} value={text(props, `n${n}`)} {editable} onEdit={edit(`n${n}`)} />
                <EditableText class="jp-proof-ctx" field={`c${n}`} value={text(props, `c${n}`)} {editable} onEdit={edit(`c${n}`)} />
              </span>
            </figcaption>
          </figure>
        {/if}
      {/each}
    </div>

    {#if has(props, 'trust')}
      <p class="jp-proof-trust">
        <EditableText field="trust" value={text(props, 'trust')} {editable} onEdit={edit('trust')} />
      </p>
    {/if}
  </div>
</section>
