<!--
  @component TabsList

  @prop {'underlined' | 'bare'} [variant='underlined'] - `bare`: no rule under the list and no space after it, for a list set inside a bar of its own
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		variant = 'underlined',
		...rest
	}: {
		children?: Snippet;
		class?: string;
		variant?: 'underlined' | 'bare';
	} & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { list }
	} = getCtx();
</script>

<div {...$list} use:list class="tabs-list {className ?? ''}" data-variant={variant} {...rest}>
	{@render children?.()}
</div>

<style>
	.tabs-list {
		display: flex;
		justify-content: flex-start;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-4);
		gap: var(--space-4);
	}

	.tabs-list[data-variant='bare'] {
		border-bottom: none;
		margin-bottom: 0;
	}
</style>
