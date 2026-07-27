<!--
  @component DraftPreviewBanner

  Marks a journey sales page that is being served as a MANAGEMENT PREVIEW rather
  than as the live page (Codex-xzwl5).

  The public load falls back to the management-gated `getCoursePagePreview` when
  no PUBLISHED page matches the slug, so an org manager sees an apparently normal
  sales page for an unpublished draft — and only a manager ever does (a
  non-manager gets a 404). Nothing said so, and the creator reported not knowing
  which they were looking at. This says so, in the one place they are looking.

  Sticky rather than fixed so it never covers the page's own content, and
  `role="status"` so it is announced without stealing focus. Colours follow the
  `warning` variant of the `Alert` primitive; the shape differs (full-bleed sticky
  bar, not a rounded box), which is why this is its own component.

  @prop status       The page's stored status — 'draft' / 'archived' read
                     differently to a creator ("not published yet" vs "taken down").
  @prop builderHref  Root-relative link back to this journey's builder, when known.
-->
<script lang="ts">
  import type { PageStatus } from '@codex/shared-types';

  interface Props {
    status: PageStatus;
    builderHref?: string | null;
  }

  const { status, builderHref = null }: Props = $props();

  const label = $derived(
    status === 'archived' ? 'Archived — not visible' : 'Draft — not published'
  );
  const detail = $derived(
    status === 'archived'
      ? 'This journey has been taken down. Only people who can manage this space can see this page.'
      : 'Only people who can manage this space can see this page. Publish it to make it public.'
  );
</script>

<aside class="draft-banner" role="status" data-status={status}>
  <span class="draft-banner__pill">{label}</span>
  <p class="draft-banner__detail">{detail}</p>
  {#if builderHref}
    <a class="draft-banner__action" href={builderHref}>Open in the builder</a>
  {/if}
</aside>

<style>
  .draft-banner {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style)
      var(--color-warning-200);
    background-color: var(--color-warning-100);
    color: var(--color-warning-700);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .draft-banner__pill {
    flex: none;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background-color: var(--color-warning-200);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .draft-banner__detail {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
  }

  .draft-banner__action {
    flex: none;
    color: inherit;
    font-weight: var(--font-medium);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
  }

  .draft-banner__action:hover {
    text-decoration-thickness: var(--border-width-thick);
  }

  .draft-banner__action:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-focus-ring);
  }

  @media (--below-md) {
    .draft-banner {
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-xs);
    }
  }
</style>
