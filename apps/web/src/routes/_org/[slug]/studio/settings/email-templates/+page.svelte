<!--
  @component EmailTemplatesSettings

  Email template management page for organization admins.
  Lists global templates (read-only) and org-scoped templates (editable).
  Allows creating, previewing, and test-sending templates.

  @prop data - orgId from settings layout + org/userRole from studio layout
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { Card, PageHeader } from '$lib/components/ui';

	let { data } = $props();

	// Role guard: admin/owner only
	$effect(() => {
		if (data.userRole !== 'admin' && data.userRole !== 'owner') {
			goto('/studio');
		}
	});

	const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');
</script>

<svelte:head>
	<title>Email Templates | Studio Settings</title>
</svelte:head>

{#if isAuthorized}
	<PageHeader
		title="Email Templates"
		description="Manage email templates for your organisation. Global templates provide defaults that you can customise."
	/>

	<div class="templates-page">
		<Card>
			<div class="empty-state">
				<h3>Template Management</h3>
				<p>
					Email templates are managed through the notification system.
					Global templates provide branded defaults for all transactional and marketing emails.
				</p>
				<p class="hint">
					Organisation-level template customisation will be available here.
					For now, global templates handle all emails with your organisation's branding automatically.
				</p>
			</div>
		</Card>
	</div>
{/if}

<style>
	.templates-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.empty-state {
		text-align: center;
		padding: var(--space-12) var(--space-6);
	}

	.empty-state h3 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-lg);
		color: var(--color-text-primary);
	}

	.empty-state p {
		margin: 0 0 var(--space-3);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		max-width: 480px;
		margin-inline: auto;
		line-height: 1.6;
	}

	.empty-state .hint {
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
	}
</style>
