<script lang="ts">
	import { becomeCreatorForm } from '$lib/remote/account.remote';
	import Button from '$lib/components/ui/Button/Button.svelte';
	import Input from '$lib/components/ui/Input/Input.svelte';
	import Label from '$lib/components/ui/Label/Label.svelte';
	import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';

	let { data } = $props();

	const { username, bio, website, twitter, youtube, instagram } =
		becomeCreatorForm.fields;
</script>

<svelte:head>
	<title>Become a Creator - Codex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="become-creator">
	<div class="hero">
		<h1>Become a Creator</h1>
		<p class="description">
			Start sharing your content on Codex. As a creator, you can upload videos and audio,
			build your own catalogue, and sell to your audience.
		</p>
	</div>

	{#if becomeCreatorForm.result && !becomeCreatorForm.result.success && becomeCreatorForm.result.error}
		<div class="error-message" role="alert">{becomeCreatorForm.result.error}</div>
	{/if}

	<form {...becomeCreatorForm} class="settings-card" novalidate>
		<h2>Creator Profile</h2>

		<div class="form-group">
			<Label for="username">Username</Label>
			<Input
				id="username"
				{...username.as('text')}
				placeholder="my-creator-name"
				required
			/>
			<p class="form-help">
				This will be your public profile URL: creators.revelations.studio/<strong>{username.value() || '...'}</strong>
			</p>
			{#each username.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<div class="form-group">
			<Label for="bio">Bio</Label>
			<TextArea
				id="bio"
				{...bio.as('text')}
				placeholder="Tell your audience about yourself..."
				rows={4}
			/>
			{#each bio.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<h3>Social Links</h3>
		<p class="form-help section-help">Optional — add links to your other platforms.</p>

		<div class="form-group">
			<Label for="website">Website</Label>
			<Input id="website" {...website.as('url')} placeholder="https://example.com" />
			{#each website.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<div class="form-group">
			<Label for="twitter">Twitter</Label>
			<Input id="twitter" {...twitter.as('url')} placeholder="https://twitter.com/username" />
			{#each twitter.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<div class="form-group">
			<Label for="youtube">YouTube</Label>
			<Input id="youtube" {...youtube.as('url')} placeholder="https://youtube.com/channel/..." />
			{#each youtube.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<div class="form-group">
			<Label for="instagram">Instagram</Label>
			<Input id="instagram" {...instagram.as('url')} placeholder="https://instagram.com/username" />
			{#each instagram.issues() as issue}
				<p class="field-error">{issue.message}</p>
			{/each}
		</div>

		<div class="form-actions">
			<Button type="submit" variant="primary" loading={becomeCreatorForm.pending > 0}>
				{becomeCreatorForm.pending > 0 ? 'Setting up...' : 'Become a Creator'}
			</Button>
		</div>
	</form>
</div>

<style>
	.become-creator {
		max-width: 40rem;
		margin: 0 auto;
	}

	.hero {
		margin-bottom: var(--space-8);
	}

	.hero h1 {
		font-family: var(--font-heading);
		font-size: var(--text-2xl);
		font-weight: var(--font-bold);
		color: var(--color-text);
		margin-bottom: var(--space-2);
	}

	.description {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		line-height: var(--leading-relaxed);
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
		background-color: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		margin-bottom: var(--space-6);
	}

	.settings-card h2 {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-bottom: var(--space-4);
	}

	.settings-card h3 {
		font-family: var(--font-heading);
		font-size: var(--text-base);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-top: var(--space-6);
		margin-bottom: var(--space-1);
	}

	.form-group {
		margin-bottom: var(--space-4);
	}

	.form-help {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-top: var(--space-1);
	}

	.section-help {
		margin-bottom: var(--space-4);
	}

	.field-error {
		font-size: var(--text-xs);
		color: var(--color-error-600);
		margin-top: var(--space-1);
	}

	.form-actions {
		margin-top: var(--space-6);
		display: flex;
		justify-content: flex-end;
	}
</style>
