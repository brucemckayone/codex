<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect x="6" y="4" width="4" height="16" />
	<rect x="14" y="4" width="4" height="16" />
</IconBase>
