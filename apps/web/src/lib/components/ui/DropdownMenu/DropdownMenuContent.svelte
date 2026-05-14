<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { type FlyParams, fly } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { y: -5, duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: FlyParams } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { menu },
		states: { open }
	} = getCtx();

	/**
	 * Melt portals the menu to <body>, escaping `.org-layout` which carries
	 * `[data-org-brand]`, `[data-org-bg]` and `--brand-*` inline styles that
	 * `org-brand.css` keys off. Copy those onto the portalled node so the org
	 * branding cascade still resolves inside the menu. Matches DialogContent.
	 */
	function forwardBrandTokens(node: HTMLElement) {
		if (!browser) return;

		const orgLayout = document.querySelector<HTMLElement>('.org-layout');
		if (!orgLayout) return;

		if (orgLayout.hasAttribute('data-org-brand')) {
			node.setAttribute('data-org-brand', '');
		}
		if (orgLayout.hasAttribute('data-org-bg')) {
			node.setAttribute('data-org-bg', '');
		}

		const style = orgLayout.style;
		for (let i = 0; i < style.length; i++) {
			const prop = style[i];
			if (prop.startsWith('--brand-')) {
				node.style.setProperty(prop, style.getPropertyValue(prop));
			}
		}

		node.style.fontFamily = 'inherit';
	}
</script>

{#if $open}
	<div
		{...$menu}
		use:menu
		use:forwardBrandTokens
		class="dropdown-content {className ?? ''}"
		transition:fly={transitionConfig}
		{...rest}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.dropdown-content {
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		padding: var(--space-1);
		z-index: var(--z-dropdown);
		min-width: 8rem;
		display: flex;
		flex-direction: column;
		outline: none;
	}
</style>
