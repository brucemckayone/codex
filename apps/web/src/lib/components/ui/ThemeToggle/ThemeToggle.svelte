<script lang="ts">
	import { onMount } from 'svelte';
	import { getTheme, toggleTheme, type Theme } from '$lib/theme';
	import { SunIcon, MoonIcon } from '$lib/components/ui/Icon';
	import * as m from '$paraglide/messages';

	interface Props {
		/** Show the text label alongside the icon */
		showLabel?: boolean;
		/** Icon size */
		size?: number;
	}

	const { showLabel = false, size = 20 }: Props = $props();

	let theme = $state<Theme>('light');

	onMount(() => {
		theme = getTheme();
	});

	function handleToggle() {
		theme = toggleTheme();
	}

	const label = $derived(
		theme === 'light' ? m.sidebar_theme_dark() : m.sidebar_theme_light()
	);
</script>

<button
	type="button"
	class="theme-toggle"
	onclick={handleToggle}
	aria-label={label}
	title={showLabel ? undefined : label}
>
	{#if theme === 'light'}
		<MoonIcon {size} />
	{:else}
		<SunIcon {size} />
	{/if}
	{#if showLabel}
		<span class="theme-toggle__label">{label}</span>
	{/if}
</button>

<style>
	.theme-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		transition: background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		cursor: pointer;
		background: none;
		border: none;
		white-space: nowrap;
		overflow: hidden;
		min-height: var(--space-10);
	}

	.theme-toggle:hover {
		background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
		color: var(--color-text);
	}

	.theme-toggle__label {
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
	}
</style>
