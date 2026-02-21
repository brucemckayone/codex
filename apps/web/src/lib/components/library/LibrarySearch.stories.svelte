<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LibrarySearch from './LibrarySearch.svelte';

	const { Story } = defineMeta({
		title: 'Library/LibrarySearch',
		component: LibrarySearch,
		tags: ['autodocs'],
		argTypes: {
			value: {
				control: 'text',
				description: 'Initial search value'
			},
			delay: {
				control: 'number',
				description: 'Debounce delay in milliseconds'
			}
		}
	});
</script>

<!-- Default State -->
<Story name="Default">
	<LibrarySearch onSearch={(value) => console.log('Search:', value)} />
</Story>

<!-- With Initial Value -->
<Story name="With Value">
	<LibrarySearch
		value="coding tutorial"
		onSearch={(value) => console.log('Search:', value)}
	/>
</Story>

<!-- Custom Delay -->
<Story name="Fast Debounce">
	<LibrarySearch
		delay={100}
		onSearch={(value) => console.log('Search:', value)}
	/>
</Story>
