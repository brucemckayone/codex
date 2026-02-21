<!--
  @component LibrarySearch

  Search input with debounced query updates.
  Updates URL state for shareable search links.

  @prop {string} [value] - Initial search value
  @prop {number} [delay=300] - Debounce delay in milliseconds
  @prop {(value: string) => void} [onSearch] - Callback when search changes

  @example
  <LibrarySearch
    value={$page.url.searchParams.get('q') ?? ''}
    onSearch={(value) => updateSearch(value)}
  />
-->
<script lang="ts">
	import * as m from '$paraglide/messages';

	interface Props {
		value?: string;
		delay?: number;
		onSearch?: (value: string) => void;
	}

	const { value = '', delay = 300, onSearch }: Props = $props();

	let searchValue = $state(value);
	let debouncedTimer: ReturnType<typeof setTimeout> | null = null;

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchValue = target.value;

		if (debouncedTimer) {
			clearTimeout(debouncedTimer);
		}

		debouncedTimer = setTimeout(() => {
			onSearch?.(searchValue);
		}, delay);
	}

	function handleClear() {
		searchValue = '';
		onSearch?.('');
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		// Immediate search on form submit
		if (debouncedTimer) {
			clearTimeout(debouncedTimer);
		}
		onSearch?.(searchValue);
	}

	const hasValue = $derived(searchValue.length > 0);
</script>

<form class="library-search" onsubmit={handleSubmit}>
	<label for="library-search-input" class="library-search__label">
		{m.library_search_placeholder()}
	</label>
	<div class="library-search__input-wrapper">
		<svg
			class="library-search__icon"
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
			<circle cx="11" cy="11" r="8"></circle>
			<path d="m21 21-4.35-4.35"></path>
		</svg>
		<input
			id="library-search-input"
			type="text"
			class="library-search__input"
			placeholder={m.library_search_placeholder()}
			bind:value={searchValue}
			oninput={handleInput}
			autocomplete="off"
		/>
		{#if hasValue}
			<button
				type="button"
				class="library-search__clear"
				aria-label={m.library_clear_search()}
				onclick={handleClear}
			>
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
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		{/if}
	</div>
</form>

<style>
	.library-search {
		width: 100%;
		max-width: var(--size-content-lg);
	}

	.library-search__label {
		@visually-hidden;
	}

	.library-search__input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.library-search__icon {
		position: absolute;
		left: var(--space-3);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.library-search__input {
		width: 100%;
		padding: var(--space-3) var(--space-12) var(--space-3) var(--space-10);
		font-size: var(--text-base);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
	}

	.library-search__input::placeholder {
		color: var(--color-text-muted);
	}

	.library-search__input:hover {
		border-color: var(--color-border-hover);
	}

	.library-search__input:focus-visible {
		outline: none;
		border-color: var(--color-primary-500);
		box-shadow: 0 0 0 3px var(--color-primary-100);
	}

	.library-search__clear {
		position: absolute;
		right: var(--space-2);
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--space-7);
		height: var(--space-7);
		padding: 0;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: color var(--duration-fast), background var(--duration-fast);
	}

	.library-search__clear:hover {
		color: var(--color-text);
		background: var(--color-neutral-100);
	}

	.library-search__clear:focus-visible {
		outline: none;
		background: var(--color-neutral-200);
	}

	/* Dark mode */
	:global([data-theme='dark']) .library-search__input {
		color: var(--color-text-dark);
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .library-search__input:hover {
		border-color: var(--color-border-hover-dark);
	}

	:global([data-theme='dark']) .library-search__input:focus-visible {
		border-color: var(--color-primary-400);
		box-shadow: 0 0 0 3px var(--color-primary-900);
	}

	:global([data-theme='dark']) .library-search__clear:hover {
		color: var(--color-text-dark);
		background: var(--color-neutral-700);
	}

	:global([data-theme='dark']) .library-search__clear:focus-visible {
		background: var(--color-neutral-600);
	}
</style>
