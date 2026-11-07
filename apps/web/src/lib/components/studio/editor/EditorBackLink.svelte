<!--
  @component EditorBackLink

  The way out of the editor, at the start of its bar (Codex-a6ofh.2.3,
  mockups W2/W5b): an arrow and its words. On a phone (W8a) the words are
  heard but not shown, as the bar has no room for them. The Write step's bar
  and a live piece's share it.

  @prop {string} href - Where it goes
  @prop {string} label - What it says
-->
<script lang="ts">
  import { ArrowLeftIcon } from '$lib/components/ui/Icon';

  interface Props {
    href: string;
    label: string;
  }

  const { href, label }: Props = $props();
</script>

<a class="editor-back" {href}>
  <ArrowLeftIcon size={16} />
  <span class="editor-back-label">{label}</span>
</a>

<style>
  .editor-back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .editor-back:hover {
    color: var(--color-text);
  }

  .editor-back:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-md) {
    .editor-back-label {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
