<script lang="ts">
	import type { LayoutUser } from '$lib/types';
	import { page } from '$app/state';
	import { createTooltip, melt } from '@melt-ui/svelte';
	import { submitFormPost } from '$lib/utils/navigation';
	import { buildPlatformUrl } from '$lib/utils/subdomain';
	import { useStudioAccess } from '$lib/utils/studio-access.svelte';
	import {
		LogInIcon,
		UserIcon,
		LibraryIcon,
		LayoutDashboardIcon,
	} from '$lib/components/ui/Icon';
	import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
	import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
	import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
	import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
	import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
	import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
	import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
	import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
	import * as m from '$paraglide/messages';

	interface Props {
		user: LayoutUser | null;
		expanded?: boolean;
	}

	const { user, expanded = false }: Props = $props();

	const studioAccess = useStudioAccess(() => ({ user, url: page.url }));
	const canAccessStudio = $derived(studioAccess.canAccessStudio);
	const studioHref = $derived(studioAccess.studioHref);

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((part) => part[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	const {
		elements: { trigger: tooltipTrigger, content: tooltipContent },
		states: { open: tooltipOpen },
	} = createTooltip({
		positioning: { placement: 'right' },
		openDelay: 0,
		closeDelay: 0,
		forceVisible: true,
	});
</script>

{#if user}
	<!-- Authenticated -->
	<DropdownMenu positioning={{ placement: 'right-end', gutter: 12 }}>
		<DropdownMenuTrigger class="user-trigger">
			<Avatar class="user-trigger__avatar">
				{#if user.image}
					<AvatarImage src={user.image} alt={user.name} />
				{/if}
				<AvatarFallback>{getInitials(user.name)}</AvatarFallback>
			</Avatar>
			{#if expanded}
				<div class="user-trigger__details">
					<span class="user-trigger__name">{user.name}</span>
					<span class="user-trigger__email">{user.email}</span>
				</div>
			{/if}
		</DropdownMenuTrigger>
		<DropdownMenuContent class="user-dropdown">
			<!-- User info header -->
			<div class="user-dropdown__header">
				<Avatar class="user-dropdown__avatar">
					{#if user.image}
						<AvatarImage src={user.image} alt={user.name} />
					{/if}
					<AvatarFallback>{getInitials(user.name)}</AvatarFallback>
				</Avatar>
				<div class="user-dropdown__info">
					<span class="user-dropdown__name">{user.name}</span>
					<span class="user-dropdown__email">{user.email}</span>
				</div>
			</div>
			<DropdownMenuSeparator />
			<a href={buildPlatformUrl(page.url, '/account')} class="user-dropdown__link">
				<DropdownMenuItem class="user-dropdown__item">
					<UserIcon size={16} />
					<span>{m.nav_account()}</span>
				</DropdownMenuItem>
			</a>
			<a href={buildPlatformUrl(page.url, '/library')} class="user-dropdown__link">
				<DropdownMenuItem class="user-dropdown__item">
					<LibraryIcon size={16} />
					<span>{m.nav_library()}</span>
				</DropdownMenuItem>
			</a>
			{#if canAccessStudio}
				<a href={studioHref} class="user-dropdown__link">
					<DropdownMenuItem class="user-dropdown__item">
						<LayoutDashboardIcon size={16} />
						<span>{m.nav_studio()}</span>
					</DropdownMenuItem>
				</a>
			{/if}
			<DropdownMenuSeparator />
			<button type="button" class="user-dropdown__logout-btn" onclick={() => submitFormPost('/logout')}>
				<DropdownMenuItem class="user-dropdown__item user-dropdown__item--danger">
					<LogInIcon size={16} />
					<span>{m.nav_log_out()}</span>
				</DropdownMenuItem>
			</button>
		</DropdownMenuContent>
	</DropdownMenu>
{:else}
	<!-- Unauthenticated -->
	{#if expanded}
		<div class="user-section-unauth">
			<a href="/login" class="sign-in-link">
				<LogInIcon size={20} />
				<span class="sign-in-link__label">{m.sidebar_sign_in()}</span>
			</a>
			<a href="/register" class="register-link">{m.sidebar_register()}</a>
		</div>
	{:else}
		<a
			href="/login"
			class="user-section-unauth user-section-unauth--collapsed"
			aria-label={m.sidebar_sign_in()}
			use:melt={$tooltipTrigger}
		>
			<LogInIcon size={22} />
		</a>
		{#if $tooltipOpen}
			<div use:melt={$tooltipContent} class="user-tooltip">
				{m.sidebar_sign_in()}
			</div>
		{/if}
	{/if}
{/if}

<style>
	/* ── Trigger (avatar button at bottom of sidebar) ── */
	:global(.user-trigger) {
		display: flex !important;
		align-items: center !important;
		gap: var(--space-3) !important;
		padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2) !important;
		margin: 0 var(--space-2) !important;
		border-radius: var(--radius-md) !important;
		transition: background-color var(--duration-fast) var(--ease-default) !important;
		min-height: var(--space-10) !important;
		cursor: pointer !important;
	}

	:global(.user-trigger:hover) {
		background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent) !important;
	}

	:global(.user-trigger__avatar) {
		width: var(--space-8) !important;
		height: var(--space-8) !important;
		flex-shrink: 0 !important;
	}

	.user-trigger__details {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		overflow: hidden;
		min-width: 0;
		opacity: 0;
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
		transform: translateX(calc(-1 * var(--space-1)));
	}

	:global([data-expanded='true']) .user-trigger__details {
		opacity: 1;
		transform: translateX(0);
	}

	.user-trigger__name {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.user-trigger__email {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Dropdown panel ── */
	:global(.user-dropdown) {
		min-width: 220px !important;
		padding: var(--space-1) !important;
	}

	/* User info header inside dropdown */
	.user-dropdown__header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	:global(.user-dropdown__avatar) {
		width: var(--space-10) !important;
		height: var(--space-10) !important;
		flex-shrink: 0 !important;
	}

	.user-dropdown__info {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		overflow: hidden;
		min-width: 0;
	}

	.user-dropdown__name {
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.user-dropdown__email {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Menu item with icon */
	:global(.user-dropdown__item) {
		gap: var(--space-2) !important;
		font-size: var(--text-sm) !important;
	}

	:global(.user-dropdown__item--danger) {
		color: var(--color-error) !important;
	}

	:global(.user-dropdown__item--danger[data-highlighted]) {
		color: var(--color-error) !important;
		background-color: color-mix(in oklch, var(--color-error) 10%, transparent) !important;
	}

	/* Links inside dropdown — reset decoration */
	.user-dropdown__link {
		text-decoration: none;
		color: inherit;
	}

	.user-dropdown__logout-btn {
		width: 100%;
		padding: 0;
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
	}

	/* ── Unauthenticated states ── */
	.user-section-unauth {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		margin: 0 var(--space-2);
	}

	.user-section-unauth--collapsed {
		flex-direction: row;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		min-height: var(--space-10);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-default);
	}

	.user-section-unauth--collapsed:hover {
		background-color: var(--color-surface-secondary);
		color: var(--color-text);
	}

	.sign-in-link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		transition: color var(--duration-fast) var(--ease-default);
	}

	.sign-in-link:hover {
		color: var(--color-text);
	}

	.sign-in-link__label {
		opacity: 0;
		transform: translateX(calc(-1 * var(--space-1)));
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
	}

	:global([data-expanded='true']) .sign-in-link__label {
		opacity: 1;
		transform: translateX(0);
	}

	.register-link {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		text-decoration: none;
		padding-left: calc(20px + var(--space-3));
	}

	.register-link:hover {
		color: var(--color-interactive);
	}

	/* Tooltip for collapsed unauth state */
	.user-tooltip {
		background: var(--color-surface-secondary);
		color: var(--color-text);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		z-index: var(--z-dropdown);
		pointer-events: none;
	}
</style>
