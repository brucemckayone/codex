<!--
  @component LibraryFilters

  Filter controls for library content by type, progress, and organization.
  Shows active filters as removable chips with clear all option.

  @prop {string[]} [selectedTypes] - Selected content types
  @prop {string[]} [selectedStatus] - Selected progress statuses
  @prop {string[]} [selectedOrgs] - Selected organization IDs
  @prop {string[]} [availableTypes] - Available content types
  @prop {{id: string; name: string}[]} [availableOrgs] - Available organizations
  @prop {(types: string[]) => void} [onTypesChange] - Callback when types change
  @prop {(statuses: string[]) => void} [onStatusChange] - Callback when statuses change
  @prop {(orgs: string[]) => void} [onOrgsChange] - Callback when orgs change
  @prop {() => void} [onClearAll] - Callback to clear all filters

  @example
  <LibraryFilters
   	selectedTypes={['video']}
		onTypesChange={(types) => updateFilters({ types })}
		onClearAll={() => clearAllFilters()}
  />
-->
<script lang="ts">
	import * as m from '$paraglide/messages';

	interface Props {
		selectedTypes?: string[];
		selectedStatus?: string[];
		selectedOrgs?: string[];
		availableTypes?: string[];
		availableOrgs?: Array<{ id: string; name: string }>;
		onTypesChange?: (types: string[]) => void;
		onStatusChange?: (statuses: string[]) => void;
		onOrgsChange?: (orgs: string[]) => void;
		onClearAll?: () => void;
	}

	const {
		selectedTypes = [],
		selectedStatus = [],
		selectedOrgs = [],
		availableTypes = ['video', 'audio', 'written'],
		availableOrgs = [],
		onTypesChange,
		onStatusChange,
		onOrgsChange,
		onClearAll
	}: Props = $props();

	let typeDropdownOpen = $state(false);
	let statusDropdownOpen = $state(false);
	let orgDropdownOpen = $state(false);

	const contentTypeLabels: Record<string, string> = {
		video: m.library_filter_type_video(),
		written: m.library_filter_type_written(),
		audio: m.library_filter_type_audio()
	};

	const statusLabels: Record<string, string> = {
		not_started: m.library_filter_status_not_started(),
		in_progress: m.library_filter_status_in_progress(),
		completed: m.library_filter_status_completed()
	};

	function toggleType(type: string) {
		const newTypes = selectedTypes.includes(type)
			? selectedTypes.filter((t) => t !== type)
			: [...selectedTypes, type];
		onTypesChange?.(newTypes);
	}

	function toggleStatus(status: string) {
		const newStatus = selectedStatus.includes(status)
			? selectedStatus.filter((s) => s !== status)
			: [...selectedStatus, status];
		onStatusChange?.(newStatus);
	}

	function toggleOrg(orgId: string) {
		const newOrgs = selectedOrgs.includes(orgId)
			? selectedOrgs.filter((o) => o !== orgId)
			: [...selectedOrgs, orgId];
		onOrgsChange?.(newOrgs);
	}

	function removeType(type: string) {
		onTypesChange?.(selectedTypes.filter((t) => t !== type));
	}

	function removeStatus(status: string) {
		onStatusChange?.(selectedStatus.filter((s) => s !== status));
	}

	function removeOrg(orgId: string) {
		onOrgsChange?.(selectedOrgs.filter((o) => o !== orgId));
	}

	const hasFilters = $derived(
		selectedTypes.length > 0 || selectedStatus.length > 0 || selectedOrgs.length > 0
	);

	const activeFilterCount = $derived(
		selectedTypes.length + selectedStatus.length + selectedOrgs.length
	);
</script>

