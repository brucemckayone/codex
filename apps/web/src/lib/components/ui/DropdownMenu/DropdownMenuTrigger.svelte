<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getDisabledCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children: Snippet; class?: string } & Omit<
		HTMLAttributes<HTMLButtonElement>,
		'id' | 'aria-controls'
	> = $props();

	// Melt's id and aria-controls stay, after the spread, whatever a page
	// passes: the menu's aria-labelledby names this id, Melt's keyboard open
	// finds the menu through aria-controls, and so does a dialog's way back
	// to this button (Dialog.svelte's menuTrigger). DropdownMenuContent
	// keeps its id the same way (Codex-vlphc review c6, fu-focus-2).
	const {
		elements: { trigger }
	} = getCtx();
	// The Root's `disabled`: the menu will not open, so the button says so.
	const disabled = getDisabledCtx();
</script>

<button
	{...$trigger}
	use:trigger
	class={className}
	type="button"
	{...rest}
	id={$trigger.id}
	aria-controls={$trigger['aria-controls']}
	aria-disabled={disabled() ? 'true' : rest['aria-disabled']}
	data-disabled={disabled() ? '' : undefined}
>
	{@render children()}
</button>
