<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="m16 3 4 4-4 4" />
	<path d="M20 7H4" />
	<path d="m8 21-4-4 4-4" />
	<path d="M4 17h16" />
</IconBase>
