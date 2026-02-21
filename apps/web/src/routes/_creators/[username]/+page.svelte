<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$paraglide/messages';

	const { data }: { data: PageData } = $props();
	const username = data.username ?? 'Creator';
</script>

<svelte:head>
	<title>{username} | Revelations Creators</title>
</svelte:head>

<div class="profile">
	<section class="profile-header">
		<div class="avatar">
			<div class="avatar-placeholder">{username.charAt(0).toUpperCase()}</div>
		</div>
		<h1>{username}</h1>
		<p class="bio">{m.creator_bio_default()}</p>
		{#if !data.user}
			<a href="/login" class="follow-btn">{m.creator_follow()}</a>
		{/if}
	</section>

	<section class="content">
		<h2>{m.creator_latest_content()}</h2>
		<div class="content-grid">
			<div class="placeholder-card">{m.creator_content_empty()}</div>
			<div class="placeholder-card">{m.creator_content_empty()}</div>
			<div class="placeholder-card">{m.creator_content_empty()}</div>
		</div>
	</section>

	<section class="organizations">
		<h2>{m.creator_organizations()}</h2>
		<p class="subtitle">{m.creator_organizations_subtitle()}</p>
		<div class="org-list">
			<div class="placeholder-org">{m.creator_orgs_empty()}</div>
		</div>
	</section>
</div>

<style>
	/* Styles from original component */
</style>
