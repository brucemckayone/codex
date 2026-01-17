<!--
  @component Tabs

  A tabs component for organizing content into switchable panels.
  Supports horizontal/vertical orientation and keyboard navigation.

  @prop {('horizontal'|'vertical')} [orientation='horizontal'] - Tab list layout
  @prop {boolean} [activateOnFocus=true] - Switch tabs on focus or require click
  @prop {boolean} [loop=true] - Allow keyboard navigation to wrap
  @prop {boolean} [autoSet=true] - Automatically set active tab on mount
  @prop {string} value - Bindable active tab value
  @prop {string} [defaultValue] - Initial tab value (captured at init only)
  @prop {function} [onValueChange] - Callback when active tab changes

  @example
  <Tabs.Root bind:value={activeTab}>
    <Tabs.List>
      <Tabs.Trigger value="account">Account</Tabs.Trigger>
      <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="account">Account content</Tabs.Content>
    <Tabs.Content value="settings">Settings content</Tabs.Content>
  </Tabs.Root>
-->
<script lang="ts">
	import { type CreateTabsProps, createTabs } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateTabsProps, 'value' | 'onValueChange'> & {
		children?: Snippet;
		class?: string;
		value?: string;
		onValueChange?: (value: string | undefined) => void;
	} & Record<string, unknown>; // TODO: Type Melt-UI rest props from CreateTabsProps if available

	let {
		orientation,
		activateOnFocus,
		loop,
		autoSet,
		defaultValue,
		value = $bindable(),
		onValueChange,
		children,
		class: className,
		...rest
	}: Props = $props();

	const builder = createTabs({
		defaultValue: untrack(() => defaultValue),
		autoSet: untrack(() => autoSet),
		orientation: untrack(() => orientation),
		onValueChange: ({ next }) => {
			onValueChange?.(next);
			return next;
		}
	});

	const {
		elements: { root },
		options,
		states: { value: valueStore }
	} = builder;
	setCtx(builder);

	// Sync component props → Melt-UI options (one-way)
	$effect(() => {
		options.orientation.set(orientation);
		options.activateOnFocus.set(activateOnFocus);
		options.loop.set(loop);
	});

	// Sync Melt-UI value store → component prop (one-way, separate effect prevents loops)
	$effect(() => {
		if (value !== $valueStore) {
			value = $valueStore;
		}
	});
</script>

<div {...$root} use:root class={className} {...rest}>
	{@render children?.()}
</div>
