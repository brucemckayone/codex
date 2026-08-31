<!--
  @component DraftPreviewBanner

  Says, on the page itself, that this journey sales page is NOT being served the
  way a visitor gets it. Two facts, either or both:

    1. THE PAGE IS NOT LIVE (Codex-xzwl5). The public load falls back to the
       management-gated `getCoursePagePreview` when no PUBLISHED page matches the
       slug, so an org manager sees an apparently normal sales page for an
       unpublished draft — and only a manager ever does (a non-manager gets a
       404). Nothing said so, and the creator reported not knowing which they
       were looking at.
    2. THE VIEWER'S OWN ACCESS HAS BEEN SET ASIDE (O17). Under `?preview` the
       route resolves the CTA as if the viewer were anonymous, so a creator can
       finally see the button that takes the money instead of "Go to your
       dashboard". That is a real difference between this render and what the
       viewer would otherwise get, and the page has to admit it — a preview that
       silently lies in the other direction is the defect being fixed, not a fix.

  ONE COMPONENT, NOT TWO. The two facts co-occur (a creator previewing a draft
  they are entitled to is in both states at once), they belong in the same
  sentence, and they want the same sticky bar. A second banner would stack two
  of these on one page.

  Sticky rather than fixed so it never covers the page's own content, and
  `role="status"` so it is announced without stealing focus. Colours follow the
  `warning` variant of the `Alert` primitive; the shape differs (full-bleed sticky
  bar, not a rounded box), which is why this is its own component.

  @prop status       The page's stored status — 'draft' / 'archived' read
                     differently to a creator ("not published yet" vs "taken
                     down"), and 'published' means fact 2 is the whole reason
                     this bar is here.
  @prop builderHref  Root-relative link back to this journey's builder, when the
                     caller can PROVE the viewer manages this org. Never a guess:
                     see the call site in the public route.
  @prop asVisitor    Fact 2 — the CTA on this render was resolved anonymously
                     even though this viewer has access.
-->
<script lang="ts">
  import type { PageStatus } from '@codex/shared-types';

  interface Props {
    status: PageStatus;
    builderHref?: string | null;
    asVisitor?: boolean;
  }

  const { status, builderHref = null, asVisitor = false }: Props = $props();

  const label = $derived(
    status === 'archived'
      ? 'Archived — not visible'
      : status === 'published'
        ? 'Preview — as a visitor sees it'
        : 'Draft — not published'
  );

  /*
    TWO SENTENCES FROM TWO INDEPENDENT FACTS, joined into one line rather than
    stacked as two paragraphs — a creator reads a bar, not a list. The status
    sentence comes first because it is about the PAGE; the visitor sentence
    second because it is about THIS RENDER of it.

    Register follows the builder's own panel copy (O22): say what is true, then
    say what it means for the thing the creator is about to do. Never "Enter a
    title".
  */
  const detail = $derived(
    [
      status === 'archived'
        ? 'This journey has been taken down. Only people who can manage this space can see this page.'
        : status === 'draft'
          ? 'Only people who can manage this space can see this page. Publish it to make it public.'
          : 'This is the live page, opened as a preview.',
      asVisitor
        ? 'You already have access, so its buttons are showing the way in a visitor is offered rather than sending you to your dashboard. Your own access is unchanged.'
        : null,
    ]
      .filter((sentence) => sentence !== null)
      .join(' ')
  );
</script>

<aside
  class="draft-banner"
  role="status"
  data-status={status}
  data-as-visitor={asVisitor ? '' : undefined}
>
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
