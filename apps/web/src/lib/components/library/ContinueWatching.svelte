<!--
  @component ContinueWatching

  Displays up to 4 in-progress content items sorted by last watched.
  Shows a section with heading and responsive card grid.
  ```svelte
  @prop {LibraryItem[]} items - Library items to filter
  @prop {number} [limit=4] - Maximum number of items to display

  @example
  <ContinueWatching
   	items={libraryData}
		limit={4}
  />
  ```
-->
<script lang="ts">
	import * as m from '$paraglide/messages';
	import ContinueWatchingCard from './ContinueWatchingCard.svelte';
	import type { LibraryItem } from '$lib/collections/library';

	interface Props {
		items: LibraryItem[];
		limit?: number;
	}

	const { items, limit = 4 }: Props = $props();

	const inProgressItems = $derived(
		items
			.filter((item) => item.progress && !item.progress.completed)
			.sort((a, b) => {
				const aTime = a.progress?.updatedAt ?? '';
				const bTime = b.progress?.updatedAt ?? '';
				return bTime.localeCompare(aTime);
			})
			.slice(0, limit)
	);

	const showSection = $derived(inProgressItems.length > 0);
</script>

{#if showSection}
	<section class="continue-watching">
		<h2 class="continue-watching__title">{m.library_continue_watching()}</h2>
		<div class="continue-watching__grid">
			{#each inProgressItems as item (item.content.id)}
				<ContinueWatchingCard {item} />
			{/each}
		</div>
	</section>
{/if}

<style>
	.continue-watching {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.continue-watching__title {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--font-bold);
		color: var(--color-text);
	}

	.continue-watching__grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
	}

	/* Tablet */
	@media (min-width: 640px) {
		.continue-watching__grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	/* Desktop */
	@media (min-width: 1024px) {
		.continue-watching__grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	/* Dark mode */
	:global([data-theme='dark']) .continue-watching__title {
		color: var(--color-text-dark);
	}
</style>
