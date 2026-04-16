<script lang="ts">
	import type { LayoutUser, LayoutOrganization } from '$lib/types';
	import { PLATFORM_MOBILE_NAV, getOrgMobileNav } from '$lib/config/navigation';
	import { RAIL_ICON_MAP } from '$lib/config/rail-icons';
	import { SearchIcon, MoreHorizontalIcon } from '$lib/components/ui/Icon';
	import { page } from '$app/state';

	interface Props {
		variant: 'platform' | 'org';
		user: LayoutUser | null;
		org?: LayoutOrganization;
		onSearchClick: () => void;
		onMoreClick: () => void;
	}

	const { variant, user, org, onSearchClick, onMoreClick }: Props = $props();

	const navItems = $derived(
		variant === 'platform' ? PLATFORM_MOBILE_NAV : getOrgMobileNav()
	);

	function isActive(href: string): boolean {
		const pathname = page.url.pathname;
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}

	/* Split nav items: first 2 go left of search, rest go right */
	const leftItems = $derived(navItems.slice(0, 2));
	const rightItems = $derived(navItems.slice(2));
</script>

<nav class="bottom-nav" aria-label="Mobile navigation">
	{#each leftItems as item (item.href)}
		{@const IconComponent = RAIL_ICON_MAP[item.icon]}
		<a
			href={item.href}
			class="bottom-nav__tab"
			class:bottom-nav__tab--active={isActive(item.href)}
			aria-current={isActive(item.href) ? 'page' : undefined}
		>
			<IconComponent size={22} />
			<span class="bottom-nav__label">{item.label}</span>
		</a>
	{/each}

	<button
		type="button"
		class="bottom-nav__tab bottom-nav__tab--search"
		onclick={onSearchClick}
		aria-label="Search"
	>
		<span class="bottom-nav__search-circle">
			<SearchIcon size={22} />
		</span>
	</button>

	{#each rightItems as item (item.href)}
		{@const IconComponent = RAIL_ICON_MAP[item.icon]}
		<a
			href={item.href}
			class="bottom-nav__tab"
			class:bottom-nav__tab--active={isActive(item.href)}
			aria-current={isActive(item.href) ? 'page' : undefined}
		>
			<IconComponent size={22} />
			<span class="bottom-nav__label">{item.label}</span>
		</a>
	{/each}

	<button
		type="button"
		class="bottom-nav__tab"
		onclick={onMoreClick}
		aria-label="More"
	>
		<MoreHorizontalIcon size={22} />
		<span class="bottom-nav__label">More</span>
	</button>
</nav>

<style>
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: var(--space-16);
		background: var(--material-glass);
		backdrop-filter: blur(var(--blur-xl));
		-webkit-backdrop-filter: blur(var(--blur-xl));
		border-top: var(--border-width) var(--border-style) var(--material-glass-border);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		z-index: var(--z-fixed);
		display: flex;
		align-items: center;
		justify-content: space-around;
		padding-bottom: env(safe-area-inset-bottom);
	}

	@media (--breakpoint-md) {
		.bottom-nav {
			display: none;
		}
	}

	.bottom-nav__tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-0-5);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text-tertiary);
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--duration-normal) var(--ease-default),
			transform var(--duration-fast) var(--ease-out);
		min-width: var(--space-12);
		min-height: var(--space-11);
	}

	.bottom-nav__tab:active {
		transform: scale(0.92);
	}

	.bottom-nav__tab--active {
		color: var(--color-interactive);
	}

	.bottom-nav__label {
		font-size: var(--text-xs);
		font-weight: var(--font-medium);
		line-height: var(--leading-none);
	}

	/* Search button — elevated hero element */
	.bottom-nav__tab--search {
		position: relative;
		top: calc(-1 * var(--space-3));
		padding: 0;
	}

	.bottom-nav__tab--search:active {
		transform: scale(1);
	}

	.bottom-nav__search-circle {
		width: var(--space-12);
		height: var(--space-12);
		border-radius: var(--radius-full);
		background: linear-gradient(
			135deg,
			var(--color-interactive) 0%,
			color-mix(in oklch, var(--color-interactive) 80%, var(--color-neutral-900)) 100%
		);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-inverse);
		box-shadow: var(--shadow-lg),
			0 0 0 var(--space-1) color-mix(in oklch, var(--color-interactive) 20%, transparent);
		transition: transform var(--duration-normal) var(--ease-spring),
			box-shadow var(--duration-normal) var(--ease-default);
	}

	.bottom-nav__tab--search:active .bottom-nav__search-circle {
		transform: scale(0.88);
		box-shadow: var(--shadow-sm),
			0 0 0 var(--space-0-5) color-mix(in oklch, var(--color-interactive) 30%, transparent);
	}
</style>
