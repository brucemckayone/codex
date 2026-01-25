<script lang="ts">
	import { type CreatePopoverProps, createPopover } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreatePopoverProps, 'open' | 'onOpenChange'> & {
		children?: Snippet;
        open?: boolean;
        onOpenChange?: (open: boolean) => void;
	};

	let {
		positioning,
		disableFocusTrap,
		arrowSize,
		escapeBehavior,
		closeOnOutsideClick,
		preventScroll,
		preventTextSelectionOverflow,
		portal = true, // Portal to body required for Storybook iframe rendering
		forceVisible = true,
		openFocus,
		closeFocus,
		defaultOpen,
		open = $bindable(),
		onOpenChange,
		children
	}: Props = $props();

	const builder = createPopover({
		defaultOpen: untrack(() => defaultOpen),
		onOpenChange: ({ next }) => {
			if (open !== next) {
				open = next;
				onOpenChange?.(next);
			}
			return next;
		}
	});

	const {
		options,
		states: { open: openStore }
	} = builder;

	setCtx(builder);

	$effect(() => {
		options.positioning.set(positioning);
		options.disableFocusTrap.set(disableFocusTrap);
		options.arrowSize.set(arrowSize);
		options.escapeBehavior.set(escapeBehavior);
		options.closeOnOutsideClick.set(closeOnOutsideClick);
		options.preventScroll.set(preventScroll);
		options.preventTextSelectionOverflow.set(preventTextSelectionOverflow);
		options.portal.set(portal);
		options.forceVisible.set(forceVisible);
		options.openFocus.set(openFocus);
		options.closeFocus.set(closeFocus);
	});

	$effect(() => {
		if (open !== undefined && open !== $openStore) {
			openStore.set(open);
		}
	});
</script>

{@render children?.()}
