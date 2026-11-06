<!--
  @component Studio Content Edit Page

  A draft opens in the shared content editor's Write step (Codex-a6ofh.2.3).
  Step 2 (`?step=publish`) is today's form until the Publish step replaces it
  (Codex-a6ofh.2.4), and so is a piece that has been live, whose changes wait
  for Update (Codex-a6ofh.2.5). Fetches content client-side to avoid
  __data.json round-trips.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { getContent } from '$lib/remote/content.remote';
  import { isReadOutage, readFreshQuery, remoteErrorStatus } from '$lib/remote/query-result';
  import { Button, ErrorBoundary } from '$lib/components/ui';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';
  import ContentEditor from '$lib/components/studio/editor/ContentEditor.svelte';
  import { readEditorStep, writingType } from '$lib/components/studio/editor/editor-url';
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
  const error = $derived(contentQuery.error);
  /** The session ended (the studio's guard runs on loads, not on this read): a sign-in, then back here. */
  const signedOut = $derived(remoteErrorStatus(error) === 401);
  /** Refused (deleted, not theirs, a bad link): final. Only an outage offers Try again. */
  const gone = $derived(error != null && !signedOut && !isReadOutage(error));

  const writeType = $derived(content ? writingType(content, page.url) : null);

  /**
   * Each step mounts only on a read made for this arrival at it, by any path
   * (Next, Back, Forward, a held move sent on). The form seeds itself once
   * and saves every field it holds, and the Write step's session starts from
   * its read, whose status decides autosave or Update: a read from before
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

{#if ready && writeType && content}
  <ContentEditor
    {content}
    contentType={writeType}
    organizationId={data.org.id}
    authorName={content.creator?.name ?? data.studioUser.name}
  />
{:else}
  <div class="edit-page">
    <Breadcrumb items={breadcrumbs} />

    {#if signedOut}
      <div class="error-text" role="alert">
        <p>{m.studio_editor_signed_out()}</p>
        <a class="sign-in" href={signInHref}>{m.common_sign_in()}</a>
      </div>
    {:else if gone}
      <p class="error-text" role="alert">{m.studio_editor_not_found()}</p>
    {:else if failed}
      <div class="error-text read-failed" role="alert">
        <p>{m.studio_editor_read_failed()}</p>
        <Button type="button" size="sm" variant="secondary" onclick={tryAgain} {@attach refocusHere}>
          {m.common_try_again()}
        </Button>
      </div>
    {:else if !ready || !content}
      <div class="form-skeleton">
        <div class="form-skeleton-main">
          <Skeleton width="60%" height="var(--space-10)" />
          <Skeleton width="100%" height="var(--space-32)" />
          <div class="form-skeleton-row">
            <Skeleton width="45%" height="var(--space-10)" />
            <Skeleton width="45%" height="var(--space-10)" />
          </div>
          <Skeleton width="100%" height="var(--space-24)" />
        </div>
        <div class="form-skeleton-sidebar">
          <Skeleton width="100%" height="var(--space-10)" />
          <Skeleton width="100%" height="var(--space-10)" />
          <Skeleton width="60%" height="var(--space-8)" />
        </div>
      </div>
    {:else}
      <ErrorBoundary>
        <ContentForm
          {content}
          organizationId={data.org.id}
          orgSlug={data.org.slug}
        />
      </ErrorBoundary>
    {/if}
  </div>
{/if}

<style>
  .edit-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-skeleton {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (--breakpoint-md) {
    .form-skeleton {
      grid-template-columns: 2fr 1fr;
    }
  }

  .form-skeleton-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-skeleton-row {
    display: flex;
    gap: var(--space-4);
  }

  .form-skeleton-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .error-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    color: var(--color-error-700);
    font-size: var(--text-sm);
    padding: var(--space-8);
    text-align: center;
  }

  .error-text p {
    margin: 0;
  }

  .sign-in {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  .sign-in:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
