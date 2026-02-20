<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import * as Table from '$lib/components/ui/Table';
	import Badge from '$lib/components/ui/Badge/Badge.svelte';
	import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	/**
	 * Payment page component.
	 * Displays billing information and purchase history with pagination and filtering.
	 * Uses Svelte 5 runes for state management and progressive enhancement.
	 * @component
	 */
	let { data }: { data: PageData } = $props();

	// Get current filter status from URL
	let currentStatus = $derived($page.url.searchParams.get('status') || 'all');
	let currentPage = $derived(Math.max(1, parseInt($page.url.searchParams.get('page') || '1', 10)));

	// Map purchase status to badge variant
	function getStatusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
		switch (status) {
			case 'complete':
				return 'success';
			case 'pending':
				return 'warning';
			case 'failed':
				return 'error';
			case 'refunded':
				return 'neutral';
			default:
				return 'neutral';
		}
	}

	// Get localized status text
	function getStatusText(status: string): string {
		switch (status) {
			case 'complete':
				return m.account_payments_status_complete();
			case 'pending':
				return m.account_payments_status_pending();
			case 'failed':
				return m.account_payments_status_failed();
			case 'refunded':
				return m.account_payments_status_refunded();
			default:
				return m.account_payments_status_unknown();
		}
	}

	// Navigate to a filter status
	function setFilter(status: string) {
		const url = new URL(window.location.href);
		if (status === 'all') {
			url.searchParams.delete('status');
		} else {
			url.searchParams.set('status', status);
		}
		url.searchParams.delete('page'); // Reset to first page
		goto(url.pathname + url.search);
	}

	// Navigate to a specific page
	function goToPage(pageNum: number) {
		const url = new URL(window.location.href);
		if (pageNum === 1) {
			url.searchParams.delete('page');
		} else {
			url.searchParams.set('page', String(pageNum));
		}
		goto(url.pathname + url.search);
	}

	// Calculate total pages from pagination data
	const totalPages = $derived(
		data.purchases.pagination?.totalPages
			? Math.max(1, data.purchases.pagination.totalPages)
			: 1
	);

	// Filter links
	const filters = [
		{ key: 'all', label: m.account_payments_filter_all() },
		{ key: 'complete', label: m.account_payments_filter_complete() },
		{ key: 'pending', label: m.account_payments_filter_pending() },
		{ key: 'failed', label: m.account_payments_filter_failed() },
		{ key: 'refunded', label: m.account_payments_filter_refunded() },
	];

	// Format currency (UK pricing default)
	function formatAmount(cents: number): string {
		return new Intl.NumberFormat('en-GB', {
			style: 'currency',
			currency: 'GBP',
		}).format(cents / 100);
	}

	// Format date (UK format)
	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-GB', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}
</script>

<svelte:head>
	<title>{m.account_payments_title()} - Codex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="payment">
	<h1>{m.account_payments_title()}</h1>
	<p class="description">{m.account_payments_description()}</p>

	<!-- Billing Information Section -->
	<div class="settings-card">
		<h2>{m.account_payments_billing()}</h2>
		<p class="placeholder">{m.account_payments_none_placeholder()}</p>
	</div>

	<!-- Purchase History Section -->
	<div class="history-card">
		<div class="history-header">
			<h2>{m.account_payments_history()}</h2>

			{#if data.purchases.items && data.purchases.items.length > 0}
				<nav class="filters" aria-label="Filter by status">
					<ul class="filter-list" role="list">
						{#each filters as filter (filter.key)}
							<li>
								<a
									href="?status={filter.key === 'all' ? '' : filter.key}"
									class:active={currentStatus === filter.key}
									aria-current={currentStatus === filter.key ? 'true' : undefined}
									onclick={(e) => {
										e.preventDefault();
										setFilter(filter.key);
									}}
								>
									{filter.label}
								</a>
							</li>
						{/each}
					</ul>
				</nav>
			{/if}
		</div>

		{#if data.purchases.items && data.purchases.items.length > 0}
			<div class="table-wrapper">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.account_payments_column_date()}</Table.Head>
							<Table.Head>{m.account_payments_column_content()}</Table.Head>
							<Table.Head>{m.account_payments_column_amount()}</Table.Head>
							<Table.Head>{m.account_payments_column_status()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.purchases.items as purchase (purchase.id)}
							<Table.Row>
								<Table.Cell class="date-cell">
									{formatDate(purchase.createdAt)}
								</Table.Cell>
								<Table.Cell class="content-cell">
									<span class="content-title">{purchase.contentTitle}</span>
								</Table.Cell>
								<Table.Cell class="amount-cell">
									{formatAmount(purchase.amountCents)}
								</Table.Cell>
								<Table.Cell class="status-cell">
									<Badge variant={getStatusVariant(purchase.status)}>
										{getStatusText(purchase.status)}
									</Badge>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if totalPages > 1}
				<div class="pagination-wrapper">
					<Pagination
						currentPage={currentPage}
						totalPages={totalPages}
						onPageChange={goToPage}
					/>
				</div>
			{/if}
		{:else}
			<div class="empty-state">
				<p>{m.account_payments_none_history()}</p>
				<a href="/discover" class="discover-link">{m.account_payments_discover_link()}</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.payment h1 {
		font-family: var(--font-heading);
		font-size: var(--text-2xl);
		font-weight: var(--font-bold);
		color: var(--color-text);
		margin-bottom: var(--space-2);
	}

	.description {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		margin-bottom: var(--space-8);
	}

	.settings-card {
		padding: var(--space-6);
		border-radius: var(--radius-lg);
		background-color: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		margin-bottom: var(--space-6);
	}

	.settings-card h2 {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-bottom: var(--space-4);
	}

	.placeholder {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		line-height: var(--leading-relaxed);
	}

	.history-card {
		padding: var(--space-6);
		border-radius: var(--radius-lg);
		background-color: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
	}

	.history-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}

	@media (min-width: 640px) {
		.history-header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
	}

	.history-header h2 {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin: 0;
	}

	/* Filters */
	.filters {
		display: flex;
	}

	.filter-list {
		display: flex;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.filter-list a {
		display: block;
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text-secondary);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: var(--transition-colors);
	}

	.filter-list a:hover {
		background-color: var(--color-surface-secondary);
		color: var(--color-text);
	}

	.filter-list a.active {
		background-color: var(--color-primary-50);
		color: var(--color-primary-700);
	}

	/* Table */
	.table-wrapper {
		overflow-x: auto;
		margin-bottom: var(--space-6);
	}

	/* Cell styles - using :global since classes are passed as props to Table components */
	:global(.date-cell) {
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	:global(.content-cell) {
		font-weight: var(--font-medium);
		color: var(--color-text);
	}

	.content-title {
		display: block;
	}

	:global(.amount-cell) {
		font-weight: var(--font-medium);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	:global(.status-cell) {
		text-align: right;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: var(--space-12) var(--space-4);
	}

	.empty-state p {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		margin-bottom: var(--space-4);
	}

	.discover-link {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-primary-500);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: var(--transition-colors);
	}

	.discover-link:hover {
		background-color: var(--color-primary-50);
		color: var(--color-primary-600);
	}

	/* Pagination */
	.pagination-wrapper {
		display: flex;
		justify-content: center;
		padding-top: var(--space-4);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}

	/* Dark mode */
	:global([data-theme='dark']) .filter-list a.active {
		background-color: var(--color-primary-900);
		color: var(--color-primary-300);
	}

	:global([data-theme='dark']) .discover-link:hover {
		background-color: var(--color-primary-900);
	}
</style>
