<script lang="ts">
	import { AUTH_ROLES } from '@codex/constants';
	import type { LayoutUser } from '$lib/types';
	import { page } from '$app/state';
	import { buildPlatformUrl } from '$lib/utils/subdomain';
	import { useStudioAccess } from '$lib/utils/studio-access.svelte';
	import { getInitials } from '$lib/utils/format';
	import { submitFormPost } from '$lib/utils/navigation';
	import {
		LifeBuoyIcon,
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
	import * as Dialog from '$lib/components/ui/Dialog';
	import * as m from '$paraglide/messages';

	interface Props {
		open: boolean;
		variant: 'platform' | 'org';
		user: LayoutUser | null;
	}

	let { open = $bindable(false), variant, user }: Props = $props();

	const studioAccess = useStudioAccess(() => ({ user, url: page.url }));
	const showSupport = $derived(
		variant === 'platform' && user?.role === AUTH_ROLES.PLATFORM_OWNER
	);

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

	// ── Drag-to-dismiss ───────────────────────────────────────
	// A pull down closes the sheet, but only a pull that starts with the
	// sheet at its top. Scrolled down, the same finger movement scrolls the
	// list back up, and it used to close the sheet instead (Codex-vlphc.4).
	let dragged: HTMLElement | null = null;
	let startY = 0;
	let currentY = 0;

	// Whether anything from the touched element up to the panel is scrolled.
	function scrolledDown(from: EventTarget | null, panel: HTMLElement): boolean {
		for (let el = from instanceof Element ? from : null; el && el !== panel; el = el.parentElement) {
			if (el.scrollTop > 0) return true;
		}
		return panel.scrollTop > 0;
	}

	// currentY starts where the touch does, so a tap that follows a drag
	// never reads the drag's last position as its own.
	function handleTouchStart(e: TouchEvent & { currentTarget: HTMLElement }) {
		startY = currentY = e.touches[0].clientY;
		dragged = scrolledDown(e.target, e.currentTarget) ? null : e.currentTarget;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!dragged) return;
		currentY = e.touches[0].clientY;
		const delta = currentY - startY;
		if (delta > 0) {
			dragged.style.transform = `translateY(${delta}px)`;
		}
	}

	// A sheet closed by a pull, reopened before it has dropped away: Svelte
	// resumes that same panel, which would still carry the pull's offset.
	let released: HTMLElement | null = null;
	$effect(() => {
		if (!open || !released) return;
		released.style.transform = '';
		released = null;
	});

	// Past 100px the sheet closes from where the finger let go: it keeps the
	// pull's offset, and the rise runs on down from there (Svelte's fly adds
	// to the transform it finds). Cleared at once, it jumped back up first.
	function handleTouchEnd() {
		if (!dragged) return;
		if (currentY - startY > 100) {
			released = dragged;
			open = false;
		} else {
			dragged.style.transform = '';
		}
		dragged = null;
	}

	// The system took the touch (an iOS gesture, an alert): the pull is
	// abandoned, so the sheet goes back where it was and stays open.
	function handleTouchCancel() {
		if (!dragged) return;
		dragged.style.transform = '';
		dragged = null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		placement="bottom"
		surface="glass"
		overlay="dim"
		motion="rise"
		flush
		closeButton={false}
		aria-label="More options"
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		ontouchcancel={handleTouchCancel}
	>
		<Dialog.Body>
			<div class="sheet__content">
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
						<!-- Platform support (/admin), for the platform owner only: the
						     phone's place for the rail's Support item, so the bottom
						     bar doesn't change. -->
						{#if showSupport}
							<a href="/admin" class="sheet__link">
								<LifeBuoyIcon size={20} />
								<span>{m.support_nav_label()}</span>
							</a>
						{/if}
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
		</Dialog.Body>
	</Dialog.Content>
</Dialog.Root>

<style>
	/* The sheet's one padded column; Dialog.Body around it scrolls. */
	.sheet__content {
		padding: 0 var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
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
		color: var(--color-link);
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
