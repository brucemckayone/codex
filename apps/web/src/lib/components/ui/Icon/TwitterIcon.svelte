<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2 0 1.6-1 3-2 4 .8.1 2-.2 2-.5-3.2 3.2-8 2-10.5-3C-.4 7.3 3.3 1.2 8.5 1c2.1-.1 4 1.2 5.5 1.2.8 0 2.2-1.2 3.5-1.5z" />
</IconBase>
