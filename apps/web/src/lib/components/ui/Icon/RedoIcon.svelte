<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="m15 14 5-5-5-5" />
	<path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
</IconBase>
