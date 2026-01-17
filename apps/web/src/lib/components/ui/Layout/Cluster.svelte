<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	const {
		children,
		gap = 'var(--space-4)',
		justify = 'flex-start',
		align = 'center',
		class: className,
		...rest
	}: {
		children?: Snippet;
		gap?: string;
		justify?: string;
		align?: string;
		class?: string;
	} & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	class="cluster {className ?? ''}"
	style:--gap={gap}
	style:--justify={justify}
	style:--align={align}
	{...rest}
>
	{@render children?.()}
</div>

<style>
	.cluster {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap);
		justify-content: var(--justify);
		align-items: var(--align);
	}
</style>
