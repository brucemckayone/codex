<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		disabled = false,
		...rest
	}: { children?: Snippet; class?: string; disabled?: boolean } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { item },
		states: { open }
	} = getCtx();

	/**
	 * The pointer's roving focus, done here and at once. Melt's own handlers
	 * (skipped through the `m-` events Melt dispatches first) wait a
	 * millisecond and then take tabindex 0 from whatever has focus by then.
	 * An item that opens a dialog has handed focus to the dialog by then.
	 * In Chromium the overlay covering the item fires a pointerleave on it,
	 * and a pointermove from the same frame as the press is still waiting
	 * behind the dialog's render. So the dialog's buttons lost their tab
	 * stops one by one, and focus ended on a confirm's destructive button
	 * (Codex-vlphc review c5, found with G5-C-L1). Here focus moves only
	 * while the menu is open, and tabindex only between the menu's own
	 * elements. A pressed item's leave moves nothing: it is what covered
	 * the item that the pointer entered. A move onto the item proves
	 * nothing covers it, and ends that: a press that left the menu open
	 * (one reopened during its closing animation keeps its items) leaves
	 * no item that never gives focus back to the menu.
	 */
	function rove(node: HTMLElement) {
		let pressed = false;
		const moveTo = (next: HTMLElement | null) => {
			const menu = node.closest<HTMLElement>('[role="menu"]');
			const active = document.activeElement;
			if (!$open || !next || !menu || active === next) return;
			if (active instanceof HTMLElement && menu.contains(active)) active.tabIndex = -1;
			next.tabIndex = 0;
			next.focus();
		};
		const fromMouse = (event: Event) => {
			event.preventDefault();
			const pointer = (event as CustomEvent<{ originalEvent: PointerEvent }>).detail?.originalEvent;
			return pointer?.pointerType === 'mouse';
		};
		// Onto an item: the item. Off it: the menu, so no item stays lit.
		const onMove = (event: Event) => {
			if (!fromMouse(event)) return;
			pressed = false;
			moveTo(node);
		};
		const onLeave = (event: Event) => {
			if (fromMouse(event) && !pressed) moveTo(node.closest<HTMLElement>('[role="menu"]'));
		};
		const onPress = () => {
			pressed = true;
		};
		node.addEventListener('m-pointermove', onMove);
		node.addEventListener('m-pointerleave', onLeave);
		node.addEventListener('click', onPress, true);
		return {
			destroy() {
				node.removeEventListener('m-pointermove', onMove);
				node.removeEventListener('m-pointerleave', onLeave);
				node.removeEventListener('click', onPress, true);
			}
		};
	}
</script>

<div
	{...$item}
	use:item
	use:rove
	class="dropdown-item {className ?? ''}"
	{...rest}
	aria-disabled={disabled}
	data-disabled={disabled ? '' : undefined}
>
	{@render children?.()}
</div>

<style>
	.dropdown-item {
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		color: var(--color-text);
		cursor: default;
		user-select: none;
		outline: none;
		transition: background-color var(--duration-fast);
		text-decoration: none;
	}

	.dropdown-item:global([data-highlighted]) {
		background-color: var(--color-surface-secondary);
		color: var(--color-text);
	}

	.dropdown-item:global([data-disabled]) {
		opacity: var(--opacity-50);
		pointer-events: none;
	}
</style>
