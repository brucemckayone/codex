<script lang="ts">
	/**
	 * Content Detail Page
	 *
	 * Displays content with video player (if accessible) or preview player.
	 * Merges server progress with local on mount for resume functionality.
	 */

	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import { mergeServerProgress } from '$lib/collections/progress';
	import VideoPlayer from '$lib/components/VideoPlayer/VideoPlayer.svelte';
	import PreviewPlayer from '$lib/components/player/PreviewPlayer.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let showPlayer = $state(false);
	let localProgress = $state(() => data.progress);

	async function hydrateProgress() {
		try {
			const merged = await mergeServerProgress(data.content.id);
			if (merged) {
				localProgress = {
					positionSeconds: merged.positionSeconds,
					durationSeconds: merged.durationSeconds,
					completed: merged.completed
				};
			}
		} catch {
			// Keep server progress if merge fails
		}
	}

	onMount(() => {
		// Merge local progress from localStorage with server progress
		hydrateProgress();
		showPlayer = true;
	});

	const contentTypeLabel = $derived(
		data.content.contentType === 'video'
			? m.content_type_video()
			: data.content.contentType === 'audio'
				? m.content_type_audio()
				: m.content_type_article()
	);

	function formatDuration(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `${h}h ${m}m`;
	}
</script>

<svelte:head>
	<title>{data.content.title} | {data.org.name}</title>
	<meta name="description" content={data.content.description ?? ''} />
	<meta property="og:title" content={data.content.title} />
	<meta
		property="og:description"
		content={data.content.description ?? 'View this content on Codex'}
	/>
	{#if data.content.thumbnailUrl}
		<meta property="og:image" content={data.content.thumbnailUrl} />
	{/if}
	<meta property="og:type" content="video.other" />
</svelte:head>

<article class="content-detail">
	<div class="content-detail__player">
		{#if showPlayer}
			{#if data.hasAccess && data.streamingUrl}
				<VideoPlayer
					src={data.streamingUrl}
					contentId={data.content.id}
					initialProgress={localProgress.positionSeconds}
					poster={data.content.thumbnailUrl ?? undefined}
				/>
			{:else}
				<PreviewPlayer
					contentId={data.content.id}
					thumbnailUrl={data.content.thumbnailUrl ?? undefined}
					title={data.content.title}
				/>
			{/if}
		{:else}
			<div class="content-detail__placeholder">
				<div class="content-detail__skeleton" aria-hidden="true"></div>
			</div>
		{/if}
	</div>

	<div class="content-detail__info">
		<div class="content-detail__meta">
			<span class="content-detail__type">{contentTypeLabel}</span>
			{#if data.content.durationSeconds}
				<span class="content-detail__duration" aria-label="{m.content_duration()}: {formatDuration(data.content.durationSeconds)}">
					{formatDuration(data.content.durationSeconds)}
				</span>
			{/if}
		</div>

		<h1 class="content-detail__title">{data.content.title}</h1>

		<div class="content-detail__org">
			<span>{m.content_by_org({ orgName: data.org.name })}</span>
		</div>

		{#if data.content.description}
			<div class="content-detail__description">
				<p>{data.content.description}</p>
			</div>
		{/if}

		{#if localProgress && !localProgress.completed}
			<div class="content-detail__progress">
				<div class="content-detail__progress-bar">
					<div
						class="content-detail__progress-fill"
						style="width: {localProgress.durationSeconds > 0 ? (localProgress.positionSeconds / localProgress.durationSeconds) * 100 : 0}%"
					></div>
				</div>
				<span class="content-detail__progress-text">
					{Math.round((localProgress.positionSeconds / localProgress.durationSeconds) * 100)}% watched
				</span>
			</div>
		{/if}

		{#if localProgress?.completed}
			<div class="content-detail__completed">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
					<polyline points="22 4 12 14.01 9 11.01"></polyline>
				</svg>
				<span>Completed</span>
			</div>
		{/if}
	</div>
</article>

<style>
	.content-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		max-width: var(--size-content-2xl);
		margin-inline: auto;
		padding: var(--space-6);
		padding-block-end: var(--space-12);
	}

	.content-detail__player {
		position: relative;
		aspect-ratio: 16 / 9;
		background: var(--color-neutral-900);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.content-detail__placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-neutral-100);
	}

	.content-detail__skeleton {
		width: 100%;
		height: 100%;
		background: linear-gradient(
			90deg,
			var(--color-neutral-100) 0%,
			var(--color-neutral-200) 50%,
			var(--color-neutral-100) 100%
		);
		background-size: 200% 100%;
		animation: skeleton-loading 1.5s ease-in-out infinite;
	}

	@keyframes skeleton-loading {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.content-detail__info {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.content-detail__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}

	.content-detail__type {
		display: inline-flex;
		align-items: center;
		padding: var(--space-1) var(--space-3);
		background: var(--color-primary-50);
		color: var(--color-primary-700);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		border-radius: var(--radius-full);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.content-detail__duration {
		display: inline-flex;
		align-items: center;
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.content-detail__title {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: var(--font-bold);
		line-height: 1.2;
		color: var(--color-text);
	}

	.content-detail__org {
		display: flex;
		align-items: center;
		font-size: var(--text-base);
		color: var(--color-text-secondary);
	}

	.content-detail__description {
		padding-block: var(--space-2);
		border-top: var(--border-width) solid var(--color-border-default);
		border-bottom: var(--border-width) solid var(--color-border-default);
	}

	.content-detail__description p {
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.content-detail__progress {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.content-detail__progress-bar {
		flex: 1;
		height: var(--space-1);
		background: var(--color-neutral-200);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.content-detail__progress-fill {
		height: 100%;
		background: var(--color-primary-500);
		transition: width var(--duration-medium) var(--ease-out);
	}

	.content-detail__progress-text {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text-secondary);
		min-width: 3.5rem;
		text-align: right;
	}

	.content-detail__completed {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-success-50);
		color: var(--color-success-700);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
	}

	/* Dark mode */
	:global([data-theme='dark']) .content-detail__player {
		background: var(--color-neutral-950);
	}

	:global([data-theme='dark']) .content-detail__placeholder {
		background: var(--color-neutral-800);
	}

	:global([data-theme='dark']) .content-detail__skeleton {
		background: linear-gradient(
			90deg,
			var(--color-neutral-800) 0%,
			var(--color-neutral-700) 50%,
			var(--color-neutral-800) 100%
		);
	}

	:global([data-theme='dark']) .content-detail__type {
		background: var(--color-primary-900);
		color: var(--color-primary-300);
	}

	:global([data-theme='dark']) .content-detail__title {
		color: var(--color-text-dark);
	}

	:global([data-theme='dark']) .content-detail__org,
	:global([data-theme='dark']) .content-detail__description p,
	:global([data-theme='dark']) .content-detail__duration,
	:global([data-theme='dark']) .content-detail__progress-text {
		color: var(--color-text-secondary-dark);
	}

	:global([data-theme='dark']) .content-detail__description {
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .content-detail__progress-bar {
		background: var(--color-neutral-700);
	}

	:global([data-theme='dark']) .content-detail__completed {
		background: var(--color-success-900);
		color: var(--color-success-300);
	}

	/* Responsive */
	@media (min-width: 768px) {
		.content-detail__title {
			font-size: var(--text-4xl);
		}
	}
</style>
