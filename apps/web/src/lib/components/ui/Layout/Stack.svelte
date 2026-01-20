<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	const {
		children,
		gap = 'var(--space-4)',
		align = 'stretch',
		class: className,
		...rest
	}: {
		children?: Snippet;
		gap?: string;
		align?: string;
		class?: string;
	} & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="stack {className ?? ''}" style:--gap={gap} style:--align={align} {...rest}>
	{@render children?.()}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		align-items: var(--align);
	}
</style>
