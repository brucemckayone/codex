<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import { updateNotificationsForm } from '$lib/remote/account.remote';
	import Button from '$lib/components/ui/Button/Button.svelte';
	import Label from '$lib/components/ui/Label/Label.svelte';
	import Switch from '$lib/components/ui/Switch/Switch.svelte';

	/**
	 * Notification preferences page component.
	 * Uses Svelte 5 runes for state management and progressive enhancement.
	 * @component
	 */
	let { data }: { data: PageData } = $props();

	let showSuccess = $state(false);
	let successTimeout: ReturnType<typeof setTimeout> | null = null;

	// Show success message temporarily
	function showSuccessMessage() {
		showSuccess = true;
		if (successTimeout) clearTimeout(successTimeout);
		successTimeout = setTimeout(() => {
			showSuccess = false;
		}, 3000);
	}

	// Handle form completion - the form helper handles onResult internally
	$effect(() => {
		if (updateNotificationsForm.result?.success) {
			showSuccessMessage();
		}
	});
</script>

<svelte:head>
	<title>{m.account_notifications_title()} - Codex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="notifications">
	<h1>{m.account_notifications_title()}</h1>
	<p class="description">{m.account_notifications_description()}</p>

	{#if showSuccess}
		<div class="success-message" role="status" aria-live="polite">
			{m.account_notifications_save_success()}
		</div>
	{/if}

	{#if updateNotificationsForm.result?.error}
		<div class="error-message" role="alert">
			{updateNotificationsForm.result.error}
		</div>
	{/if}

	<form
		{...updateNotificationsForm}
		class="settings-card"
	>
		<h2>{m.account_notifications_email_section()}</h2>

		<!-- Marketing Emails -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailMarketing">{m.account_notifications_marketing()}</Label>
				<span class="toggle-desc">{m.account_notifications_marketing_desc()}</span>
			</div>
			<Switch
				id="emailMarketing"
				name="emailMarketing"
				checked={updateNotificationsForm.fields.emailMarketing.value()}
			/>
		</div>

		<!-- Transactional Emails -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailTransactional">{m.account_notifications_transactional()}</Label>
				<span class="toggle-desc">{m.account_notifications_transactional_desc()}</span>
			</div>
			<Switch
				id="emailTransactional"
				name="emailTransactional"
				checked={updateNotificationsForm.fields.emailTransactional.value()}
			/>
		</div>

		<!-- Weekly Digest -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailDigest">{m.account_notifications_digest()}</Label>
				<span class="toggle-desc">{m.account_notifications_digest_desc()}</span>
			</div>
			<Switch
				id="emailDigest"
				name="emailDigest"
				checked={updateNotificationsForm.fields.emailDigest.value()}
			/>
		</div>

		<div class="form-actions">
			<Button type="submit" variant="primary" loading={!!updateNotificationsForm.pending}>
				{updateNotificationsForm.pending
					? m.common_loading()
					: m.account_notifications_save_button()}
			</Button>
		</div>
	</form>
</div>

<style>
	.notifications h1 {
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

	.success-message {
		padding: var(--space-3);
		margin-bottom: var(--space-4);
		border-radius: var(--radius-md);
		background-color: var(--color-success-50);
		border: var(--border-width) var(--border-style) var(--color-success-200);
		color: var(--color-success-700);
		font-size: var(--text-sm);
	}

	.error-message {
		padding: var(--space-3);
		margin-bottom: var(--space-4);
		border-radius: var(--radius-md);
		background-color: var(--color-error-50);
		border: var(--border-width) var(--border-style) var(--color-error-200);
		color: var(--color-error-700);
		font-size: var(--text-sm);
	}

	.settings-card {
		padding: var(--space-6);
		border-radius: var(--radius-lg);
		background-color: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
	}

	.settings-card h2 {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-bottom: var(--space-6);
	}

	.toggle-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) 0;
		border-bottom: var(--border-width) var(--border-style) var(--color-border);
	}

	.toggle-row:last-of-type {
		border-bottom: none;
		padding-bottom: 0;
	}

	.toggle-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.toggle-desc {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		line-height: var(--leading-relaxed);
	}

	.form-actions {
		margin-top: var(--space-6);
		padding-top: var(--space-6);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}
</style>
