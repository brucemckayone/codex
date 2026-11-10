<!-- Stands in for MediaPreviewPlayer: the creator's own player, minting its token on Play. -->
<script lang="ts">
  const {
    mediaId,
    mediaType,
    poster = null,
  }: { mediaId: string; mediaType: 'video' | 'audio'; title: string; poster?: string | null; sizes?: string } = $props();
</script>

<div data-probe="media-player" data-media-id={mediaId} data-type={mediaType} data-poster={poster ?? ''}></div>
