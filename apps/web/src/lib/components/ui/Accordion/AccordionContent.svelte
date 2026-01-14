<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { getCtx, getItemCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { content },
		helpers: { isSelected }
	} = getCtx();
	const { value } = getItemCtx();
</script>

{#if $isSelected(value)}
	<div
		use:melt={$content(value)}
		class="accordion-content {className ?? ''}"
		transition:slide={{ duration: 200 }}
		{...rest}
	>
		<div class="accordion-content-inner">
			{@render children?.()}
		</div>
	</div>
{/if}

<style>
	.accordion-content {
		overflow: hidden;
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}
	.accordion-content-inner {
		padding-bottom: var(--space-4);
		padding-top: 0;
	}
</style>
