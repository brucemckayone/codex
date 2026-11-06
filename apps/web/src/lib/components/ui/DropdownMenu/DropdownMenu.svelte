<script lang="ts">
	import { type CreateDropdownMenuProps, createDropdownMenu } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateDropdownMenuProps, 'open' | 'onOpenChange'> & {
		children?: Snippet;
		open?: boolean;
        onOpenChange?: (open: boolean) => void;
	};

	let {
		// Every option the $effect below sets needs a default: one left
		// `undefined` is `.set(undefined)` over Melt's own. These four are
		// Melt's. Unset, `positioning` let floating-ui fall back to its own
		// 'top', and `closeOnItemClick` let no item press close the menu, so
		// an item that opens a dialog left the menu open under it, holding
		// the focus the dialog gives back (Codex-vlphc review G4-M3). Nothing
		// renders Melt's arrow yet; `arrowSize` sizes one if it ever does.
		positioning = { placement: 'bottom' },
		arrowSize = 8,
		loop = false,
		closeOnItemClick = true,
		// A menu deliberately leaves the page free to scroll; Melt's default locks it.
		preventScroll = false,
		// Default to Melt's own default (true). Destructuring with no default
		// leaves this `undefined`, and the $effect below then does
		// `.set(undefined)` — which disables Melt's interact-outside listener
		// (`enabled: closeOnInteractOutside`), so the menu never closes on an
		// outside click (avatar / studio-switcher popovers).
		closeOnOutsideClick = true,
		// Melt UI's portal option accepts `string | HTMLElement | null` — boolean
		// `true` is a no-op (usePortal returns early). Default to `'body'` so the
		// menu escapes overflow/transform ancestors (e.g. studio sidebar's
		// `overflow:hidden` flex column would otherwise displace the layout).
		portal = 'body',
		forceVisible = true,
		defaultOpen,
		open = $bindable(),
		onOpenChange,
		children
	}: Props = $props();

	const builder = createDropdownMenu({
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
		options.arrowSize.set(arrowSize);
		options.preventScroll.set(preventScroll);
		options.loop.set(loop);
		options.closeOnItemClick.set(closeOnItemClick);
		options.closeOnOutsideClick.set(closeOnOutsideClick);
		options.portal.set(portal);
		options.forceVisible.set(forceVisible);
	});

	$effect(() => {
		if (open !== undefined && open !== $openStore) {
			openStore.set(open);
		}
	});
</script>

{@render children?.()}