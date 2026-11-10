<!--
  @component UnknownTypeNotice

  An edit address for a piece whose type the editor does not know. The
  database allows only the editor's types (`check_content_type`), so only a
  schema change could bring one here: it is said plainly, and logged. Both
  studios' edit routes show it in the editor's place (Codex-a6ofh.2.10).

  @prop {string} contentId - The piece, for the log
  @prop {string} contentType - Its type as read, for the log
-->
<script lang="ts">
  import { logger } from '$lib/observability';
  import * as m from '$paraglide/messages';

  interface Props {
    contentId: string;
    contentType: string;
  }

  const { contentId, contentType }: Props = $props();

  $effect(() => {
    logger.error('studio_content_edit.unknown_type', { contentId, contentType });
  });
</script>

<p class="unknown-type" role="alert">{m.studio_editor_unknown_type()}</p>

<style>
  .unknown-type {
    margin: 0;
    padding: var(--space-8);
    font-size: var(--text-sm);
    text-align: center;
    color: var(--color-status-error-text);
  }
</style>
