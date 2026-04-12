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
		<svelte:component this={IconComponent} size={22} />
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
		<svelte:component this={IconComponent} size={22} />
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
		padding: var(--space-2) var(--space-3);
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
