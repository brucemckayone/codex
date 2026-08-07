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
    label) as bare `<span>`s; the container owns the typography and the dot
    separators. NOT for KPI/StatCard grids — those stay their own section.
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
    <div class="page-header__meta">
      {@render meta()}
    </div>
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

  /* Byte-for-byte the `.studio-rail__brand-kicker` treatment, so the rail
     reads "STUDIO / Of Blood and Bones" and the page reads "MONEY / Payouts"
     in one visual language. */
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
    color: var(--color-text-muted);
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
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* `:global` is unavoidable here — the snippet's markup is authored at the
     call site, outside this component's style scope. Keep it to this one
     separator rule; do not reach for :global for anything else. */
  .page-header__meta > :global(:not(:first-child))::before {
    content: '·';
    margin-inline-end: var(--space-2);
    color: var(--color-text-muted);
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
