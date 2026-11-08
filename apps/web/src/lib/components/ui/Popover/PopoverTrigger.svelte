<script lang="ts">

	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { trigger },
		states: { open }
	} = getCtx();
</script>

<!-- `aria-expanded` and `data-state` from the open state, after Melt's: under
     `forceVisible` (Popover.Root's default) Melt derives both from
     visibility, so a closed trigger read "true" and "open" (a page styling
     `[data-state='open']`, MediaUseChip's ring, drew it closed too). -->
<button
	{...$trigger}
	use:trigger
	class={className}
	type="button"
	aria-expanded={$open ? 'true' : 'false'}
	data-state={$open ? 'open' : 'closed'}
	{...rest}
>
	{@render children?.()}
</button>
