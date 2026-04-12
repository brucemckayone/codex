<script lang="ts">
	let { data } = $props();
	let unsubscribed = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function handleUnsubscribe() {
		loading = true;
		error = null;
		try {
			const response = await fetch(`/api/unsubscribe/${data.token}`, {
				method: 'POST'
			});
			const result = await response.json();
			if (result.success) {
				unsubscribed = true;
			} else {
				error = result.error || 'Something went wrong';
			}
		} catch {
			error = 'Failed to process your request. Please try again.';
		} finally {
			loading = false;
		}
	}

	const categoryLabel = data.category === 'marketing' ? 'marketing emails' : 'weekly digest emails';
</script>

<svelte:head>
	<title>Unsubscribe</title>
</svelte:head>

<div class="unsubscribe-page">
	<div class="card">
		{#if !data.valid}
			<h1>Link Expired</h1>
			<p>This unsubscribe link has expired or is invalid.</p>
			<p class="hint">If you'd like to manage your email preferences, please sign in to your account.</p>
		{:else if unsubscribed}
			<h1>Unsubscribed</h1>
			<p>You've been unsubscribed from {categoryLabel}.</p>
			<p class="hint">You can re-subscribe at any time from your account settings.</p>
		{:else}
			<h1>Unsubscribe</h1>
			<p>You're about to unsubscribe from <strong>{categoryLabel}</strong>.</p>
			<p class="hint">You'll still receive important emails like receipts and security notices.</p>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button onclick={handleUnsubscribe} disabled={loading}>
				{loading ? 'Processing...' : 'Unsubscribe'}
			</button>
		{/if}
	</div>
</div>

<style>
	.unsubscribe-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--spacing-lg);
		background: var(--color-surface);
	}

	.card {
		max-width: 480px;
		width: 100%;
		padding: var(--spacing-2xl);
		background: var(--color-surface-elevated);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
		text-align: center;
	}

	h1 {
		margin: 0 0 var(--spacing-md);
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	p {
		margin: 0 0 var(--spacing-md);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.6;
	}

	.hint {
		color: var(--color-text-tertiary);
		font-size: var(--font-size-xs);
	}

	.error {
		color: var(--color-error);
	}

	button {
		display: inline-block;
		padding: var(--spacing-sm) var(--spacing-xl);
		background: var(--color-primary);
		color: var(--color-on-primary);
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		margin-top: var(--spacing-md);
	}

	button:hover {
		opacity: 0.9;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
