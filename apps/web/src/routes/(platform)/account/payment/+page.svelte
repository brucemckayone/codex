<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import * as Table from '$lib/components/ui/Table';
	import Badge from '$lib/components/ui/Badge/Badge.svelte';
	import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
	import Button from '$lib/components/ui/Button/Button.svelte';
	import { Alert, Card, EmptyState } from '$lib/components/ui';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { portalSessionForm } from '$lib/remote/account.remote';

	/**
	 * Payment page component.
	 * Displays billing information and purchase history with pagination and filtering.
	 * Uses Svelte 5 runes for state management and progressive enhancement.
	 * @component
	 */
	let { data }: { data: PageData } = $props();

	// Get current filter status from URL
	let currentStatus = $derived(page.url.searchParams.get('status') || 'all');
	let currentPage = $derived(Math.max(1, parseInt(page.url.searchParams.get('page') || '1', 10)));

	// Map purchase status to badge variant
	function getStatusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
		switch (status) {
			case 'completed':
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
			case 'completed':
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
		{ key: 'completed', label: m.account_payments_filter_complete() },
		{ key: 'pending', label: m.account_payments_filter_pending() },
		{ key: 'failed', label: m.account_payments_filter_failed() },
		{ key: 'refunded', label: m.account_payments_filter_refunded() },
	];

	// Format currency (UK pricing default)
	function formatAmount(cents: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
		}).format(cents / 100);
	}

	// Format date (UK format)
	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
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
	<Card.Root>
		<Card.Header>
			<Card.Title level={2}>{m.account_payments_billing()}</Card.Title>
			<Card.Description>{m.account_payments_billing_description()}</Card.Description>
		</Card.Header>
		<Card.Content>
			<form {...portalSessionForm} class="portal-form">
				<Button type="submit" variant="secondary" loading={portalSessionForm.pending > 0}>
					{portalSessionForm.pending > 0 ? m.common_loading() : m.account_payments_manage_billing()}
				</Button>
			</form>

			{#if portalSessionForm.result?.error}
				<Alert variant="error" style="margin-top: var(--space-3)">{portalSessionForm.result.error}</Alert>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Purchase History Section -->
	<Card.Root>
		<Card.Header class="history-header">
			<Card.Title level={2}>{m.account_payments_history()}</Card.Title>

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
		</Card.Header>

		<Card.Content>
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
			<EmptyState title={m.account_payments_none_history()}>
				{#snippet action()}
					<a href="/discover" class="discover-link">{m.account_payments_discover_link()}</a>
				{/snippet}
			</EmptyState>
		{/if}
		</Card.Content>
	</Card.Root>
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

	.portal-form {
		margin-top: var(--space-4);
	}

	:global(.history-header) {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
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
		background-color: var(--color-interactive-subtle);
		color: var(--color-interactive-active);
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

	/* Empty state action */
	.discover-link {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-interactive);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: var(--transition-colors);
	}

	.discover-link:hover {
		background-color: var(--color-interactive-subtle);
		color: var(--color-interactive-hover);
	}

	.filter-list a:focus-visible,
	.discover-link:focus-visible {
		outline: var(--border-width-thick) solid var(--color-focus);
		outline-offset: 2px;
	}

	/* Pagination */
	.pagination-wrapper {
		display: flex;
		justify-content: center;
		padding-top: var(--space-4);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}

</style>
