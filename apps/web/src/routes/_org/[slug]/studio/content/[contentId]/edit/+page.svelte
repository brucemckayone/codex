<!--
  @component Studio Content Edit Page

  A draft opens in the shared content editor: Write (Codex-a6ofh.2.3), or
  Publish at `?step=publish` (Codex-a6ofh.2.4). A piece that has been live
  opens its Page and Settings tabs, its changes waiting for Update
  (Codex-a6ofh.2.5). A type the editor does not know (none the database
  allows) is said as such. Fetches content client-side to avoid
  __data.json round-trips.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { getContent } from '$lib/remote/content.remote';
  import { readFreshQuery } from '$lib/remote/query-result';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentEditor from '$lib/components/studio/editor/ContentEditor.svelte';
  import PieceReadProblem, { readProblem } from '$lib/components/studio/editor/PieceReadProblem.svelte';
  import UnknownTypeNotice from '$lib/components/studio/editor/UnknownTypeNotice.svelte';
  import { editorView, readEditorStep } from '$lib/components/studio/editor/editor-url';
  import { logReadFailure } from '$lib/components/studio/media-library/log-read-failure';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';

  let { data } = $props();

  const orgSlug = $derived(page.params.slug);
  const contentId = $derived(page.params.contentId);

  /** Bumped by Try again on a piece never read: kit drops a query whose first read failed. */
  let attempt = $state(0);
  const contentQuery = $derived.by(() => {
    void attempt;
    return getContent(contentId);
  });
  const content = $derived(contentQuery.current ?? null);

  const view = $derived(content ? editorView(content, page.url) : null);

  /**
   * Each step mounts only on a read made for this arrival at it, by any path
   * (Next, Back, Forward, a held move sent on). Each step's session starts
   * from its read, and the form seeds itself once and saves every field it
   * holds; the read's status decides autosave or Update: a read from before
   * the other step's saves would put them back, or autosave a piece since
   * published. Every arrival, and every Try again, is its own read; only
   * the latest one's answer counts, and only for the arrival it was made
   * for, so a step never mounts on another's read, not even for the flush in
   * which the address changes.
   */
  const arrival = $derived(`${contentId}|${readEditorStep(page.url)}`);
  type Outcome = { seq: number; arrival: string };
  let latestRead = 0;
  /** The read this arrival waits for. */
  let awaited = $state(0);
  let answered = $state.raw<Outcome | null>(null);
  let refused = $state.raw<Outcome | null>(null);
  /** Try again was pressed: if that read fails too, focus goes back to it. */
  let refocusOnFail = false;
  /** The query the last read was for: a new one's first read is already fresh. */
  let readQuery: typeof contentQuery | null = null;

  function readFor(query: typeof contentQuery, read: () => Promise<unknown>) {
    const seq = ++latestRead;
    const at = untrack(() => arrival);
    awaited = seq;
    const failure = (err: unknown) => {
      refused = { seq, arrival: at };
      logReadFailure('studio_content_edit.read_failed', err, { contentId: untrack(() => contentId) });
    };
    read().then(
      () => {
        if (seq !== latestRead) return;
        // Kit answers a superseded read when a later one settles, failed or
        // not: only the query's own outcome says which this was.
        if (query.error != null) return failure(query.error);
        answered = { seq, arrival: at };
        refocusOnFail = false;
      },
      (err: unknown) => {
        if (seq === latestRead) failure(err);
      }
    );
  }

  $effect(() => {
    void arrival;
    const query = contentQuery;
    untrack(() => {
      const first = query !== readQuery;
      readQuery = query;
      readFor(query, () => (first ? readFreshQuery(query) : query.refresh()));
    });
  });

  const ready = $derived(
    answered !== null && answered.seq === awaited && answered.arrival === arrival && content !== null
  );
  const failed = $derived(refused !== null && refused.seq === awaited && refused.arrival === arrival);
  /**
   * A refusal or an ended session shows as soon as the query has one; an
   * outage only once this arrival's own read has failed (`readProblem`).
   */
  const problem = $derived.by(() => {
    const kind = readProblem(contentQuery.error);
    if (kind === 'signed-out' || kind === 'gone') return kind;
    return failed ? 'outage' : null;
  });

  function tryAgain() {
    refocusOnFail = true;
    const query = contentQuery;
    // Never answered: kit drops such a query, so it is asked for anew and
    // the read above runs on the new one. Still held (it was not dropped):
    // read it here. One request either way.
    if (!query.ready) {
      attempt += 1;
      if (contentQuery !== query) return;
    }
    readFor(query, () => query.refresh());
  }

  /** On the alert's Try again, as it mounts: a retry that failed again hands focus back to it. */
  const refocusHere: Attachment<HTMLElement> = (node) => {
    if (!refocusOnFail) return;
    refocusOnFail = false;
    const active = document.activeElement;
    if (active === null || active === document.body) node.focus();
  };

  const signInHref = $derived(`/login?redirect=${encodeURIComponent(page.url.pathname + page.url.search)}`);

  const breadcrumbs = $derived([
    { label: 'Content', href: '/studio/content' },
    { label: content?.title ?? 'Edit' },
  ]);
</script>

<svelte:head>
  <title>{content ? `${m.studio_content_form_edit_title()} - ${content.title}` : 'Edit'} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if ready && view && content}
  <ContentEditor
    {content}
    step={view.step}
    liveTab={view.liveTab}
    contentType={view.contentType}
    organizationId={data.org.id}
    orgSlug={data.org.slug}
    authorName={content.creator?.name ?? data.studioUser.name}
  />
{:else}
  <div class="edit-page">
    <Breadcrumb items={breadcrumbs} />

    {#if problem}
      <PieceReadProblem
        {problem}
        {signInHref}
        ontryagain={tryAgain}
        refocus={refocusHere}
      />
    {:else if !ready || !content}
      <!-- The editor's shape (the Write canvas's column): its title, media and words. -->
      <div class="editor-skeleton">
        <Skeleton width="60%" height="var(--space-10)" />
        <Skeleton width="100%" height="var(--space-32)" />
        <Skeleton width="100%" height="var(--space-24)" />
      </div>
    {:else}
      <UnknownTypeNotice contentId={content.id} contentType={content.contentType} />
    {/if}
  </div>
{/if}

<style>
  .edit-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* The Write canvas's column (WriteCanvas: 960px). */
  .editor-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    inline-size: 100%;
    max-inline-size: var(--container-content);
    margin-inline: auto;
  }
</style>
