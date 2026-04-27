<script lang="ts">
	import type { LayoutUser, LayoutOrganization } from '$lib/types';
	import { page } from '$app/state';
	import { PLATFORM_RAIL_NAV, getOrgRailNav } from '$lib/config/navigation';
	import { RAIL_ICON_MAP } from '$lib/config/rail-icons';
	import { SearchIcon, LayoutDashboardIcon } from '$lib/components/ui/Icon';
	import { useStudioAccess } from '$lib/utils/studio-access.svelte';
	import { getInitials } from '$lib/utils/format';
	import SidebarRailItem from './SidebarRailItem.svelte';
	import SidebarRailUserSection from './SidebarRailUserSection.svelte';
	import ThemeToggle from '$lib/components/ui/ThemeToggle/ThemeToggle.svelte';
	import * as m from '$paraglide/messages';

	interface Props {
		variant: 'platform' | 'org';
		user: LayoutUser | null;
		org?: LayoutOrganization;
		onSearchClick?: () => void;
	}

	const { variant, user, org, onSearchClick }: Props = $props();

	// ── Hover-expand logic ────────────────────────────────────────────
	// JS-driven (not CSS :hover) for instant collapse + delayed expand
	let expandTimer: ReturnType<typeof setTimeout> | null = null;
	let expanded = $state(false);

	function handleMouseEnter() {
		expandTimer = setTimeout(() => {
			expanded = true;
		}, 200);
	}

	function handleMouseLeave() {
		if (expandTimer) {
			clearTimeout(expandTimer);
			expandTimer = null;
		}
		expanded = false;
	}

	// ── Derived nav items ─────────────────────────────────────────────
	const navItems = $derived(
		variant === 'platform' ? PLATFORM_RAIL_NAV : getOrgRailNav()
	);

	function isActive(href: string): boolean {
		const pathname = page.url.pathname;
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}

	// ── Studio access ─────────────────────────────────────────────
	const studioAccess = useStudioAccess(() => ({ user, url: page.url }));
	const canAccessStudio = $derived(studioAccess.canAccessStudio);
	const studioHref = $derived(studioAccess.studioHref);

	// ── Org logo initials fallback ────────────────────────────────────
	// Up to 2 uppercase letters derived from the org name. Rendered in a
	// neutral circle when `org.logoUrl` is null so there's no blank gap.
	const orgInitials = $derived(getInitials(org?.name));
</script>

