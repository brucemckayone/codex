<!--
  @component PreviewPlayer

  Preview-only video player with 30-second limit.
  Shows a call-to-action when the preview ends.

  @prop {string} contentId - Content ID for access checking
  @prop {string} [thumbnailUrl] - Thumbnail image URL
  @prop {string} title - Content title for display
  @prop {number} [previewLimit=30] - Preview duration in seconds
  @prop {boolean} [autoplay=false] - Auto-start playback

  @example
  <PreviewPlayer
    contentId="abc-123"
    thumbnailUrl="/thumbnail.jpg"
    title="Introduction to Coding"
  />
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import * as m from '$paraglide/messages';
	import { createHlsPlayer, type Hls } from '../VideoPlayer/hls';
	import type { AccessState } from './types';
	import { PREVIEW_LIMIT_SECONDS } from './types';
	import 'media-chrome';

	interface Props {
		contentId: string;
		thumbnailUrl?: string;
		title: string;
		previewLimit?: number;
		autoplay?: boolean;
	}

	const {
		contentId,
		thumbnailUrl,
		title,
		previewLimit = PREVIEW_LIMIT_SECONDS,
		autoplay = false
	}: Props = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let hlsInstance: Hls | null = null;
	let loading = $state(true);
	let errorMessage = $state('');
	let accessState = $state<AccessState>('loading');
	let previewEnded = $state(false);
	let currentTime = $state(0);

	// Get preview URL - uses a signed URL preview endpoint
	async function getPreviewUrl(): Promise<string> {
		// For preview, we'll use a placeholder that would be replaced
		// with the actual preview URL endpoint
		// In a real implementation, this would call an API like:
		// const response = await fetch(`/api/content/${contentId}/preview`);
		return ''; // Will be handled by error state for now
	}

	async function initPlayer() {
		if (!videoEl) return;

		loading = true;
		errorMessage = '';
		accessState = 'loading';

		try {
			const previewSrc = await getPreviewUrl();

			if (!previewSrc) {
				// No preview available, show locked state
				accessState = 'locked';
				loading = false;
				return;
			}

			hlsInstance = await createHlsPlayer({
				video: videoEl,
				src: previewSrc,
				onError: (msg) => {
					errorMessage = msg;
					loading = false;
					accessState = 'error';
				}
			});

			accessState = 'preview';
			loading = false;

			if (autoplay) {
				videoEl.play().catch(() => {
					// Autoplay prevented, that's fine
				});
			}
		} catch {
			errorMessage = 'Failed to load preview.';
			loading = false;
			accessState = 'error';
		}
	}

	function handleTimeUpdate() {
		if (!videoEl) return;

		currentTime = videoEl.currentTime;

		// Check if preview limit reached
		if (accessState === 'preview' && currentTime >= previewLimit) {
			endPreview();
		}
	}

	function endPreview() {
		if (!videoEl) return;

		previewEnded = true;
		videoEl.pause();
		accessState = 'locked';
	}

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleClickToPlay() {
		if (previewEnded) return;

		if (videoEl?.paused) {
			videoEl.play();
		}
	}

	onMount(() => {
		initPlayer();
	});

	onDestroy(() => {
		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
	});
</script>

