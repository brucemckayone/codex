<!--
  @component BrandEditorIntroVideo

  Brand editor level for uploading an org intro video.
  Uses content-api's media pipeline (presigned URL upload + transcoding)
  then links the media item to branding via org-api.

  State is local — NOT part of BrandEditorState (video commits immediately,
  doesn't participate in the brand editor's save/discard/dirty flow).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { brandEditor } from '$lib/brand-editor';
  import { createMedia, completeUpload } from '$lib/remote/media.remote';
  import {
    linkIntroVideo,
    getIntroVideoStatus,
    deleteIntroVideo,
  } from '$lib/remote/branding.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { PlayIcon } from '$lib/components/ui/Icon';

  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

  // ── Local state (independent from brand editor save/discard) ──
  type Phase = 'idle' | 'creating' | 'uploading' | 'completing' | 'linking' | 'transcoding' | 'ready' | 'failed';
  let phase = $state<Phase>('idle');
  let uploadProgress = $state(0);
  let transcodingProgress = $state<number | null>(null);
  let introVideoUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  let mediaItemId = $state<string | null>(null);
  // svelte-ignore non_reactive_update
  let fileInput: HTMLInputElement;
  let deleting = $state(false);

  const orgId = $derived(brandEditor.orgId);
  const busy = $derived(
    phase === 'creating' || phase === 'uploading' || phase === 'completing' || phase === 'linking'
  );

  // ── On mount: check if an intro video already exists ──
  onMount(() => {
    if (!orgId) return;
    checkExistingVideo();
  });

  async function checkExistingVideo() {
    if (!orgId) return;
    try {
      const status = await getIntroVideoStatus(orgId);
      if (status.status === 'ready' && status.introVideoUrl) {
        phase = 'ready';
        introVideoUrl = status.introVideoUrl;
      } else if (status.status === 'transcoding') {
        phase = 'transcoding';
        transcodingProgress = status.progress;
      } else if (status.status === 'failed') {
        phase = 'failed';
        error = status.error;
      }
      // 'none' / 'idle' → stay in idle
    } catch {
      // No existing video — stay idle
    }
  }

  // ── Polling: auto-check transcoding status ──
  $effect(() => {
    if (phase !== 'transcoding' || !orgId) return;
    const interval = setInterval(async () => {
      try {
        const status = await getIntroVideoStatus(orgId);
        if (status.status === 'ready') {
          phase = 'ready';
          introVideoUrl = status.introVideoUrl;
        } else if (status.status === 'failed') {
          phase = 'failed';
          error = status.error;
        } else {
          transcodingProgress = status.progress;
        }
      } catch {
        // Poll failed — retry on next interval
      }
    }, 4000);
    return () => clearInterval(interval);
  });

  // ── File selection ──
  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      error = 'Please select an MP4, WebM, or MOV video file.';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      error = 'Video must be less than 500MB.';
      return;
    }

    error = null;
    startUpload(file);
  }

  // ── Multi-step upload flow ──
  async function startUpload(file: File) {
    if (!orgId) return;

    try {
      // Step 1: Create media item → get presigned URL
      phase = 'creating';
      uploadProgress = 0;
      const media = await createMedia({
        title: file.name.replace(/\.[^/.]+$/, ''),
        mediaType: 'video',
        mimeType: file.type,
        fileSizeBytes: file.size,
      });
      mediaItemId = media.id;
      const presignedUrl = media.presignedUrl;

      // Step 2: Upload to R2 via presigned URL (or fallback)
      phase = 'uploading';
      if (presignedUrl) {
        try {
          await xhrUpload(presignedUrl, 'PUT', file);
        } catch {
          // Fallback to worker upload
          await xhrUpload(`/api/media/${media.id}/upload`, 'POST', file, true);
        }
      } else {
        await xhrUpload(`/api/media/${media.id}/upload`, 'POST', file, true);
      }

      // Step 3: Mark complete → triggers transcoding
      phase = 'completing';
      await completeUpload(media.id);

      // Step 4: Link media item to branding
      phase = 'linking';
      await linkIntroVideo({ orgId, mediaItemId: media.id });

      // Step 5: Start polling
      phase = 'transcoding';
      transcodingProgress = 0;
    } catch (err) {
      phase = 'failed';
      error = err instanceof Error ? err.message : 'Upload failed';
    }

    // Reset file input
    if (fileInput) fileInput.value = '';
  }

  // ── XHR upload with progress ──
  function xhrUpload(
    url: string,
    method: 'PUT' | 'POST',
    file: File,
    withCredentials = false
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgress = Math.round((e.loaded / e.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.open(method, url);
      xhr.setRequestHeader('Content-Type', file.type);
      if (withCredentials) xhr.withCredentials = true;
      xhr.send(file);
    });
  }

  // ── Delete ──
  async function handleDelete() {
    if (!orgId) return;
    deleting = true;
    try {
      await deleteIntroVideo(orgId);
      phase = 'idle';
      introVideoUrl = null;
      mediaItemId = null;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete video';
    } finally {
      deleting = false;
    }
  }

  // ── Retry ──
  function handleRetry() {
    phase = 'idle';
    error = null;
    uploadProgress = 0;
    transcodingProgress = null;
  }