<nav
	class="sidebar-rail"
	data-expanded={expanded}
	aria-label={variant === 'platform' ? 'Main navigation' : 'Organization navigation'}
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
>
	<!-- Logo section -->
	<div class="rail-logo">
		{#if variant === 'platform'}
			<a href="/" class="rail-logo__link" aria-label="Home">
				<span class="rail-logo__wordmark">codex</span>
			</a>
		{:else if org}
			<a href="/" class="rail-logo__link" aria-label="{org.name} home">
				{#if org.logoUrl}
					<img src={org.logoUrl} alt={org.name} class="rail-logo__image" />
				{:else}
					<span class="rail-logo__initial" aria-hidden="true">{orgInitials}</span>
					<span class="sr-only">{org.name}</span>
				{/if}
				<span class="rail-logo__name">{org.name}</span>
			</a>
		{/if}
	</div>

	<!-- Search button — prominent, top of sidebar -->
	<button
		type="button"
		class="rail-search-btn"
		onclick={() => onSearchClick?.()}
		aria-label={m.sidebar_search()}
	>
		<SearchIcon size={20} />
		{#if expanded}
			<span class="rail-search-btn__label">{m.sidebar_search()}</span>
			<kbd class="rail-search-btn__kbd">&#8984;K</kbd>
		{/if}
	</button>

	<!-- Divider -->
	<div class="rail-divider"></div>

	<!-- Nav items -->
	<div class="rail-nav">
		{#each navItems as link, i (link.href)}
			<SidebarRailItem
				href={link.href}
				label={link.label}
				icon={link.icon}
				active={isActive(link.href)}
				{expanded}
				index={i}
			/>
		{/each}
	</div>

	<!-- Spacer pushes bottom section down -->
	<div class="rail-spacer"></div>

	<!-- Studio link (creators/admins only) — grouped with user section at bottom -->
	{#if canAccessStudio}
		<div class="rail-divider"></div>
		<a
			href={studioHref}
			class="rail-studio-btn"
			aria-label={m.nav_studio()}
		>
			<LayoutDashboardIcon size={22} />
			{#if expanded}
				<span class="rail-studio-btn__label">{m.nav_studio()}</span>
			{/if}
		</a>
	{/if}

	<!-- Theme toggle -->
	<div class="rail-theme-toggle">
		<ThemeToggle showLabel />
	</div>

	<!-- User section (bottom) -->
	<SidebarRailUserSection {user} {expanded} />
</nav>

<style>
	.sidebar-rail {
		/* --app-sidebar-width is the single source of truth for the collapsed
		   rail width — consumed by any component that offsets from it (cinema
		   mode, full-bleed containers). Defined in tokens/layout.css. */
		--rail-width-collapsed: var(--app-sidebar-width);
		--rail-width-expanded: 240px;
		--rail-glass-bg: color-mix(in oklch, var(--color-surface) 75%, transparent);
		--rail-glass-border: color-mix(in oklch, var(--color-border) 50%, transparent);

		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		width: var(--rail-width-collapsed);
		z-index: var(--z-fixed);

		display: flex;
		flex-direction: column;
		padding: var(--space-3) 0;
		gap: var(--space-1);

		background-color: var(--color-surface);
		border-right: var(--border-width) var(--border-style) var(--color-border);

		transition:
			width var(--duration-slow) var(--ease-spring),
			background-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			border-radius var(--duration-normal) var(--ease-default);

		view-transition-name: sidebar-nav;
	}

	.sidebar-rail[data-expanded='true'] {
		width: var(--rail-width-expanded);
		background: var(--rail-glass-bg);
		backdrop-filter: blur(var(--blur-xl));
		-webkit-backdrop-filter: blur(var(--blur-xl));
		border-right-color: var(--rail-glass-border);
		box-shadow: var(--shadow-xl);
		border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
	}

	@media (--below-md) {
		.sidebar-rail {
			display: none;
		}
	}

	/* Logo — aligned to same visual center as nav icons */
	.rail-logo {
		padding: var(--space-2);
		margin: 0 var(--space-2);
		min-height: var(--space-12);
		display: flex;
		align-items: center;
	}

	.rail-logo__link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		text-decoration: none;
		overflow: hidden;
	}

	.rail-logo__wordmark {
		font-family: var(--font-heading);
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		color: var(--color-text);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
	}

	.rail-logo__image {
		height: var(--space-10);
		width: var(--space-10);
		object-fit: contain;
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}

	.rail-logo__initial {
		width: var(--space-10);
		height: var(--space-10);
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: var(--color-surface-secondary);
		color: var(--color-text);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		letter-spacing: var(--tracking-tight);
		flex-shrink: 0;
	}

	.rail-logo__name {
		font-family: var(--font-heading);
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0;
		transition: opacity var(--duration-normal) var(--ease-default);
	}

	.sidebar-rail[data-expanded='true'] .rail-logo__name {
		opacity: 1;
	}

	/* Divider */
	.rail-divider {
		height: var(--border-width);
		background-color: var(--color-border);
		margin: var(--space-2) var(--space-4);
	}

	/* Nav items container */
	.rail-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}

	/* Search button — prominent at top */
	.rail-search-btn {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		margin: 0 var(--space-2);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		transition: background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		background: var(--color-surface-secondary);
		border: var(--border-width) var(--border-style) var(--color-border);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		min-height: var(--space-10);
		text-align: left;
	}

	.rail-search-btn:hover {
		background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
		border-color: color-mix(in oklch, var(--color-interactive) 25%, transparent);
		color: var(--color-text);
	}

	.rail-search-btn__label {
		flex: 1;
		opacity: 0;
		transform: translateX(calc(-1 * var(--space-1)));
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
	}

	.sidebar-rail[data-expanded='true'] .rail-search-btn__label {
		opacity: 1;
		transform: translateX(0);
	}

	.rail-search-btn__kbd {
		opacity: 0;
		margin-left: auto;
		padding: var(--space-0-5) var(--space-1-5);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-sm);
		font-family: var(--font-sans);
		transition: opacity var(--duration-normal) var(--ease-default);
	}

	.sidebar-rail[data-expanded='true'] .rail-search-btn__kbd {
		opacity: 1;
	}

	/* Studio link — matches rail-item alignment exactly */
	.rail-studio-btn {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		margin: 0 var(--space-2);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		transition: var(--transition-colors);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		min-height: var(--space-10);
	}

	.rail-studio-btn:hover {
		background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
		color: var(--color-text);
	}

	.rail-studio-btn__label {
		opacity: 0;
		transform: translateX(calc(-1 * var(--space-1)));
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
	}

	.sidebar-rail[data-expanded='true'] .rail-studio-btn__label {
		opacity: 1;
		transform: translateX(0);
	}

	/* Theme toggle */
	.rail-theme-toggle {
		margin: 0 var(--space-2);
	}

	.rail-theme-toggle :global(.theme-toggle__label) {
		opacity: 0;
		transform: translateX(calc(-1 * var(--space-1)));
	}

	.sidebar-rail[data-expanded='true'] .rail-theme-toggle :global(.theme-toggle__label) {
		opacity: 1;
		transform: translateX(0);
	}

	/* Spacer */
	.rail-spacer {
		flex: 1;
	}
</style>
