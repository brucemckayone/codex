<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';
	import { updateProfileForm } from '$lib/remote/account.remote';
	import { avatarUploadForm } from '$lib/remote/avatar-upload.remote';
	import { avatarDeleteForm } from '$lib/remote/avatar-delete.remote';
	import Button from '$lib/components/ui/Button/Button.svelte';
	import Input from '$lib/components/ui/Input/Input.svelte';
	import Label from '$lib/components/ui/Label/Label.svelte';
	import Textarea from '$lib/components/ui/TextArea/TextArea.svelte';
	import {
		Avatar,
		AvatarImage,
		AvatarFallback
	} from '$lib/components/ui/Avatar';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Account profile page component.
	 * Uses Svelte 5 runes for state management and progressive enhancement.
	 * @component
	 * @prop {PageData} data - Server-loaded profile data
	 */
	let { data }: { data: PageData } = $props();

	// Avatar state for preview
	let avatarPreview = $state(data.user?.avatarUrl ?? data.user?.image ?? null);
	let hasSelectedFile = $state(false);

	// Show delete button only when user has avatar and no new file selected
	const showDeleteAvatar = $derived(
		(data.user?.avatarUrl || data.user?.image) && !hasSelectedFile
	);

	// Get initials for avatar fallback
	const initials = $derived(
		data.user?.name
			?.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2) || data.user?.username?.slice(0, 2).toUpperCase() || '?'
	);

	// Handle file selection for avatar upload
	function handleAvatarSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			avatarPreview = URL.createObjectURL(file);
			hasSelectedFile = true;
		}
	}

	// Cancel avatar upload (just clear preview)
	function handleAvatarCancel() {
		avatarPreview = data.user?.avatarUrl ?? data.user?.image ?? null;
		hasSelectedFile = false;
		const fileInput = document.getElementById('avatar-upload') as HTMLInputElement;
		if (fileInput) fileInput.value = '';
	}

	// Show success message after profile form submission
	let showSuccess = $state(false);
	let successTimeout: ReturnType<typeof setTimeout> | null = null;

	function showSuccessMessage() {
		showSuccess = true;
		if (successTimeout) clearTimeout(successTimeout);
		successTimeout = setTimeout(() => {
			showSuccess = false;
		}, 3000);
	}

	// Handle form completion
	$effect(() => {
		if (updateProfileForm.result?.success) {
			showSuccessMessage();
		}

		// Cleanup timeout on component unmount
		return () => {
			if (successTimeout) clearTimeout(successTimeout);
		};
	});

	// Handle avatar upload success
	$effect(() => {
		if (avatarUploadForm.result?.success) {
			// Reset state and invalidate to reload data
			hasSelectedFile = false;
			invalidateAll();
		}
	});

	// Handle avatar delete success
	$effect(() => {
		if (avatarDeleteForm.result?.success) {
			// Reset state and invalidate to reload data
			avatarPreview = null;
			hasSelectedFile = false;
			invalidateAll();
		}
	});
</script>

