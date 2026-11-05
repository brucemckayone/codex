<!--
  @component Popover.Root

  Melt's createPopover: a non-modal dialog under its trigger. While open it
  keeps Tab inside, and Escape, a press outside or its Close shut it.

  @prop {CreatePopoverProps['openFocus']} [openFocus] - Where focus goes as it
    opens: an element, a selector, or a function returning either. Omitted,
    Melt's own default.
  @prop {CreatePopoverProps['closeFocus']} [closeFocus] - Where focus goes as
    it closes, in the same shapes. Omitted, back to the trigger, as always. A
    function runs a moment after the close and may return nothing, which
    leaves focus where it is (a press outside that landed on a field).
-->
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
		// Melt's default too, for the same reason as `closeOnOutsideClick`: its
		// Escape handler spreads `{ behaviorType: undefined }` over its own
		// 'close', so without this Escape never closed a popover.
		escapeBehavior = 'close',
		// Default to Melt's own default (true). Without it this is `undefined`
		// and the $effect below `.set(undefined)`s it, disabling the
		// interact-outside listener so the popover never closes on outside click.
		closeOnOutsideClick = true,
		preventScroll,
		preventTextSelectionOverflow,
		// Rendered in place. This was `true`, read as "portal to body", but Melt's
		// portal takes a selector or an element and does nothing with `true`; and
		// `true` failed the type check. `null` is Melt's own "no portal".
		portal = null,
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
