<!--
  @component EmailTemplatesSettings

  Email template management page for organization admins.
  Lists global templates (read-only) and org-scoped templates (editable).
  Allows creating, previewing, and test-sending templates.

  @prop data - orgId from settings layout + org/userRole from studio layout
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { Card as CardNs, PageHeader } from '$lib/components/ui';
	const Card = CardNs.Root;

	let { data } = $props();

	// Role guard: admin/owner only. Wait for data.userRole to populate —
	// ssr=false means first render has data.userRole === undefined.
	$effect(() => {
		if (
			data.userRole !== undefined &&
			data.userRole !== 'admin' &&
			data.userRole !== 'owner'
		) {
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
		/* 480px copy width — narrower than --container-sm (640px) and --breakpoint-sm.
		   Tracked in bead [ds-review-iter-026] error/empty-state copy width clustering. */
		max-width: 480px;
		margin-inline: auto;
		line-height: var(--leading-relaxed);
	}

	.empty-state .hint {
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
	}
</style>
