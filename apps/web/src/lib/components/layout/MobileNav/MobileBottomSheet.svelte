<script lang="ts">
	import type { LayoutUser, LayoutOrganization } from '$lib/types';
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { buildPlatformUrl } from '$lib/utils/subdomain';
	import { getInitials, useStudioAccess } from '$lib/utils/studio-access.svelte';
	import { submitFormPost } from '$lib/utils/navigation';
	import {
		LogInIcon,
		TagIcon,
		UsersIcon,
		UserIcon,
		UserPlusIcon,
		LayoutDashboardIcon,
	} from '$lib/components/ui/Icon';
	import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
	import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
	import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
	import ThemeToggle from '$lib/components/ui/ThemeToggle/ThemeToggle.svelte';
	import * as m from '$paraglide/messages';

	interface Props {
		open: boolean;
		variant: 'platform' | 'org';
		user: LayoutUser | null;
		org?: LayoutOrganization;
	}

	let { open = $bindable(false), variant, user, org }: Props = $props();

	const studioAccess = useStudioAccess(() => ({ user, url: page.url }));

	// ── Close on route change ─────────────────────────────────
	// Track pathname separately to avoid closing when `open` toggles
	let prevPathname = $state(page.url.pathname);
	$effect(() => {
		const currentPath = page.url.pathname;
		if (currentPath !== prevPathname) {
			prevPathname = currentPath;
			if (open) open = false;
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
		}
	}

	// ── Drag-to-dismiss ───────────────────────────────────────
	let sheetEl: HTMLDivElement | undefined = $state();
	let startY = 0;
	let currentY = 0;
	let dragging = false;

	function handleTouchStart(e: TouchEvent) {
		startY = e.touches[0].clientY;
		dragging = true;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!dragging || !sheetEl) return;
		currentY = e.touches[0].clientY;
		const delta = currentY - startY;
		if (delta > 0) {
			sheetEl.style.transform = `translateY(${delta}px)`;
		}
	}

	function handleTouchEnd() {
		dragging = false;
		const delta = currentY - startY;
		if (delta > 100) {
			open = false;
		}
		if (sheetEl) sheetEl.style.transform = '';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="sheet-backdrop"
		role="presentation"
		onclick={() => {
			open = false;
		}}
		transition:fade={{ duration: 200 }}
	></div>

	<!-- Sheet -->
	<div
		bind:this={sheetEl}
		class="sheet"
		role="dialog"
		tabindex="-1"
		aria-label="More options"
		transition:fly={{ y: 400, duration: 300, easing: cubicOut }}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
	>
		<!-- Drag handle -->
		<div class="sheet__handle-area">
			<div class="sheet__handle"></div>
		</div>

		<!-- Nav links (overflow items not in bottom bar) -->
		<div class="sheet__section">
			{#if variant === 'org'}
				<a
					href="/creators"
					class="sheet__link"
					onclick={() => {
						open = false;
					}}
				>
					<UsersIcon size={20} />
					<span>{m.sidebar_creators()}</span>
				</a>
			{/if}
			<a
				href="/pricing"
				class="sheet__link"
				onclick={() => {
					open = false;
				}}
			>
				<TagIcon size={20} />
				<span>{m.sidebar_pricing()}</span>
			</a>
			{#if studioAccess.canAccessStudio}
				<a
					href={studioAccess.studioHref}
					class="sheet__link"
					onclick={() => {
						open = false;
					}}
				>
					<LayoutDashboardIcon size={20} />
					<span>{m.nav_studio()}</span>
				</a>
			{/if}
		</div>

		<div class="sheet__divider"></div>

		<!-- Auth section -->
		<div class="sheet__section">
			{#if user}
				<div class="sheet__user">
					<Avatar class="sheet__avatar">
						{#if user.image}
							<AvatarImage src={user.image} alt={user.name} />
						{/if}
						<AvatarFallback>{getInitials(user.name)}</AvatarFallback>
					</Avatar>
					<div class="sheet__user-info">
						<span class="sheet__user-name">{user.name}</span>
						<span class="sheet__user-email">{user.email}</span>
					</div>
				</div>
				<a href={buildPlatformUrl(page.url, '/account')} class="sheet__link">
					<UserIcon size={20} />
					<span>{m.nav_account()}</span>
				</a>
				<button class="sheet__link sheet__link--danger" onclick={() => submitFormPost('/logout')}>
					<LogInIcon size={20} />
					<span>{m.nav_log_out()}</span>
				</button>
			{:else}
				<a href="/login" class="sheet__link">
					<LogInIcon size={20} />
					<span>{m.common_sign_in()}</span>
				</a>
				<a href="/register" class="sheet__link sheet__link--primary">
					<UserPlusIcon size={20} />
					<span>{m.nav_register()}</span>
				</a>
			{/if}
		</div>

		<div class="sheet__divider"></div>

		<div class="sheet__section sheet__theme">
			<ThemeToggle showLabel size={20} />
		</div>
	</div>
{/if}

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--color-overlay) 50%, transparent);
		z-index: var(--z-modal-backdrop);
	}

	.sheet {
		position: fixed;
		bottom: var(--space-2);
		left: var(--space-2);
		right: var(--space-2);
		max-height: 70vh;
		background: var(--material-glass);
		backdrop-filter: blur(var(--blur-xl));
		-webkit-backdrop-filter: blur(var(--blur-xl));
		border: var(--border-width) var(--border-style) var(--material-glass-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-xl);
		z-index: var(--z-modal);
		padding: 0 var(--space-4) var(--space-4);
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
		overflow-y: auto;
		touch-action: pan-y;
	}

	.sheet__handle-area {
		display: flex;
		justify-content: center;
		padding: var(--space-3) 0;
		cursor: grab;
	}

	.sheet__handle {
		width: var(--space-10);
		height: var(--space-1);
		background: var(--color-border);
		border-radius: var(--radius-full);
	}

	.sheet__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}

	.sheet__divider {
		height: var(--border-width);
		background: var(--color-border);
		margin: var(--space-3) 0;
	}

	.sheet__link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: var(--transition-colors);
	}

	.sheet__link:hover,
	.sheet__link:active {
		background: var(--color-surface-secondary);
	}

	.sheet__link--danger {
		color: var(--color-error);
	}

	.sheet__link--primary {
		color: var(--color-interactive);
	}

	.sheet__user {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	:global(.sheet__avatar) {
		width: var(--space-10);
		height: var(--space-10);
	}

	.sheet__user-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}

	.sheet__user-name {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text);
	}

	.sheet__user-email {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.sheet__theme :global(.theme-toggle) {
		padding: var(--space-3);
		width: 100%;
	}
</style>
