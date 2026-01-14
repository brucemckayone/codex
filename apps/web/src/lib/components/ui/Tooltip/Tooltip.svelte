<script lang="ts">
	import { type CreateTooltipProps, createTooltip } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
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
		forceVisible,
		defaultOpen,
		open = $bindable(),
		onOpenChange,
		disableHoverableContent,
		group,
		children
	}: Props = $props();

	const builder = createTooltip({
		defaultOpen,
		group,
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
