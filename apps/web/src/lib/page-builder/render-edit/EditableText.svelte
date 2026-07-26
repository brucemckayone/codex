<!--
  @component EditableText

  One inline-editable text node for the journey section renderers
  (Codex-2pryk.3.3 · WP-5). Renders `value` inside `tag`, driven by the
  {@link editableText} action so it is contenteditable + two-way in the builder
  canvas and plain, read-only text on the public page. The action owns
  textContent, so the element body is intentionally empty in the template.
-->
<script lang="ts">
  import { editableText } from './editable-text';

  interface Props {
    value?: string | null;
    /** The `PageSection.props` key this node reads/writes (edit target). */
    field?: string;
    editable?: boolean;
    onEdit?: (value: string) => void;
    /** Element to render as (span/h1/h2/p/blockquote…). */
    tag?: string;
    class?: string;
  }

  let {
    value = '',
    field,
    editable = false,
    onEdit,
    tag = 'span',
    class: klass,
  }: Props = $props();
</script>

<svelte:element
  this={tag}
  class={klass}
  data-field={field}
  contenteditable={editable ? 'true' : null}
  spellcheck={editable ? 'false' : null}
  use:editableText={{ value: value ?? '', editable, onEdit }}
></svelte:element>
