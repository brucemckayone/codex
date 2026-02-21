<script lang="ts">
	/**
	 * Content Detail Page - SSR with purchase integration
	 */
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import { Badge } from '$lib/components/ui';
	import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
	import { PurchaseCTA, PriceDisplay } from '$lib/components/commerce';
	import type { ContentWithRelations } from '$lib/types';

	interface LocalPageData extends PageData {
		content: ContentWithRelations | null;
		error: string | null;
		isPurchased: boolean;
		checkoutUrls: {
			successUrl: string;
			cancelUrl: string;
		};
	}

	const { data }: { data: LocalPageData } = $props();

	// Helper function to format duration
	function formatDuration(seconds: number | null | undefined): string {
		if (!seconds) return '';
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	}

	// Get badge variant based on content visibility
	function getVisibilityBadgeVariant(visibility: string): 'neutral' | 'success' | 'warning' | 'error' {
		switch (visibility) {
			case 'public':
				return 'success';
			case 'members_only':
				return 'warning';
			case 'purchased_only':
				return 'error';
			default:
				return 'neutral';
		}
	}

	// Get display text for content type
	function getContentTypeLabel(contentType: string): string {
		switch (contentType) {
			case 'video':
				return 'Video';
			case 'audio':
				return 'Audio';
			case 'written':
				return 'Article';
			default:
				return contentType;
		}
	}

	// Get display text for visibility
	function getVisibilityLabel(visibility: string): string {
		switch (visibility) {
			case 'public':
				return 'Public';
			case 'private':
				return 'Private';
			case 'members_only':
				return 'Members Only';
			case 'purchased_only':
				return 'Premium';
			default:
				return visibility;
		}
	}
</script>

