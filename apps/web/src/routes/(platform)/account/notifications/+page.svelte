<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as m from '$paraglide/messages';
	import { updateNotificationsForm } from '$lib/remote/account.remote';
	import Button from '$lib/components/ui/Button/Button.svelte';
	import Label from '$lib/components/ui/Label/Label.svelte';
	import Switch from '$lib/components/ui/Switch/Switch.svelte';
	import { Alert } from '$lib/components/ui';

	// Use server-loaded preferences (no client-side fetch needed)
	let { data } = $props();
	const preferences = data.preferences;

	// Local state for Switch bindings and conditional hidden input rendering
	let marketingChecked = $state(preferences?.emailMarketing ?? true);
	let transactionalChecked = $state(preferences?.emailTransactional ?? true);
	let digestChecked = $state(preferences?.emailDigest ?? true);

	let showSuccess = $state(false);
	let successTimeout: ReturnType<typeof setTimeout> | null = null;

	function showSuccessMessage() {
		showSuccess = true;
		if (successTimeout) clearTimeout(successTimeout);
		successTimeout = setTimeout(() => (showSuccess = false), 3000);
	}

	onDestroy(() => {
		if (successTimeout) clearTimeout(successTimeout);
	});

	$effect(() => {
		if (updateNotificationsForm.result?.success && !updateNotificationsForm.pending) {
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

	<Alert variant="info" style="margin-bottom: var(--space-4)">
		Some emails (like purchase receipts, password resets, and security notices) will always be sent for compliance and account security.
	</Alert>

	{#if showSuccess}
		<Alert variant="success" style="margin-bottom: var(--space-4)">
			{m.account_notifications_save_success()}
		</Alert>
	{/if}

	{#if updateNotificationsForm.result?.error}
		<Alert variant="error" style="margin-bottom: var(--space-4)">{updateNotificationsForm.result.error}</Alert>
	{/if}

	<form {...updateNotificationsForm} class="settings-card">
		<h2>{m.account_notifications_email_section()}</h2>

		<!-- Marketing Emails -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailMarketing">{m.account_notifications_marketing()}</Label>
				<span class="toggle-desc">{m.account_notifications_marketing_desc()}</span>
			</div>
			<!--
				Hidden inputs OUTSIDE the <button> (Switch is a <button>).
				Inputs inside <button> are excluded from FormData per HTML spec.
				b: prefix coerces to boolean: present with value="on" → true, absent → false.
			-->
			{#if marketingChecked}
				<input type="hidden" name="b:emailMarketing" value="on" />
			{/if}
			<Switch id="emailMarketing" bind:checked={marketingChecked} disabled={updateNotificationsForm.pending > 0} />
		</div>

		<!-- Transactional Emails (always on — cannot be disabled) -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailTransactional">{m.account_notifications_transactional()}</Label>
				<span class="toggle-desc">{m.account_notifications_transactional_desc()}</span>
				<span class="always-on">Always on — required for account security</span>
			</div>
			<input type="hidden" name="b:emailTransactional" value="on" />
			<Switch id="emailTransactional" checked={true} disabled={true} />
		</div>

		<!-- Weekly Digest -->
		<div class="toggle-row">
			<div class="toggle-info">
				<Label for="emailDigest">{m.account_notifications_digest()}</Label>
				<span class="toggle-desc">{m.account_notifications_digest_desc()}</span>
			</div>
			{#if digestChecked}
				<input type="hidden" name="b:emailDigest" value="on" />
			{/if}
			<Switch id="emailDigest" bind:checked={digestChecked} disabled={updateNotificationsForm.pending > 0} />
		</div>

		<div class="form-actions">
			<Button type="submit" variant="primary" loading={updateNotificationsForm.pending > 0}>
				{updateNotificationsForm.pending > 0
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

	.always-on {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		font-style: italic;
	}

	.form-actions {
		margin-top: var(--space-6);
		padding-top: var(--space-6);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}

</style>
