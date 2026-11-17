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
		// Melt's default too. Its Escape handler spreads `{ behaviorType:
		// undefined }` over its own 'close', so without this Escape never
		// closed a tooltip, and one must close without moving the pointer
		// (WCAG 1.4.13).
		escapeBehavior = 'close',
		// Rendered in place. This was `true`, read as "portal to body", but
		// Melt's portal takes a selector or an element and does nothing with
		// `true`; and `true` failed the type check. `null` is Melt's own "no
		// portal".
		portal = null,
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
