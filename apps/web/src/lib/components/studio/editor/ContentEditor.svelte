<!--
  @component ContentEditor

  The content editor (Codex-a6ofh.2.3): one shared page for both studios, the
  org's and the personal one. Each route keeps its own read and hands this the
  piece, or null for a new one. Step 1, Write, is `WriteStep`.

  Each visit gets its own draft session. SvelteKit keeps a route's component
  across a move inside the route (/new to /new, one piece's edit to
  another's), and a session kept would go on editing the last piece, so the
  step is keyed here per visit (`editorVisit`), never left to the caller.

  @prop {ContentWithRelations | null} content - The saved piece, or null for a new one
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} [initialMediaId] - A new piece's media, from "Create content from this"
  @prop {string} authorName - Who it is by, on the meta line
-->
<script lang="ts">
  import { type ComponentProps, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button, ErrorBoundary } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import { editHref } from './editor-url';
  import { editorVisit } from './editor-visit.svelte';
  import WriteStep from './WriteStep.svelte';

  const props: ComponentProps<typeof WriteStep> = $props();

  const visit = editorVisit();

  /**
   * A new piece's history entry, once its first save made the draft, holds
   * the draft's id (`page.state`). Back or Forward to it opens the draft on
   * its own edit page, never a blank new piece, which would make a second.
   * Read once per visit: the editor's own swap sets it mid-visit, and must
   * never send the creator away.
   */
  const restoredDraft = $derived.by(() => {
    visit.key;
    return untrack(() => (props.content === null ? (page.state.editorDraftId ?? null) : null));
  });

  $effect(() => {
    if (restoredDraft) void goto(editHref(restoredDraft), { replaceState: true });
  });
</script>

{#if !restoredDraft}
  {#key visit.key}
    <ErrorBoundary>
      <WriteStep {...props} />
      <!-- A reload, never a reset in place: the step would start again from
           this visit's first props, older than what it has saved. -->
      {#snippet fallback()}
        <div class="editor-failed" role="alert">
          <p>{m.studio_editor_failed()}</p>
          <Button type="button" size="sm" onclick={() => location.reload()}>
            {m.studio_editor_reload()}
          </Button>
        </div>
      {/snippet}
    </ErrorBoundary>
  {/key}
{/if}

<style>
  .editor-failed {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    max-inline-size: 960px;
    margin: var(--space-8) auto;
    padding: var(--space-6);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    color: var(--color-text);
  }

  .editor-failed p {
    margin: 0;
  }
</style>
