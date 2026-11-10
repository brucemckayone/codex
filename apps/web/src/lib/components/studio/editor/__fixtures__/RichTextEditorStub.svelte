<!--
  Stands in for the TipTap editor in jsdom, where ProseMirror can't be typed
  into: a textarea that reports what is typed as the editor reports a change.
-->
<script lang="ts">
  interface Props {
    content?: string;
    ariaLabel?: string;
    placeholder?: string;
    oninput?: (json: string) => void;
  }

  const { content = '', ariaLabel, placeholder, oninput }: Props = $props();
</script>

<textarea
  data-testid="body"
  aria-label={ariaLabel}
  {placeholder}
  value={content}
  oninput={(event) => oninput?.(event.currentTarget.value)}
></textarea>
