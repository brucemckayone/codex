<!--
  @component LibrarySort

  Sort dropdown with URL state management.
  Provides options for recently watched, recently added, and alphabetical.

  @prop {string} [value] - Current sort value
  @prop {(value: string) => void} [onChange] - Callback when sort changes

  @example
  <LibrarySort
		value={$page.url.searchParams.get('sortBy') ?? 'recently-watched'}
		onChange={(value) => updateSort(value)}
  />
-->
<script lang="ts">
	import * as m from '$paraglide/messages';

	interface Props {
		value?: string;
		onChange?: (value: string) => void;
	}

	const { value = 'recently-watched', onChange }: Props = $props();

	let isOpen = $state(false);

	const sortOptions = [
		{ value: 'recently-watched', label: m.library_sort_recent_watched() },
		{ value: 'recently-added', label: m.library_sort_recent_purchased() },
		{ value: 'title-asc', label: m.library_sort_alphabetical_az() },
		{ value: 'title-desc', label: m.library_sort_alphabetical_za() }
	];

	const selectedLabel = $derived(
		sortOptions.find((opt) => opt.value === value)?.label ?? sortOptions[0].label
	);

	function selectOption(optionValue: string) {
		onChange?.(optionValue);
		isOpen = false;
	}

	// Close dropdown when clicking outside
	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.library-sort')) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="library-sort">
	<label for="library-sort-select" class="library-sort__label">
		{m.library_sort_label()}
	</label>
	<div class="library-sort__dropdown">
		<button
			id="library-sort-select"
			class="library-sort__button"
			aria-expanded={isOpen}
			onclick={() => (isOpen = !isOpen)}
		>
			<span>{selectedLabel}</span>
			<svg
				class="library-sort__chevron"
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
				class:library-sort__chevron--open={isOpen}
			>
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</button>
		{#if isOpen}
			<div class="library-sort__menu">
				{#each sortOptions as option}
					<button
						class="library-sort__option"
						class:library-sort__option--selected={value === option.value}
						onclick={() => selectOption(option.value)}
					>
						{option.label}
						{#if value === option.value}
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
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.library-sort {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.library-sort__label {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text-secondary);
	}

	.library-sort__dropdown {
		position: relative;
	}

	.library-sort__button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-width) solid var(--color-border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--duration-fast), background var(--duration-fast);
	}

	.library-sort__button:hover {
		border-color: var(--color-border-hover);
		background: var(--color-neutral-50);
	}

	.library-sort__button:focus-visible {
		outline: none;
		border-color: var(--color-primary-500);
		box-shadow: 0 0 0 3px var(--color-primary-100);
	}

	.library-sort__chevron {
		transition: transform var(--duration-fast);
	}

	.library-sort__chevron--open {
		transform: rotate(180deg);
	}

	.library-sort__menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		z-index: 10;
		min-width: 12rem;
		padding: var(--space-1);
		background: var(--color-surface);
		border: var(--border-width) solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}

	.library-sort__option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast);
	}

	.library-sort__option:hover {
		background: var(--color-neutral-100);
	}

	.library-sort__option--selected {
		background: var(--color-primary-50);
		color: var(--color-primary-700);
	}

	.library-sort__option--selected:hover {
		background: var(--color-primary-100);
	}

	/* Dark mode */
	:global([data-theme='dark']) .library-sort__label {
		color: var(--color-text-secondary-dark);
	}

	:global([data-theme='dark']) .library-sort__button {
		color: var(--color-text-dark);
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .library-sort__button:hover {
		border-color: var(--color-border-hover-dark);
		background: var(--color-neutral-800);
	}

	:global([data-theme='dark']) .library-sort__button:focus-visible {
		border-color: var(--color-primary-400);
		box-shadow: 0 0 0 3px var(--color-primary-900);
	}

	:global([data-theme='dark']) .library-sort__menu {
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .library-sort__option {
		color: var(--color-text-dark);
	}

	:global([data-theme='dark']) .library-sort__option:hover {
		background: var(--color-neutral-700);
	}

	:global([data-theme='dark']) .library-sort__option--selected {
		background: var(--color-primary-900);
		color: var(--color-primary-300);
	}

	:global([data-theme='dark']) .library-sort__option--selected:hover {
		background: var(--color-primary-800);
	}
</style>
