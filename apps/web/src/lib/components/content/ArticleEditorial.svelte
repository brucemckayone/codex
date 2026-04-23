<!--
  @component ArticleEditorial

  Editorial layout for the Articles section of the org landing page.
  Lead article on the left (60% on desktop) renders as an inline spread
  — 3:2 crop, full body, excerpt, byline, CTA — while up to 4 secondary
  articles stack on the right (40%) as purpose-built rows.

  Secondary rows use a dedicated `.article-row` primitive (not the shared
  ContentCard list variant) so the sidebar shows the signals that make an
  article card usable: excerpt, byline, read-time, and a clear affordance
  that the row is clickable. ContentCard's list variant suppresses the
  description by design (see showDescription derivation), which left the
  sidebar feeling like a table of contents rather than a reading list.

  Mobile: lead stacks above rows; rows switch to a horizontal layout with
  the thumbnail on the left and copy on the right, matching the reading-
  list pattern common in content apps.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { FileTextIcon } from '$lib/components/ui/Icon';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';
  import { formatDurationHuman } from '$lib/utils/format';
  import { extractPlainText } from '@codex/validation';
  import { useAccessContext } from '$lib/utils/access-context.svelte';

  interface ArticleItem {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    thumbnailUrl?: string | null;
    contentType?: 'video' | 'audio' | 'written' | null;
    mediaItem?: {
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
    } | null;
    creator?: { name?: string | null } | null;
    priceCents?: number | null;
    accessType?: 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null;
    category?: string | null;
  }

  interface Props {
    items: ArticleItem[];
    access: ReturnType<typeof useAccessContext>;
  }

  const LIST_CAP = 4;

  const { items, access: _access }: Props = $props();

  const lead = $derived(items[0]);
  const list = $derived(items.slice(1, 1 + LIST_CAP));

  const leadHref = $derived(
    lead ? buildContentUrl(page.url, lead) : '#'
  );
  const leadThumb = $derived(
    lead?.mediaItem?.thumbnailUrl ?? lead?.thumbnailUrl ?? null
  );
  const leadDescription = $derived(
    lead?.description ? extractPlainText(lead.description) : ''
  );
  const leadDuration = $derived(lead?.mediaItem?.durationSeconds ?? null);

  function rowThumb(item: ArticleItem): string | null {
    return item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null;
  }

  function rowExcerpt(item: ArticleItem): string {
    if (!item.description) return '';
    const plain = extractPlainText(item.description);
    // Trim to ~160 chars so the 2-line clamp lands consistently regardless
    // of sentence breaks; the clamp handles final ellipsis.
    return plain.length > 160 ? plain.slice(0, 157).trimEnd() + '…' : plain;
  }

  function rowDuration(item: ArticleItem): number | null {
    return item.mediaItem?.durationSeconds ?? null;
  }
</script>