<div class="library-filters">
	<div class="library-filters__triggers">
		<!-- Type Filter -->
		<div class="library-filters__dropdown">
			<button
				class="library-filters__button"
				aria-expanded={typeDropdownOpen}
				onclick={() => {
					typeDropdownOpen = !typeDropdownOpen;
					statusDropdownOpen = false;
					orgDropdownOpen = false;
				}}
			>
				<span>{m.library_filter_type_video()}</span>
				<svg
					class="library-filters__chevron"
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
					class:library-filters__chevron--open={typeDropdownOpen}
				>
					<polyline points="6 9 12 15 18 9"></polyline>
				</svg>
			</button>
			{#if typeDropdownOpen}
				<div class="library-filters__menu">
					{#each availableTypes as type}
						<button
							class="library-filters__option"
							class:library-filters__option--selected={selectedTypes.includes(type)}
							onclick={() => toggleType(type)}
						>
							<span class="library-filters__option-label">{contentTypeLabels[type]}</span>
							{#if selectedTypes.includes(type)}
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

		<!-- Status Filter -->
		<div class="library-filters__dropdown">
			<button
				class="library-filters__button"
				aria-expanded={statusDropdownOpen}
				onclick={() => {
					statusDropdownOpen = !statusDropdownOpen;
					typeDropdownOpen = false;
					orgDropdownOpen = false;
				}}
			>
				<span>Progress</span>
				<svg
					class="library-filters__chevron"
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
					class:library-filters__chevron--open={statusDropdownOpen}
				>
					<polyline points="6 9 12 15 18 9"></polyline>
				</svg>
			</button>
			{#if statusDropdownOpen}
				<div class="library-filters__menu">
					{#each ['not_started', 'in_progress', 'completed'] as status}
						<button
							class="library-filters__option"
							class:library-filters__option--selected={selectedStatus.includes(status)}
							onclick={() => toggleStatus(status)}
						>
							<span class="library-filters__option-label">{statusLabels[status]}</span>
							{#if selectedStatus.includes(status)}
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

		<!-- Organization Filter -->
		{#if availableOrgs.length > 0}
			<div class="library-filters__dropdown">
				<button
					class="library-filters__button"
					aria-expanded={orgDropdownOpen}
					onclick={() => {
						orgDropdownOpen = !orgDropdownOpen;
						typeDropdownOpen = false;
						statusDropdownOpen = false;
					}}
				>
					<span>Organization</span>
					<svg
						class="library-filters__chevron"
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
						class:library-filters__chevron--open={orgDropdownOpen}
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>
				{#if orgDropdownOpen}
					<div class="library-filters__menu">
						{#each availableOrgs as org}
							<button
								class="library-filters__option"
								class:library-filters__option--selected={selectedOrgs.includes(org.id)}
								onclick={() => toggleOrg(org.id)}
							>
								<span class="library-filters__option-label">{org.name}</span>
								{#if selectedOrgs.includes(org.id)}
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
		{/if}
	</div>

	<!-- Active Filters -->
	{#if hasFilters}
		<div class="library-filters__active">
			{#each selectedTypes as type}
				<button
					class="library-filters__chip"
					onclick={() => removeType(type)}
					aria-label="Remove {contentTypeLabels[type]} filter"
				>
					<span class="library-filters__chip-label">{contentTypeLabels[type]}</span>
					<svg
						class="library-filters__chip-remove"
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
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
			{/each}
			{#each selectedStatus as status}
				<button
					class="library-filters__chip"
					onclick={() => removeStatus(status)}
					aria-label="Remove {statusLabels[status]} filter"
				>
					<span class="library-filters__chip-label">{statusLabels[status]}</span>
					<svg
						class="library-filters__chip-remove"
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
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
			{/each}
			{#each selectedOrgs as orgId}
				<button
					class="library-filters__chip"
					onclick={() => removeOrg(orgId)}
					aria-label="Remove {availableOrgs.find((o) => o.id === orgId)?.name ?? orgId} filter"
				>
					<span class="library-filters__chip-label">{availableOrgs.find((o) => o.id === orgId)?.name ?? orgId}</span>
					<svg
						class="library-filters__chip-remove"
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
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
			{/each}
			<button
				class="library-filters__clear-all"
				onclick={onClearAll}
			>
				{m.library_clear_filters()}
			</button>
		</div>
	{/if}
</div>

<style>
	.library-filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.library-filters__triggers {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.library-filters__dropdown {
		position: relative;
	}

	.library-filters__button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--duration-fast), background var(--duration-fast);
	}

	.library-filters__button:hover {
		border-color: var(--color-border-hover);
		background: var(--color-neutral-50);
	}

	.library-filters__button:focus-visible {
		outline: none;
		border-color: var(--color-primary-500);
		box-shadow: 0 0 0 var(--space-1) var(--color-primary-100);
	}

	.library-filters__chevron {
		transition: transform var(--duration-fast);
	}

	.library-filters__chevron--open {
		transform: rotate(180deg);
	}

	.library-filters__menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		left: 0;
		z-index: 10;
		min-width: 12rem;
		padding: var(--space-1);
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}

	.library-filters__option {
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

	.library-filters__option:hover {
		background: var(--color-neutral-100);
	}

	.library-filters__option--selected {
		background: var(--color-primary-50);
		color: var(--color-primary-700);
	}

	.library-filters__option--selected:hover {
		background: var(--color-primary-100);
	}

	.library-filters__option-label {
		text-align: left;
	}

	.library-filters__active {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.library-filters__chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--font-medium);
		color: var(--color-text);
		background: var(--color-primary-50);
		border: var(--border-width) var(--border-style) var(--color-primary-200);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: background var(--duration-fast), border-color var(--duration-fast);
	}

	.library-filters__chip:hover {
		background: var(--color-primary-100);
		border-color: var(--color-primary-300);
	}

	.library-filters__chip-label {
		line-height: 1;
	}

	.library-filters__chip-remove {
		width: 1rem;
		height: 1rem;
	}

	.library-filters__clear-all {
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-error-600);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: color var(--duration-fast), background var(--duration-fast);
	}

	.library-filters__clear-all:hover {
		color: var(--color-error-700);
		background: var(--color-error-50);
	}

	/* Dark mode */
	:global([data-theme='dark']) .library-filters__button {
		color: var(--color-text-dark);
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .library-filters__button:hover {
		border-color: var(--color-border-hover-dark);
		background: var(--color-neutral-800);
	}

	:global([data-theme='dark']) .library-filters__button:focus-visible {
		border-color: var(--color-primary-400);
		box-shadow: 0 0 0 var(--space-1) var(--color-primary-900);
	}

	:global([data-theme='dark']) .library-filters__menu {
		background: var(--color-surface-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .library-filters__option {
		color: var(--color-text-dark);
	}

	:global([data-theme='dark']) .library-filters__option:hover {
		background: var(--color-neutral-700);
	}

	:global([data-theme='dark']) .library-filters__option--selected {
		background: var(--color-primary-900);
		color: var(--color-primary-300);
	}

	:global([data-theme='dark']) .library-filters__option--selected:hover {
		background: var(--color-primary-800);
	}

	:global([data-theme='dark']) .library-filters__chip {
		background: var(--color-primary-900);
		color: var(--color-primary-300);
		border-color: var(--color-primary-700);
	}

	:global([data-theme='dark']) .library-filters__chip:hover {
		background: var(--color-primary-800);
		border-color: var(--color-primary-600);
	}

	:global([data-theme='dark']) .library-filters__clear-all {
		color: var(--color-error-400);
	}

	:global([data-theme='dark']) .library-filters__clear-all:hover {
		color: var(--color-error-300);
		background: var(--color-error-900);
	}
</style>
