<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<line x1="3" x2="21" y1="6" y2="6" />
	<line x1="3" x2="21" y1="12" y2="12" />
	<line x1="3" x2="21" y1="18" y2="18" />
</IconBase>
