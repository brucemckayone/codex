<script lang="ts">
	import { createTooltip, melt } from '@melt-ui/svelte';
	import type { RailIcon } from '$lib/config/navigation';
	import { RAIL_ICON_MAP } from '$lib/config/rail-icons';

	interface Props {
		href: string;
		label: string;
		icon: RailIcon;
		active?: boolean;
		expanded?: boolean;
		index?: number;
	}

	const {
		href,
		label,
		icon,
		active = false,
		expanded = false,
		index = 0,
	}: Props = $props();

	const IconComponent = $derived(RAIL_ICON_MAP[icon]);

	const {
		elements: { trigger, content },
		states: { open },
	} = createTooltip({
		positioning: { placement: 'right' },
		openDelay: 0,
		closeDelay: 0,
		forceVisible: true,
	});
</script>

{#if expanded}
	<a
		{href}
		class="rail-item"
		class:rail-item--active={active}
		aria-current={active ? 'page' : undefined}
		aria-label={label}
		style:--item-index={index}
	>
		<!-- No `size` prop: the glyph is sized in CSS from --space-5-5 so it
		     tracks the org's density scale. See the .rail-item svg rule. -->
		<IconComponent />
		<span class="rail-item__label">{label}</span>
	</a>
{:else}
	<a
		{href}
		class="rail-item"
		class:rail-item--active={active}
		aria-current={active ? 'page' : undefined}
		aria-label={label}
		use:melt={$trigger}
	>
		<!-- No `size` prop: the glyph is sized in CSS from --space-5-5 so it
		     tracks the org's density scale. See the .rail-item svg rule. -->
		<IconComponent />
	</a>
	{#if $open}
		<div use:melt={$content} class="rail-item__tooltip">
			{label}
		</div>
	{/if}
{/if}

<style>
	.rail-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-2);
		/* Inline padding is DERIVED from the rail so the icon is centred
		   structurally rather than by coincidence. The item is a flex row whose
		   first child is the glyph, so the glyph's left edge sits exactly at
		   padding-inline — meaning it is centred in the collapsed rail only when
		   that padding equals half the leftover space. A literal --space-3 (12px)
		   satisfied that at density 1 by accident, because
		   (64 - 2*8 margin - 22 icon) / 2 = 13px ≈ 12px. At any other density the
		   coincidence broke and the glyph drifted off-centre (measured 4.5px at
		   density 0.8). Expressing it as the real half-of-leftover keeps the
		   glyph's optical centre on the rail's centre line at every density.
		   When the rail hover-expands this padding stays put, which is what we
		   want: the icon column holds its x position while the label reveals to
		   its right. */
		/* max() guards the degenerate case: below md --app-sidebar-width collapses
		   to 0px, which makes the calc negative — and a negative padding is an
		   invalid value, so the whole declaration would be dropped. */
		padding-inline: max(
			0px,
			calc(
				(var(--app-sidebar-width) - 2 * var(--space-2) - var(--rail-glyph, var(--space-5-5))) / 2
			)
		);
		margin: 0 var(--space-2);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		transition: var(--transition-colors);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		min-height: var(--space-10);
	}

	/* Size the glyph from the density-aware spacing scale instead of a literal
	   `size={22}` prop. --space-5-5 IS 22px at density 1, so default rendering is
	   unchanged, but the glyph now grows with the rail instead of staying pinned.
	   CSS width/height win over the SVG's width/height presentation attributes,
	   so this overrides IconBase's default without needing a prop.
	   `flex-shrink: 0` is the important half: an SVG with a width attribute is
	   still a shrinkable flex item, so when density inflated the padding inside a
	   frozen 64px rail the glyph absorbed the entire squeeze and collapsed to a
	   3px-wide sliver. */
	.rail-item :global(svg) {
		flex-shrink: 0;
		/* reset.css applies `max-width: 100%` to svg/img to stop media overflowing.
		   On a glyph whose size we set deliberately that silently caps the width at
		   the content box while `height` — which has no max-height counterpart —
		   obeys, rendering a squashed non-square icon. The derived padding above
		   makes the content box equal the glyph exactly, so the rail's 1px glass
		   border is enough to trip the clamp. */
		max-width: none;
		width: var(--rail-glyph, var(--space-5-5));
		height: var(--rail-glyph, var(--space-5-5));
	}

	.rail-item:hover {
		background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
		color: var(--color-text);
	}

	.rail-item--active {
		background-color: color-mix(in oklch, var(--color-interactive) 15%, transparent);
		color: var(--color-interactive);
	}

	.rail-item__label {
		opacity: 0;
		transform: translateX(calc(-1 * var(--space-1)));
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
		transition-delay: calc(30ms * var(--item-index, 0));
	}

	:global([data-expanded='true']) .rail-item__label {
		opacity: 1;
		transform: translateX(0);
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-item__label {
			transition-delay: 0ms;
			transition: opacity var(--duration-fast) var(--ease-default);
			transform: none;
		}
	}

	.rail-item__tooltip {
		background: var(--color-surface-secondary);
		color: var(--color-text);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		z-index: var(--z-dropdown);
		pointer-events: none;
	}
</style>
