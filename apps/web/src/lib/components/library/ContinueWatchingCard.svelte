<!--
  @component ContinueWatchingCard

  Card component for continue watching section.
  Shows thumbnail with progress bar, title, and resume button.

  @prop {LibraryItem} item - Library item with content and progress data

  @example
  <ContinueWatchingCard item={libraryItem} />
-->
<script lang="ts">
	import * as m from '$paraglide/messages';
	import type { LibraryItem } from '$lib/collections/library';

	interface Props {
		item: LibraryItem;
	}

	const { item }: Props = $props();

	const progressPercent = $derived(
		item.progress && item.progress.durationSeconds > 0
			? item.progress.percentComplete ?? 0
			: 0
	);

	function formatTime(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `${h}h ${m}m`;
	}

	const remainingTime = $derived(() => {
		if (!item.progress || !item.progress.durationSeconds) return null;
		const remaining = item.progress.durationSeconds - item.progress.positionSeconds;
		return formatTime(remaining);
	});

	const timeSinceWatched = $derived(() => {
		if (!item.progress?.updatedAt) return null;
		const now = new Date();
		const updated = new Date(item.progress.updatedAt);
		const diffMs = now.getTime() - updated.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 60) return m.library_time_ago_minutes({ count: diffMins });
		if (diffHours < 24) return m.library_time_ago_hours({ count: diffHours });
		return m.library_time_ago_days({ count: diffDays });
	});
</script>

<a
	href="/content/{item.content.id}"
	class="continue-watching-card"
>
	<div class="continue-watching-card__thumbnail">
		{#if item.content.thumbnailUrl}
			<img
				src={item.content.thumbnailUrl}
				alt=""
				class="continue-watching-card__image"
				loading="lazy"
			/>
		{:else}
			<div class="continue-watching-card__placeholder"></div>
		{/if}
		<div class="continue-watching-card__progress-track">
			<div
				class="continue-watching-card__progress-fill"
				style="width: {progressPercent}%"
			></div>
		</div>
		<div class="continue-watching-card__overlay">
			<div class="continue-watching-card__play">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="currentColor"
					aria-hidden="true"
				>
					<polygon points="5 3 19 12 5 21 5 3"></polygon>
				</svg>
				<span>{m.library_resume_watching()}</span>
			</div>
		</div>
	</div>

	<div class="continue-watching-card__body">
		<h3 class="continue-watching-card__title">{item.content.title}</h3>

		<div class="continue-watching-card__meta">
			<span class="continue-watching-card__progress-text">{progressPercent}%</span>
			{#if remainingTime}
				<span class="continue-watching-card__remaining">{remainingTime} left</span>
			{/if}
		</div>

		{#if timeSinceWatched}
			<span class="continue-watching-card__watched">{timeSinceWatched}</span>
		{/if}
	</div>
</a>

<style>
	.continue-watching-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		text-decoration: none;
		color: inherit;
	}

	.continue-watching-card__thumbnail {
		position: relative;
		aspect-ratio: 16 / 9;
		background: var(--color-neutral-100);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.continue-watching-card__image {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.continue-watching-card__placeholder {
		width: 100%;
		height: 100%;
		background: var(--color-neutral-200);
	}

	.continue-watching-card__progress-track {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		height: 3px;
		background: rgba(0, 0, 0, 0.5);
	}

	.continue-watching-card__progress-fill {
		height: 100%;
		background: var(--color-primary-500);
		transition: width var(--duration-medium) var(--ease-out);
	}

	.continue-watching-card__overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0);
		transition: background var(--duration-fast);
	}

	.continue-watching-card__play {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-3);
		color: #ffffff;
		opacity: 0;
		transform: translateY(4px);
		transition: opacity var(--duration-fast), transform var(--duration-fast);
	}

	.continue-watching-card__play span {
		font-size: var(--text-xs);
		font-weight: var(--font-medium);
	}

	.continue-watching-card:hover .continue-watching-card__overlay {
		background: rgba(0, 0, 0, 0.3);
	}

	.continue-watching-card:hover .continue-watching-card__play {
		opacity: 1;
		transform: translateY(0);
	}

	.continue-watching-card__body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.continue-watching-card__title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: var(--font-semibold);
		line-height: 1.4;
		color: var(--color-text);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.continue-watching-card__meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.continue-watching-card__progress-text {
		font-weight: var(--font-medium);
		color: var(--color-primary-600);
	}

	.continue-watching-card__remaining {
		color: var(--color-text-muted);
	}

	.continue-watching-card__watched {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	/* Dark mode */
	:global([data-theme='dark']) .continue-watching-card__thumbnail {
		background: var(--color-neutral-800);
	}

	:global([data-theme='dark']) .continue-watching-card__placeholder {
		background: var(--color-neutral-700);
	}

	:global([data-theme='dark']) .continue-watching-card__title {
		color: var(--color-text-dark);
	}

	:global([data-theme='dark']) .continue-watching-card__meta,
	:global([data-theme='dark']) .continue-watching-card__remaining,
	:global([data-theme='dark']) .continue-watching-card__watched {
		color: var(--color-text-secondary-dark);
	}

	:global([data-theme='dark']) .continue-watching-card__progress-text {
		color: var(--color-primary-400);
	}
</style>