<div class="preview-player">
	{#if loading}
		<div class="preview-player__placeholder" aria-hidden="true">
			{#if thumbnailUrl}
				<img
					src={thumbnailUrl}
					alt=""
					class="preview-player__thumbnail"
					loading="lazy"
				/>
			{/if}
			<div class="preview-player__loading">
				<div class="preview-player__spinner" aria-label="Loading"></div>
			</div>
		</div>
	{:else if previewEnded || accessState === 'locked'}
		<div class="preview-player__locked">
			{#if thumbnailUrl}
				<img
					src={thumbnailUrl}
					alt=""
					class="preview-player__thumbnail"
					loading="lazy"
				/>
			{/if}
			<div class="preview-player__gate">
				<div class="preview-player__gate-content">
					<div class="preview-player__preview-badge">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10"></circle>
							<polygon points="10 8 16 12 10 16 10 8"></polygon>
						</svg>
						<span>{m.player_preview_label()}</span>
					</div>
					<h2 class="preview-player__gate-title">{m.content_gate_title()}</h2>
					<p class="preview-player__gate-message">{m.player_preview_ended()}</p>
					<div class="preview-player__gate-actions">
						<a href="/library" class="preview-player__gate-button preview-player__gate-button--primary">
							{m.player_preview_cta()}
						</a>
						<a
							href="/login?redirect={encodeURIComponent(window.location.pathname)}"
							class="preview-player__gate-button preview-player__gate-button--secondary"
						>
							{m.purchase_sign_in()}
						</a>
					</div>
				</div>
			</div>
		</div>
	{:else if errorMessage}
		<div class="preview-player__error" role="alert">
			<p>{errorMessage}</p>
		</div>
	{:else}
		<div class="preview-player__wrapper">
			<media-controller
				class="preview-player__controller"
				hotkeys="noarrowleft noarrowright nospace nom nof"
				autohide="2"
			>
				<video
					bind:this={videoEl}
					slot="media"
					crossorigin="anonymous"
					playsinline
					preload="metadata"
					poster={thumbnailUrl}
					ontimeupdate={handleTimeUpdate}
				></video>

				{#if accessState === 'preview'}
					<div class="preview-player__badge" aria-hidden="true">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="12" r="10"></circle>
							<polygon points="10 8 16 12 10 16 10 8"></polygon>
						</svg>
						<span>{m.player_preview_label()}</span>
					</div>
				{/if}

				<media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>

				<media-control-bar>
					<media-play-button></media-play-button>
					<media-mute-button></media-mute-button>
					<media-time-range></media-time-range>
					<media-time-display showduration></media-time-display>
					<media-fullscreen-button></media-fullscreen-button>
				</media-control-bar>
			</media-controller>

			{#if videoEl?.paused}
				<button
					class="preview-player__play-overlay"
					aria-label="Play preview"
					onclick={handleClickToPlay}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<polygon points="5 3 19 12 5 21 5 3"></polygon>
					</svg>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.preview-player {
		position: relative;
		aspect-ratio: 16 / 9;
		background: var(--color-neutral-900);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.preview-player__placeholder,
	.preview-player__locked {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-player__thumbnail {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.preview-player__loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-overlay);
		z-index: 1;
	}

	.preview-player__spinner {
		width: var(--space-8);
		height: var(--space-8);
		border: 3px solid var(--color-border-overlay);
		border-top-color: var(--color-text-inverse);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.preview-player__gate {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-overlay);
		backdrop-filter: blur(8px);
		z-index: 2;
		padding: var(--space-6);
	}

	.preview-player__gate-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		max-width: var(--size-content-md);
	}

	.preview-player__preview-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background: var(--color-primary-500);
		color: var(--color-text-inverse);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		border-radius: var(--radius-full);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.preview-player__gate-title {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: var(--font-bold);
		color: var(--color-text-inverse);
	}

	.preview-player__gate-message {
		margin: 0;
		font-size: var(--text-base);
		color: hsl(0 0% 100% / var(--opacity-90));
	}

	.preview-player__gate-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		justify-content: center;
	}

	.preview-player__gate-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3) var(--space-5);
		font-size: var(--text-base);
		font-weight: var(--font-medium);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: background var(--duration-fast);
	}

	.preview-player__gate-button--primary {
		background: var(--color-primary-500);
		color: var(--color-text-inverse);
	}

	.preview-player__gate-button--primary:hover {
		background: var(--color-primary-600);
	}

	.preview-player__gate-button--secondary {
		background: hsl(0 0% 100% / var(--opacity-20));
		color: var(--color-text-inverse);
		border: var(--border-width) solid var(--color-border-overlay);
	}

	.preview-player__gate-button--secondary:hover {
		background: hsl(0 0% 100% / var(--opacity-30));
	}

	.preview-player__error {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-6);
		background: var(--color-error-50);
		color: var(--color-error-700);
		text-align: center;
	}

	.preview-player__wrapper {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.preview-player__controller {
		width: 100%;
		height: 100%;
		--media-control-background: var(--color-overlay);
		--media-control-hover-background: hsl(0 0% 0% / var(--opacity-90));
	}

	.preview-player__badge {
		position: absolute;
		top: var(--space-3);
		left: var(--space-3);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--color-overlay);
		color: var(--color-text-inverse);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		animation: pulse-badge 2s ease-in-out infinite;
	}

	@keyframes pulse-badge {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	.preview-player__play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		color: hsl(0 0% 100% / var(--opacity-90));
		transition: color var(--duration-fast), transform var(--duration-fast);
	}

	.preview-player__play-overlay:hover {
		color: var(--color-text-inverse);
		transform: scale(1.1);
	}

	.preview-player__play-overlay:active {
		transform: scale(0.95);
	}

	/* Dark mode */
	:global([data-theme='dark']) .preview-player__error {
		background: var(--color-error-900);
		color: var(--color-error-300);
	}
</style>
