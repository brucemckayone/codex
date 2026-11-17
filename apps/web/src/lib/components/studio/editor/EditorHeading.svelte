<!--
  @component EditorHeading

  A settings section's heading words (Codex-a6ofh.2.4, mockup W4): its
  number, its name, and "optional" where it is. In an `EditorSection`'s
  heading, or a fold's trigger, which is a heading itself.

  @prop {number} ordinal - Its place on the screen
  @prop {string} title - Its name
  @prop {string} [id] - For the section it names (`aria-labelledby`)
  @prop {boolean} [optional] - Say it can be left
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    ordinal: number;
    title: string;
    id?: string;
    optional?: boolean;
  }

  const { ordinal, title, id, optional = false }: Props = $props();
</script>

<span class="editor-heading" {id}>
  <span class="editor-ordinal" aria-hidden="true">{ordinal}</span>
  {title}
  {#if optional}<span class="editor-optional">{m.studio_publish_optional()}</span>{/if}
</span>

<style>
  .editor-heading {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .editor-ordinal {
    display: inline-grid;
    place-items: center;
    inline-size: var(--space-6);
    block-size: var(--space-6);
    border-radius: var(--radius-full);
    background: var(--color-surface-tertiary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .editor-optional {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }
</style>
