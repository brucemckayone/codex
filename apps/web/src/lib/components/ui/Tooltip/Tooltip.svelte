<script lang="ts">
	import { type CreateTooltipProps, createTooltip } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateTooltipProps, 'open' | 'onOpenChange'> & {
		children?: Snippet;
        open?: boolean;
        onOpenChange?: (open: boolean) => void;
	};

	let {
		positioning,
		arrowSize,
		openDelay,
		closeDelay,
		closeOnPointerDown,
		escapeBehavior,
		portal = true, // Default to true for Storybook compatibility
		forceVisible = true,
		defaultOpen,
		open = $bindable(),
		onOpenChange,
		disableHoverableContent,
		group,
		children
	}: Props = $props();

	const builder = createTooltip({
		defaultOpen: untrack(() => defaultOpen),
		group: untrack(() => group),
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
		options.arrowSize.set(arrowSize);
		options.openDelay.set(openDelay);
		options.closeDelay.set(closeDelay);
		options.closeOnPointerDown.set(closeOnPointerDown);
		options.escapeBehavior.set(escapeBehavior);
		options.portal.set(portal);
		options.forceVisible.set(forceVisible);
		options.disableHoverableContent.set(disableHoverableContent);
	});

	$effect(() => {
		if (open !== undefined && open !== $openStore) {
			openStore.set(open);
		}
	});
</script>

{@render children?.()}