<svelte:head>
	<title>{m.account_profile_title()} - Codex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="profile">
	<h1>{m.account_profile_title()}</h1>
	<p class="description">{m.account_profile_description()}</p>

	{#if showSuccess}
		<div class="success-message" role="status" aria-live="polite">
			{m.account_save_success()}
		</div>
	{/if}

	{#if updateProfileForm.result?.error}
		<div class="error-message" role="alert">
			{updateProfileForm.result.error}
		</div>
	{/if}

	<!-- Avatar Section -->
	<div class="settings-card">
		<h2>{m.account_avatar_heading()}</h2>
		<div class="avatar-container">
			<Avatar>
				{#if avatarPreview}
					<AvatarImage src={avatarPreview} alt="Avatar" />
				{:else}
					<AvatarFallback>{initials}</AvatarFallback>
				{/if}
			</Avatar>

			<div class="avatar-actions">
				<!-- Avatar Upload Form -->
				<form {...avatarUploadForm} enctype="multipart/form-data" class="avatar-upload-form">
					<input
						type="file"
						id="avatar-upload"
						name="avatar"
						accept="image/*"
						hidden
						onchange={handleAvatarSelect}
						disabled={avatarUploadForm.pending > 0}
					/>

					<Button
						type="button"
						variant="secondary"
						size="sm"
						onclick={() => document.getElementById('avatar-upload')?.click()}
						disabled={avatarUploadForm.pending > 0}
					>
						{m.account_avatar_upload()}
					</Button>

					{#if hasSelectedFile}
						<Button
							type="submit"
							variant="primary"
							size="sm"
							disabled={avatarUploadForm.pending > 0}
							loading={avatarUploadForm.pending > 0}
						>
							{avatarUploadForm.pending > 0 ? m.account_avatar_uploading() : m.account_avatar_save()}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={handleAvatarCancel}
							disabled={avatarUploadForm.pending > 0}
						>
							{m.common_cancel()}
						</Button>
					{/if}
				</form>

				<!-- Avatar Delete Form (shown only when no new file selected) -->
				{#if showDeleteAvatar}
					<form {...avatarDeleteForm}>
						<Button
							type="submit"
							variant="destructive"
							size="sm"
							disabled={avatarDeleteForm.pending > 0}
							loading={avatarDeleteForm.pending > 0}
						>
							{m.account_avatar_remove()}
						</Button>
					</form>
				{/if}
			</div>
		</div>

		<p class="avatar-help">{m.account_avatar_help()}</p>

		{#if avatarUploadForm.result?.error}
			<div class="error-message" role="alert">
				{avatarUploadForm.result.error}
			</div>
		{/if}

		{#if avatarDeleteForm.result?.error}
			<div class="error-message" role="alert">
				{avatarDeleteForm.result.error}
			</div>
		{/if}
	</div>

	<!-- Profile Form (includes personal info and social links) -->
	<form {...updateProfileForm} class="settings-card">
		<h2>{m.account_personal_information()}</h2>

		<!-- Display Name -->
		<div class="form-group">
			<Label for="displayName">{m.account_display_name()}</Label>
			<Input
				id="displayName"
				name="displayName"
				value={updateProfileForm.fields.displayName.value() ?? data.user?.name ?? ''}
				placeholder={m.account_display_name_placeholder()}
				error={updateProfileForm.fields.displayName.error()}
			/>
		</div>

		<!-- Email (read-only) -->
		<div class="form-group">
			<Label for="email">{m.account_email()}</Label>
			<Input
				id="email"
				name="email"
				value={data.user?.email ?? ''}
				disabled
			/>
			<p class="form-help">{m.account_email_change_disclaimer()}</p>
		</div>

		<!-- Username -->
		<div class="form-group">
			<Label for="username">{m.account_username()}</Label>
			<Input
				id="username"
				name="username"
				value={updateProfileForm.fields.username.value() ?? data.user?.username ?? ''}
				placeholder={m.account_username_placeholder()}
				error={updateProfileForm.fields.username.error()}
			/>
		</div>

		<!-- Bio -->
		<div class="form-group">
			<Label for="bio">{m.account_bio()}</Label>
			<Textarea
				id="bio"
				name="bio"
				value={updateProfileForm.fields.bio.value() ?? data.user?.bio ?? ''}
				placeholder={m.account_bio_placeholder()}
				rows={4}
			/>
		</div>

		<!-- Social Links Section -->
		<h3>{m.account_social_links()}</h3>

		<!-- Website -->
		<div class="form-group">
			<Label for="website">{m.account_social_website()}</Label>
			<Input
				id="website"
				name="website"
				type="url"
				value={updateProfileForm.fields.website.value() ?? data.user?.socialLinks?.website ?? ''}
				placeholder="https://example.com"
				error={updateProfileForm.fields.website.error()}
			/>
		</div>

		<!-- Twitter -->
		<div class="form-group">
			<Label for="twitter">{m.account_social_twitter()}</Label>
			<Input
				id="twitter"
				name="twitter"
				type="url"
				value={updateProfileForm.fields.twitter.value() ?? data.user?.socialLinks?.twitter ?? ''}
				placeholder="https://twitter.com/username"
				error={updateProfileForm.fields.twitter.error()}
			/>
		</div>

		<!-- YouTube -->
		<div class="form-group">
			<Label for="youtube">{m.account_social_youtube()}</Label>
			<Input
				id="youtube"
				name="youtube"
				type="url"
				value={updateProfileForm.fields.youtube.value() ?? data.user?.socialLinks?.youtube ?? ''}
				placeholder="https://youtube.com/channel/..."
				error={updateProfileForm.fields.youtube.error()}
			/>
		</div>

		<!-- Instagram -->
		<div class="form-group">
			<Label for="instagram">{m.account_social_instagram()}</Label>
			<Input
				id="instagram"
				name="instagram"
				type="url"
				value={
					updateProfileForm.fields.instagram.value() ??
					data.user?.socialLinks?.instagram ??
					''
				}
				placeholder="https://instagram.com/username"
				error={updateProfileForm.fields.instagram.error()}
			/>
		</div>

		<div class="form-actions">
			<Button type="submit" variant="primary" loading={updateProfileForm.pending > 0}>
				{updateProfileForm.pending > 0
					? m.account_saving()
					: m.account_save_button()}
			</Button>
		</div>
	</form>
</div>

<style>
	.profile h1 {
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
		margin-bottom: var(--space-6);
	}

	.settings-card h2 {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-bottom: var(--space-6);
	}

	.settings-card h3 {
		font-family: var(--font-heading);
		font-size: var(--text-base);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		margin-top: var(--space-6);
		margin-bottom: var(--space-4);
	}

	/* Avatar Section */
	.avatar-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}

	@media (min-width: 640px) {
		.avatar-container {
			flex-direction: row;
			align-items: center;
		}
	}

	.avatar-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.avatar-upload-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.avatar-help {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		margin: var(--space-4) 0 0 0;
	}

	/* Form Styles */
	.form-group {
		margin-bottom: var(--space-4);
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-help {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		margin-top: var(--space-1);
	}

	.form-actions {
		margin-top: var(--space-6);
		padding-top: var(--space-6);
		border-top: var(--border-width) var(--border-style) var(--color-border);
	}

	/* Dark mode */
	:global([data-theme='dark']) .success-message {
		background-color: var(--color-success-900);
		border-color: var(--color-success-700);
		color: var(--color-success-100);
	}

	:global([data-theme='dark']) .error-message {
		background-color: var(--color-error-900);
		border-color: var(--color-error-700);
		color: var(--color-error-100);
	}
</style>