<svelte:head>
	{#if data.content}
		<title>{data.content.title} | Codex</title>
		<meta name="description" content={data.content.description ?? `Watch ${data.content.title} on Codex`} />
		<meta property="og:title" content={data.content.title} />
		<meta property="og:description" content={data.content.description ?? `Watch ${data.content.title} on Codex`} />
		<meta property="og:type" content="video.other" />
		{#if data.content.thumbnailUrl || data.content.mediaItem?.thumbnailKey}
			<meta
				property="og:image"
				content={data.content.thumbnailUrl ?? `https://cdn.codex.io/thumbnails/${data.content.mediaItem?.thumbnailKey}`}
			/>
		{/if}
	{:else if data.error}
		<title>{data.error} | Codex</title>
	{:else}
		<title>Content Not Found | Codex</title>
	{/if}
</svelte:head>

<div class="content-detail">
	{#if data.error}
		<ErrorBanner title={m.commerce_content_unavailable()} description={data.error} />
	{:else if !data.content}
		<ErrorBanner title={m.commerce_content_unavailable()} description="This content could not be found." />
	{:else}
		<article class="content-detail__article">
			<!-- Content Header -->
			<header class="content-header">
				<div class="content-header__badges">
					<Badge variant="neutral">{getContentTypeLabel(data.content.contentType)}</Badge>
					<Badge variant={getVisibilityBadgeVariant(data.content.visibility)}>
						{getVisibilityLabel(data.content.visibility)}
					</Badge>
				</div>

				<h1 class="content-header__title">{data.content.title}</h1>

				{#if data.content.description}
					<p class="content-header__description">{data.content.description}</p>
				{/if}

				<div class="content-header__meta">
					{#if data.content.creator}
						<span class="creator-name">
							By {data.content.creator.name ?? 'Unknown Creator'}
						</span>
					{/if}
					{#if data.content.mediaItem?.durationSeconds}
						<span class="duration">
							{formatDuration(data.content.mediaItem.durationSeconds)}
						</span>
					{/if}
				</div>
			</header>

			<!-- Content Body -->
			<div class="content-body">
				<!-- Thumbnail / Preview -->
				{#if data.content.thumbnailUrl || data.content.mediaItem?.thumbnailKey}
					<div class="content-preview">
						<img
							src={data.content.thumbnailUrl ?? `https://cdn.codex.io/thumbnails/${data.content.mediaItem?.thumbnailKey}`}
							alt=""
							class="preview-image"
						/>
					</div>
				{/if}

				<!-- Purchase Section -->
				<div class="content-purchase">
					{#if data.isPurchased}
						<div class="purchased-message">
							<Badge variant="success">{m.commerce_purchased()}</Badge>
							<p>{m.commerce_already_purchased()}</p>
							<a href="/library" class="library-link">{m.commerce_go_to_library()}</a>
						</div>
					{:else}
						<div class="purchase-section">
							<div class="price-display">
								<PriceDisplay priceCents={data.content.priceCents} size="lg" />
							</div>
							<PurchaseCTA
								contentId={data.content.id}
								priceCents={data.content.priceCents}
								successUrl={data.checkoutUrls.successUrl}
								cancelUrl={data.checkoutUrls.cancelUrl}
								size="lg"
							/>
						</div>
					{/if}
				</div>
			</div>

			<!-- Additional Info -->
			{#if data.content.category || (data.content.tags && data.content.tags.length > 0)}
				<footer class="content-footer">
					{#if data.content.category}
						<div class="content-category">
							<span class="footer-label">Category:</span>
							<span class="footer-value">{data.content.category}</span>
						</div>
					{/if}
					{#if data.content.tags && data.content.tags.length > 0}
						<div class="content-tags">
							<span class="footer-label">Tags:</span>
							<div class="tags-list">
								{#each data.content.tags as tag}
									<Badge variant="neutral">{tag}</Badge>
								{/each}
							</div>
						</div>
					{/if}
				</footer>
			{/if}
		</article>
	{/if}
</div>

<style>
	.content-detail {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
	}

	.content-detail__article {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	/* Header */
	.content-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.content-header__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.content-header__title {
		font-family: var(--font-heading);
		font-size: var(--text-3xl);
		font-weight: var(--font-bold);
		line-height: var(--leading-tight);
		color: var(--color-text);
		margin: 0;
	}

	@media (min-width: 768px) {
		.content-header__title {
			font-size: var(--text-4xl);
		}
	}

	.content-header__description {
		font-size: var(--text-lg);
		line-height: var(--leading-relaxed);
		color: var(--color-text-secondary);
		margin: 0;
	}

	.content-header__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.creator-name {
		font-weight: var(--font-medium);
		color: var(--color-text);
	}

	.duration {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	/* Body */
	.content-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.content-preview {
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-surface-secondary);
	}

	.preview-image {
		width: 100%;
		height: auto;
		display: block;
	}

	/* Purchase Section */
	.content-purchase {
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
	}

	.purchased-message {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		text-align: center;
	}

	.purchased-message p {
		font-size: var(--text-base);
		color: var(--color-text-secondary);
		margin: 0;
	}

	.library-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3) var(--space-6);
		background: var(--color-primary-500);
		color: white;
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: var(--font-medium);
		transition: var(--transition-colors);
		align-self: center;
	}

	.library-link:hover {
		background: var(--color-primary-600);
	}

	.purchase-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		align-items: center;
	}

	.price-display {
		text-align: center;
	}

	/* Footer */
	.content-footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-top: var(--space-6);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}

	.content-category,
	.content-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.footer-label {
		font-weight: var(--font-medium);
		color: var(--color-text-secondary);
	}

	.footer-value {
		color: var(--color-text);
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* Responsive */
	@media (min-width: 768px) {
		.content-body {
			flex-direction: row;
			align-items: flex-start;
		}

		.content-preview {
			flex: 1;
		}

		.content-purchase {
			flex: 0 0 320px;
			position: sticky;
			top: var(--space-4);
		}

		.purchase-section {
			align-items: stretch;
		}

		.price-display {
			text-align: left;
		}
	}

	/* Dark mode */
	[data-theme='dark'] .content-header__title,
	[data-theme='dark'] .creator-name,
	[data-theme='dark'] .footer-value {
		color: var(--color-text-dark);
	}

	[data-theme='dark'] .content-header__description,
	[data-theme='dark'] .content-header__meta,
	[data-theme='dark'] .purchased-message p,
	[data-theme='dark'] .footer-label {
		color: var(--color-text-secondary-dark);
	}

	[data-theme='dark'] .content-purchase {
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	[data-theme='dark'] .content-preview {
		background: var(--color-surface-variant);
	}

	[data-theme='dark'] .content-footer {
		border-color: var(--color-border-dark);
	}
</style>
