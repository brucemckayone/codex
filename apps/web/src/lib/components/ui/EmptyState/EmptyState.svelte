<!--
  @component EmptyState

  The "nothing here yet" panel. On the money surfaces the empty state IS the
  primary state — two of three seeded orgs have zero subscribers, none has a
  revenue-share agreement — so it earns a variant that can carry real weight
  rather than reading as a caption floating in a wide card.

  @prop {string} title
  @prop {string} [description]
  @prop {Component} [icon]
  @prop {Snippet} [action]
  @prop {'md'|'lg'} [size='md'] - `lg` promotes the title to `--text-xl` at full
    `--color-text` and widens the prose measure. OPT-IN: `md` is byte-identical
    to the pre-variant component, so the ~25 existing consumers are untouched.
  @prop {2|3|4} [headingLevel=3] - Level for the title. Defaults to 3, which is
    what this component hardcoded before, so every existing consumer renders
    unchanged. Pass 2 when the empty state is the page's only content under an
    `<h1>` — a promoted `size="lg"` title is visually a primary heading, and an
    h1 → h3 outline skips a level (WCAG 1.3.1). Mirrors `ui/PageHeader` and
    `agreements/AgreementCard`, which expose the same seam for the same reason.
-->
<script lang="ts">
  import type { Snippet, Component } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    icon?: Component<{ size?: number; 'stroke-width'?: string }>;
    action?: Snippet;
    size?: 'md' | 'lg';
    headingLevel?: 2 | 3 | 4;
    class?: string;
  }

  const {
    title,
    description,
    icon: Icon,
    action,
    size = 'md',
    headingLevel = 3,
    class: className,
  }: Props = $props();

  const titleTag = $derived(`h${headingLevel}` as 'h2' | 'h3' | 'h4');
</script>

<div class="empty-state {className ?? ''}" data-size={size}>
  {#if Icon}
    <div class="empty-state__icon">
      <Icon size={size === 'lg' ? 56 : 48} stroke-width="1" />
    </div>
  {/if}

  <svelte:element this={titleTag} class="empty-state__title">{title}</svelte:element>

  {#if description}
    <p class="empty-state__description">{description}</p>
  {/if}

  {#if action}
    <div class="empty-state__action">
      {@render action()}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-state__icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-state__title {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  /* `300px` is a hardcoded measure (violates the tokens-only rule) and, at 300px
     centred in an 1808px studio column, reads as a caption in a void. Kept as-is
     for `md` so no existing consumer shifts; `lg` states it in `ch`, which
     tracks the element's own font-size.

     `--color-text-secondary`, not `--color-text-muted` (Codex-227yr): muted
     measures 2.52:1 light / 3.19:1 dark on the platform token path and never
     clears 4.5:1 on any org, and this is real body copy — on several studio
     surfaces it is the ONLY sentence on the page. `status.css` documents the
     token as unfit for text at any size. The `lg` override below already used
     secondary, so this only changes the ~25 `md` consumers, and only upward. */
  .empty-state__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 300px;
  }

  .empty-state__action {
    margin-top: var(--space-2);
  }

  /* ── size="lg" ─────────────────────────────────────────────────────────
     A primary state, not an afterthought: the title becomes a heading rather
     than a grey label, and the prose gets a real measure. */
  .empty-state[data-size='lg'] {
    gap: var(--space-3);
    padding-block: var(--space-14);
  }

  .empty-state[data-size='lg'] .empty-state__title {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-wrap: balance;
  }

  .empty-state[data-size='lg'] .empty-state__description {
    max-width: 52ch;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  .empty-state[data-size='lg'] .empty-state__action {
    margin-top: var(--space-3);
  }
</style>
