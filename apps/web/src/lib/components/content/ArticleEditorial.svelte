<!--
  @component ArticleEditorial

  Editorial layout for the Articles section of the org landing page.
  Lead article on the left (60% on desktop) renders as an inline spread
  — 3:2 crop, full body, excerpt, byline, CTA chip — while up to 4
  secondary articles stack on the right (40%) as compact list rows.
  Mobile stacks the lead above the list.

  Secondary rows use ContentCard variant='list' so the existing article
  content-type styling (left accent stripe, text-first treatment) carries
  through without reinventing a new card primitive.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { ContentCard } from '$lib/components/ui/ContentCard';
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

  const { items, access }: Props = $props();

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
          <span class="article-lead__type-badge">Read</span>
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
              <span>{formatDurationHuman(leadDuration)}</span>
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
      <div class="article-list" aria-label="More articles">
        {#each list as item (item.id)}
          <ContentCard
            variant="list"
            id={item.id}
            title={item.title}
            thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
            description={item.description}
            contentType="article"
            duration={item.mediaItem?.durationSeconds ?? null}
            creator={item.creator?.name
              ? { username: item.creator.name, displayName: item.creator.name }
              : undefined}
            href={buildContentUrl(page.url, item)}
            price={item.priceCents != null
              ? { amount: item.priceCents, currency: 'GBP' }
              : null}
            contentAccessType={item.accessType}
            included={access.isIncluded(item)}
            isFollower={access.isFollowing}
            tierName={access.getTierName(item)}
            category={item.category ?? null}
          />
        {/each}
      </div>
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

  /* ── Secondary list ────────────────────────────────────────── */

  .article-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Tighten list-variant ContentCards inside the editorial sidebar —
     the default list thumb width (180px) is fine on its own, but here
     each row needs to fit in the ~40% sidebar without crowding the copy. */
  .article-list :global(.cc[data-variant='list']) {
    padding: var(--space-2);
  }

  .article-list :global(.cc[data-variant='list'] .cc__thumb) {
    width: calc(var(--space-20) + var(--space-2));
    min-width: calc(var(--space-20) + var(--space-2));
  }

  .article-list :global(.cc[data-variant='list'] .cc__body) {
    padding: var(--space-2) var(--space-3);
  }

  .article-list :global(.cc[data-variant='list'] .cc__title) {
    font-size: var(--text-base);
    -webkit-line-clamp: 2;
  }

  .article-list :global(.cc[data-variant='list'] .cc__description) {
    display: none;
  }

  /* Stagger reveal on enter */
  @media (prefers-reduced-motion: no-preference) {
    .article-lead,
    .article-list :global(.cc) {
      opacity: 0;
      transform: translateY(var(--space-3));
      animation: article-in var(--duration-slower) var(--ease-out) forwards;
    }

    .article-list :global(.cc:nth-child(1)) { animation-delay: 80ms; }
    .article-list :global(.cc:nth-child(2)) { animation-delay: 160ms; }
    .article-list :global(.cc:nth-child(3)) { animation-delay: 240ms; }
    .article-list :global(.cc:nth-child(4)) { animation-delay: 320ms; }
  }

  @keyframes article-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
