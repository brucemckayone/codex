<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PreviewPlayer from './PreviewPlayer.svelte';

	const { Story } = defineMeta({
		title: 'Player/PreviewPlayer',
		component: PreviewPlayer,
		tags: ['autodocs'],
		argTypes: {
			contentId: {
				control: 'text',
				description: 'Content ID for access checking'
			},
			thumbnailUrl: {
				control: 'text',
				description: 'Thumbnail image URL'
			},
			title: {
				control: 'text',
				description: 'Content title'
			},
			previewLimit: {
				control: 'number',
				description: 'Preview duration in seconds (default: 30)'
			},
			autoplay: {
				control: 'boolean',
				description: 'Auto-start playback on mount'
			}
		}
	});
</script>

<!-- Default State -->
<Story name="Default">
	<PreviewPlayer
		contentId="preview-content-123"
		thumbnailUrl="https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&h=450&fit=crop"
		title="Introduction to Svelte 5"
	/>
</Story>

<!-- Without Thumbnail -->
<Story name="No Thumbnail">
	<PreviewPlayer contentId="preview-content-456" title="Audio Content Preview" />
</Story>

<!-- Custom Preview Limit -->
<Story name="Short Preview">
	<PreviewPlayer
		contentId="preview-content-789"
		previewLimit={10}
		thumbnailUrl="https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&h=450&fit=crop"
		title="10 Second Preview"
	/>
</Story>

<!-- Autoplay -->
<Story name="Autoplay">
	<PreviewPlayer
		contentId="preview-content-abc"
		autoplay={true}
		thumbnailUrl="https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&h=450&fit=crop"
		title="Auto-playing Preview"
	/>
</Story>