{#if lead}
  <div class="article-editorial">
    <article class="article-lead" aria-labelledby={`article-lead-${lead.id}`}>
      <a class="article-lead__link" href={leadHref}>
        <figure class="article-lead__frame">
          {#if leadThumb}
            <img
              src={leadThumb}
              srcset={getThumbnailSrcset(leadThumb)}
              sizes={DEFAULT_SIZES}
              alt=""
              class="article-lead__img"
              loading="lazy"
            />
          {:else}
            <div class="article-lead__placeholder" aria-hidden="true">
              <FileTextIcon size={48} />
            </div>
          {/if}
        </figure>

        <div class="article-lead__body">
          {#if lead.category}
            <p class="article-lead__eyebrow">{lead.category}</p>
          {/if}

          <h3 class="article-lead__title" id={`article-lead-${lead.id}`}>
            {lead.title}
          </h3>

          {#if leadDescription}
            <p class="article-lead__excerpt">{leadDescription}</p>
          {/if}

          <div class="article-lead__byline">
            {#if lead.creator?.name}
              <Avatar class="article-lead__avatar">
                <AvatarImage src={undefined} alt={lead.creator.name} />
                <AvatarFallback>
                  {lead.creator.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span class="article-lead__creator">{lead.creator.name}</span>
            {/if}
            {#if leadDuration}
              <span class="article-lead__meta-sep" aria-hidden="true">·</span>
              <span aria-label="Duration {formatDurationHuman(leadDuration)}">
                {formatDurationHuman(leadDuration)}
              </span>
            {/if}
          </div>

          <span class="article-lead__cta">
            Read now
            <span class="article-lead__cta-arrow" aria-hidden="true">→</span>
          </span>
        </div>
      </a>
    </article>

    {#if list.length > 0}
      <ol class="article-list" aria-label="More articles">
        {#each list as item (item.id)}
          {@const excerpt = rowExcerpt(item)}
          {@const thumb = rowThumb(item)}
          {@const duration = rowDuration(item)}
          <li class="article-row">
            <a class="article-row__link" href={buildContentUrl(page.url, item)}>
              <figure class="article-row__frame">
                {#if thumb}
                  <img
                    src={thumb}
                    srcset={getThumbnailSrcset(thumb)}
                    sizes="120px"
                    alt=""
                    class="article-row__img"
                    loading="lazy"
                  />
                {:else}
                  <div class="article-row__placeholder" aria-hidden="true">
                    <FileTextIcon size={24} />
                  </div>
                {/if}
              </figure>

              <div class="article-row__body">
                <div class="article-row__head">
                  <FileTextIcon size={12} class="article-row__kind-icon" />
                  <span class="article-row__kind">Article</span>
                  {#if item.category}
                    <span class="article-row__sep" aria-hidden="true">·</span>
                    <span class="article-row__category">{item.category}</span>
                  {/if}
                </div>

                <h4 class="article-row__title">{item.title}</h4>

                {#if excerpt}
                  <p class="article-row__excerpt">{excerpt}</p>
                {/if}

                <div class="article-row__meta">
                  {#if item.creator?.name}
                    <span class="article-row__author">{item.creator.name}</span>
                  {/if}
                  {#if duration}
                    {#if item.creator?.name}
                      <span class="article-row__sep" aria-hidden="true">·</span>
                    {/if}
                    <span
                      class="article-row__read-time"
                      aria-label="Reading time {formatDurationHuman(duration)}"
                    >
                      {formatDurationHuman(duration)} read
                    </span>
                  {/if}
                </div>
              </div>

              <span class="article-row__chevron" aria-hidden="true">→</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
{/if}

<style>
  .article-editorial {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    padding-inline: var(--space-4);
  }

  @media (--breakpoint-md) {
    .article-editorial {
      grid-template-columns: 1.5fr 1fr;
      gap: var(--space-8);
      padding-inline: 0;
    }
  }

  /* ── Lead article — inline spread ──────────────────────────── */

  .article-lead {
    position: relative;
    min-width: 0;
    background: color-mix(in srgb, var(--color-surface-card) 82%, transparent);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 40%, transparent);
    border-radius: var(--radius-xl);
    overflow: hidden;
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      border-color var(--duration-fast) var(--ease-default);
  }

  .article-lead:hover {
    transform: translateY(calc(-1 * var(--space-0-5)));
    box-shadow: var(--shadow-xl);
    border-color: color-mix(in srgb, var(--color-border) 80%, transparent);
  }

  .article-lead__link {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5);
    text-decoration: none;
    color: inherit;
  }

  .article-lead__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .article-lead__frame {
    position: relative;
    margin: 0;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
  }

  .article-lead__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--duration-slower) var(--ease-smooth);
  }

  .article-lead:hover .article-lead__img {
    transform: scale(1.03);
  }

  .article-lead__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
  }

  .article-lead__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .article-lead__eyebrow {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
    line-height: var(--leading-tight);
  }

  .article-lead__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    font-size: clamp(var(--text-xl), 2.6vw, var(--text-3xl));
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-lead:hover .article-lead__title {
    color: var(--color-interactive);
  }

  .article-lead__excerpt {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-lead__byline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  :global(.article-lead__avatar) {
    height: var(--space-7);
    width: var(--space-7);
    font-size: var(--text-xs);
    margin-right: var(--space-1);
  }

  .article-lead__creator {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .article-lead__meta-sep {
    opacity: var(--opacity-50);
  }

  .article-lead__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    background: transparent;
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 80%, transparent);
    border-radius: var(--radius-full);
    transition:
      background-color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .article-lead__cta-arrow {
    display: inline-block;
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .article-lead:hover .article-lead__cta {
    background: color-mix(in srgb, var(--color-text) 6%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 100%, transparent);
  }

  .article-lead:hover .article-lead__cta-arrow {
    transform: translateX(var(--space-1));
  }

  /* ── Secondary list — purpose-built article rows ────────────
     Each row is transparent by default (so the section doesn't read as a
     wall of cards), with a subtle fill on hover / focus-visible. Rows
     include excerpt, byline, and read-time so the sidebar is actually
     useful as a "more reading" surface. */

  .article-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .article-row {
    min-width: 0;
    border-bottom: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 40%, transparent);
  }

  .article-row:last-child {
    border-bottom: none;
  }

  .article-row__link {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-3);
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius-md);
    transition:
      background-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .article-row__link:hover,
  .article-row__link:focus-visible {
    background: color-mix(in srgb, var(--color-text) 4%, transparent);
  }

  .article-row__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .article-row__frame {
    position: relative;
    margin: 0;
    width: calc(var(--space-16) + var(--space-4));
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    flex-shrink: 0;
  }

  .article-row__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--duration-normal) var(--ease-smooth);
  }

  .article-row__link:hover .article-row__img {
    transform: scale(1.04);
  }

  .article-row__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-tertiary);
  }

  .article-row__body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .article-row__head {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
  }

  :global(.article-row__kind-icon) {
    margin-right: var(--space-0-5);
    color: var(--color-text-tertiary);
  }

  .article-row__category {
    text-transform: none;
    letter-spacing: var(--tracking-normal);
    font-weight: var(--font-medium);
  }

  .article-row__sep {
    opacity: var(--opacity-50);
  }

  .article-row__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    color: var(--color-text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .article-row__link:hover .article-row__title {
    color: var(--color-interactive);
  }

  .article-row__excerpt {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-row__meta {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .article-row__author {
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .article-row__chevron {
    align-self: center;
    font-size: var(--text-lg);
    color: var(--color-text-tertiary);
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-fast) var(--ease-default),
      transform var(--duration-normal) var(--ease-out),
      color var(--duration-fast) var(--ease-default);
  }

  .article-row__link:hover .article-row__chevron,
  .article-row__link:focus-visible .article-row__chevron {
    opacity: 1;
    transform: translateX(0);
    color: var(--color-interactive);
  }

  /* ── Mobile refinement ─────────────────────────────────────
     Below `md`, the editorial stacks lead above rows. Rows keep the
     horizontal thumb + body layout (better at mobile widths than the
     previous vertical collapse that orphaned thumbs above titles). */
  @media (--below-md) {
    .article-row__link {
      padding: var(--space-3) var(--space-2);
      gap: var(--space-3);
    }

    .article-row__frame {
      width: calc(var(--space-14));
    }

    .article-row__chevron {
      display: none;
    }
  }

  /* Stagger reveal on enter */
  @media (prefers-reduced-motion: no-preference) {
    .article-lead,
    .article-list .article-row {
      opacity: 0;
      transform: translateY(var(--space-3));
      animation: article-in var(--duration-slower) var(--ease-out) forwards;
    }

    .article-list .article-row:nth-child(1) { animation-delay: 80ms; }
    .article-list .article-row:nth-child(2) { animation-delay: 160ms; }
    .article-list .article-row:nth-child(3) { animation-delay: 240ms; }
    .article-list .article-row:nth-child(4) { animation-delay: 320ms; }
  }

  @keyframes article-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