</script>

<div class="intro-video">
  {#if phase === 'idle'}
    <!-- Upload zone -->
    <div class="intro-video__zone">
      <span class="intro-video__zone-icon" aria-hidden="true">
        <PlayIcon size={32} />
      </span>
      <p class="intro-video__zone-text">Upload a short intro video for your hero section</p>
    </div>

    <div class="intro-video__actions">
      <input
        bind:this={fileInput}
        id="intro-video-upload"
        name="introVideo"
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onchange={handleFileSelect}
      />
      <Button
        variant="secondary"
        size="sm"
        onclick={() => fileInput?.click()}
      >
        Choose Video
      </Button>
    </div>

    <p class="intro-video__hint">MP4, WebM, or MOV. Max 500MB.</p>

  {:else if phase === 'creating' || phase === 'completing' || phase === 'linking'}
    <!-- Processing steps -->
    <div class="intro-video__status" role="status" aria-live="polite">
      <div class="intro-video__spinner" aria-hidden="true"></div>
      <p class="intro-video__status-text">
        {phase === 'creating' ? 'Preparing upload...' : phase === 'completing' ? 'Starting transcoding...' : 'Linking to brand...'}
      </p>
    </div>

  {:else if phase === 'uploading'}
    <!-- Upload progress -->
    <div class="intro-video__status" role="status" aria-live="polite">
      <div class="intro-video__progress-bar" aria-hidden="true">
        <div class="intro-video__progress-fill" style:width="{uploadProgress}%"></div>
      </div>
      <p class="intro-video__status-text">Uploading... {uploadProgress}%</p>
    </div>

  {:else if phase === 'transcoding'}
    <!-- Transcoding in progress -->
    <div class="intro-video__status" role="status" aria-live="polite">
      <div class="intro-video__spinner" aria-hidden="true"></div>
      <p class="intro-video__status-text">
        Processing video{transcodingProgress != null ? ` (${transcodingProgress}%)` : '...'}
      </p>
      <p class="intro-video__hint">This may take a few minutes.</p>
    </div>

  {:else if phase === 'ready'}
    <!-- Video ready -->
    <div class="intro-video__ready">
      <div class="intro-video__ready-badge">Ready</div>
      <p class="intro-video__ready-url">{introVideoUrl ? 'HLS stream available' : 'Video processed'}</p>
    </div>

    <div class="intro-video__actions">
      <input
        bind:this={fileInput}
        id="intro-video-replace"
        name="introVideo"
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onchange={handleFileSelect}
      />
      <Button
        variant="secondary"
        size="sm"
        onclick={() => fileInput?.click()}
      >
        Replace
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={handleDelete}
        disabled={deleting}
      >
        {deleting ? 'Deleting...' : 'Remove'}
      </Button>
    </div>

  {:else if phase === 'failed'}
    <!-- Error state -->
    <div class="intro-video__status">
      <p class="intro-video__error" role="alert">{error ?? 'Something went wrong'}</p>
      <Button variant="secondary" size="sm" onclick={handleRetry}>
        Try Again
      </Button>
    </div>
  {/if}

  {#if error && phase !== 'failed'}
    <p class="intro-video__error" role="alert">{error}</p>
  {/if}
</div>

<style>
  .intro-video {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-2);
  }

  .intro-video__zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-4);
    border: var(--border-width-thick) dashed var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    text-align: center;
  }

  .intro-video__zone-icon {
    display: inline-flex;
    color: var(--color-text-muted);
    opacity: var(--opacity-40);
  }

  .intro-video__zone-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 24ch;
  }

  .intro-video__actions {
    display: flex;
    gap: var(--space-2);
  }

  .intro-video__hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .intro-video__status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }

  .intro-video__status-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .intro-video__progress-bar {
    width: 100%;
    height: var(--space-2);
    background: var(--color-surface-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .intro-video__progress-fill {
    height: 100%;
    background: var(--color-brand-primary);
    border-radius: var(--radius-full);
    transition: width var(--duration-fast) var(--ease-default);
  }

  .intro-video__spinner {
    width: var(--space-6);
    height: var(--space-6);
    border: var(--border-width-thick) solid var(--color-border-subtle);
    border-top-color: var(--color-brand-primary);
    border-radius: var(--radius-full);
    animation: spin var(--duration-slow) linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .intro-video__spinner {
      animation: none;
    }
  }

  .intro-video__ready {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
  }

  .intro-video__ready-badge {
    padding: var(--space-1) var(--space-3);
    background: var(--color-success-100);
    color: var(--color-success-700);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .intro-video__ready-url {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .intro-video__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-500);
  }
</style>
