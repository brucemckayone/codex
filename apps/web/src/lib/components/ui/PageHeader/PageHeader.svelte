<!--
  @component PageHeader

  The masthead for a studio (or creators-studio) destination. One component,
  four expressive slots — enough that no page needs to hand-roll a `<header>`.

  Renders BOTH inside `.org-layout` (org studio) and outside it
  (`creators.lvh.me/studio/*` has no `[data-org-brand]` ancestor), so every
  token consumed here must be `:root`-guaranteed. That is why the title reads
  `var(--color-heading, var(--color-text))`: `--color-heading` is declared only
  under `[data-org-brand]`. Writing a bare `color: var(--color-text)` instead
  would be the inverse trap — after Svelte scoping the selector ties
  `[data-org-brand] [class*='__title']` and wins on source order, silently
  defeating the brand editor's heading colour.

  @prop {string} title - The page title.
  @prop {string} [kicker] - Section wayfinding above the title (e.g. "Money").
    Rendered with the same treatment as the sidebar rail's brand kicker so the
    rail and the page read as one language. Without `kickerHref` it carries a
    brand-coloured rule and means "you are here".
  @prop {string} [kickerHref] - Turns the kicker into a back link (chevron
    instead of the rule). For pages nested below a top-level destination.
  @prop {string} [description] - A LEDE: one to two full sentences saying what
    the page is for. Not microcopy. Capped at `--measure-lede`.
  @prop {Snippet} [meta] - Lightweight inline facts (counts, status, period
    label). The container is a `<ul>`, so the snippet MUST emit `<li>`s — one
    per fact. That is not decoration: the dot separator between facts is a
    CSS-generated glyph, and generated content conveys nothing to the
    accessibility tree, so without list semantics two adjacent facts read as
    one run of text ("4 members Last 30 days"). The container owns the
    typography and the separators; the `<li>`s carry only content.
    NOT for KPI/StatCard grids — those stay their own section.
  @prop {Snippet} [actions] - Buttons for the header row.
  @prop {'default'|'compact'} [variant='default'] - `compact` is for pages
    nested below a top-level studio destination: smaller title, no hairline —
    and, because such a page sits under a layout that already owns the `<h1>`,
    its title defaults to an `<h2>`.
  @prop {1|2} [headingLevel] - Explicit override for the title element.
    Defaults to `2` when `variant="compact"`, otherwise `1`. Exactly one `<h1>`
    per document: if a layout renders a PageHeader, its child routes must not
    render a second level-1 one.
  @prop {boolean} [divider=true] - Whether the header draws its own closing
    hairline. Pass `false` when the element immediately below owns a rule of
    its own — a tab track, for instance — so the two do not stack.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { ChevronLeftIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLElement> {
    title: string;
    kicker?: string;
    kickerHref?: string;
    description?: string;
    meta?: Snippet;
    actions?: Snippet;
    variant?: 'default' | 'compact';
    headingLevel?: 1 | 2;
    divider?: boolean;
  }

  const {
    title,
    kicker,
    kickerHref,
    description,
    meta,
    actions,
    variant = 'default',
    headingLevel,
    divider = true,
    class: className,
    ...restProps
  }: Props = $props();

  const titleTag = $derived(
    (headingLevel ?? (variant === 'compact' ? 2 : 1)) === 2 ? 'h2' : 'h1'
  );
</script>

<header
  class="page-header {className ?? ''}"
  data-variant={variant}
  data-divider={divider ? 'true' : 'false'}
  {...restProps}
>
  <div class="page-header__lead">
    <div class="page-header__text">
      {#if kicker}
        {#if kickerHref}
          <a class="page-header__kicker page-header__kicker--link" href={kickerHref}>
            <ChevronLeftIcon size={12} />
            {kicker}
          </a>
        {:else}
          <p class="page-header__kicker">{kicker}</p>
        {/if}
      {/if}
      <svelte:element this={titleTag} class="page-header__title">{title}</svelte:element>
      {#if description}
        <p class="page-header__description">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="page-header__actions">
        {@render actions()}
      </div>
    {/if}
  </div>
  {#if meta}
    <!-- `{#if meta}` tests whether the SNIPPET was supplied, not whether it
         renders anything — every real call site guards its own contents on a
         loaded/non-empty condition, so the passed-but-empty case is the
         common one. `.page-header__meta:empty` collapses it. -->
    <ul class="page-header__meta">
      {@render meta()}
    </ul>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block-end: var(--space-5);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
  }

  .page-header[data-variant='compact'] {
    gap: var(--space-2);
    padding-block-end: 0;
    border-block-end: none;
  }

  .page-header[data-divider='false'] {
    padding-block-end: 0;
    border-block-end: none;
  }

  .page-header__lead {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .page-header__lead {
      flex-direction: row;
      /* flex-start, NOT center: with a kicker + title + lede + meta stack,
         centring parks the action buttons in mid-air. */
      align-items: flex-start;
      justify-content: space-between;
    }
  }

  .page-header__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* The `.studio-rail__brand-kicker` treatment, so the rail reads
     "STUDIO / Of Blood and Bones" and the page reads "MONEY / Payouts" in one
     visual language — size, weight, tracking and case all match.
     The INK deliberately does not: the rail shipped `--color-text-muted`,
     which is `--color-neutral-400` in light theme and measures 2.42:1 on the
     studio content column (and 3.78:1 dark). This is 12–13px at weight 500,
     so it is not large text and 4.5:1 applies — muted fails both themes.
     `--color-text-secondary` measures 7.49:1 light / 12.09:1 dark on the
     platform, and 8.66:1 / 5.86:1 on an org background after the
     [data-org-bg] derivation fix. It still reads quiet, because the size,
     weight, tracking and uppercase treatment already do that work. */
  .page-header__kicker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    color: var(--color-text-secondary);
  }

  /* The one place brand ink enters studio chrome. A decorative rule carries no
     contrast requirement, which matters because --color-brand-primary is
     arbitrary user input and cannot be trusted as text at --text-xs
     (#E11D48 on white is ≈4.4:1). */
  .page-header__kicker:not(.page-header__kicker--link)::before {
    content: '';
    inline-size: var(--space-6);
    block-size: var(--border-width-thick);
    border-radius: var(--radius-full);
    background-color: var(--color-brand-primary);
    flex-shrink: 0;
  }

  .page-header__kicker--link {
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .page-header__kicker--link:hover {
    color: var(--color-text);
  }

  .page-header__kicker--link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-sm);
  }

  .page-header__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
    color: var(--color-heading, var(--color-text));
  }

  .page-header[data-variant='compact'] .page-header__title {
    font-size: var(--text-2xl);
  }

  .page-header__description {
    margin: 0;
    max-width: var(--measure-lede);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  .page-header[data-variant='compact'] .page-header__description {
    font-size: var(--text-sm);
  }

  .page-header__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* A `display: none` flex item leaves the layout entirely, so the parent's
     `gap` collapses with it — an empty meta row costs nothing. Svelte's
     `{#if}` anchors are comment nodes, which `:empty` ignores. */
  .page-header__meta:empty {
    display: none;
  }

  /* `:global` is unavoidable here — the snippet's markup is authored at the
     call site, outside this component's style scope. Keep it to this one
     separator rule; do not reach for :global for anything else.
     No `color` override: the dot inherits the row's own ink, which keeps the
     delimiter as legible as the facts it separates (it was
     `--color-text-muted`, 2.42:1 — a near-invisible separator). */
  .page-header__meta > :global(:not(:first-child))::before {
    content: '·';
    margin-inline-end: var(--space-2);
  }

  .page-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  @media (--breakpoint-sm) {
    .page-header__actions {
      /* Optically align to the title's cap height, not the centre of the
         whole stack. */
      margin-block-start: var(--space-1);
    }
  }
</style>
