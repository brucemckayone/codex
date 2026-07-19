<!--
  @component Brand-preview player demo (Codex-cijzb · rail-UX follow-up)

  A SELF-CONTAINED, always-works preview surface for the `/studio/brand` canvas'
  "Player" lens. The real audio/video players can't be previewed reliably: they
  need a published content item of the matching media type (a catch-22 — an org
  with only video can't preview audio, an org with none can't preview either),
  and the video player attaches HLS on mount so it can't render inert.

  So this route renders the player CHROME in fixed demo states with NO network,
  NO HLS, NO real media — purely to show how the org's BRANDING lands on the
  player surfaces. It lives on the org subdomain inside `.org-layout`, so it
  inherits the org brand tokens AND the WP-1.4 preview bridge: editing a colour
  in the studio updates this demo live, same as any other preview route.

  It reuses the REAL `Waveform` component (fully inert with a static amplitude
  array — it reads `--color-brand-primary`/`--color-brand-secondary`), and
  replicates the transport/video chrome with the real player design tokens
  (`--color-player-*`, `--color-brand-primary`) rather than mounting the real
  players (which would spin up HLS). Not a public destination — noindex.
-->
<script lang="ts">
  import Waveform from '$lib/components/AudioPlayer/Waveform.svelte';

  // A static, pleasant amplitude profile (0–1) — no audio analysis needed. The
  // Waveform component paints it in the brand colours (played vs unplayed split
  // at `currentTime / duration`).
  const DEMO_WAVEFORM: number[] = [
    0.22, 0.35, 0.48, 0.62, 0.55, 0.7, 0.82, 0.6, 0.45, 0.5, 0.68, 0.9, 0.75,
    0.58, 0.4, 0.52, 0.66, 0.8, 0.95, 0.72, 0.5, 0.38, 0.46, 0.6, 0.74, 0.88,
    0.7, 0.54, 0.42, 0.56, 0.68, 0.84, 0.78, 0.6, 0.44, 0.5, 0.64, 0.76, 0.58,
    0.4, 0.48, 0.62, 0.72, 0.86, 0.66, 0.5, 0.36, 0.3,
  ];

  const AUDIO_DURATION = 126; // 2:06
  const AUDIO_POSITION = 38; // 0:38
  const VIDEO_PROGRESS = 0.35;

  const noop = (): void => {};

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<svelte:head>
  <title>Player preview</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="pv">
  <header class="pv__intro">
    <h1 class="pv__heading">Player preview</h1>
    <p class="pv__lede">
      A sample of how your brand lands on the audio and video players. This is a
      preview only — no real media plays here.
    </p>
  </header>

  <!-- ── Audio player ── -->
  <article class="pv-card" aria-label="Audio player preview">
    <div class="pv-card__meta">
      <span class="pv-badge">Audio</span>
      <div class="pv-card__titles">
        <p class="pv-card__title">A sample episode</p>
        <p class="pv-card__sub">Your audio player, in your brand</p>
      </div>
    </div>

    <div class="pv-audio__wave">
      <Waveform
        data={DEMO_WAVEFORM}
        currentTime={AUDIO_POSITION}
        duration={AUDIO_DURATION}
        onseek={noop}
        playing={false}
      />
    </div>

    <div class="pv-transport">
      <button type="button" class="pv-play" aria-label="Play (preview)" disabled>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </button>
      <span class="pv-time">{fmt(AUDIO_POSITION)} / {fmt(AUDIO_DURATION)}</span>
      <span class="pv-transport__spacer"></span>
      <button type="button" class="pv-chip" aria-label="Playback speed (preview)" disabled>
        1×
      </button>
      <button type="button" class="pv-icon" aria-label="Volume (preview)" disabled>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 9v6h4l5 5V4L8 9H4z M16 8a4 4 0 0 1 0 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </article>

  <!-- ── Video player ── -->
  <article class="pv-card" aria-label="Video player preview">
    <div class="pv-card__meta">
      <span class="pv-badge">Video</span>
      <div class="pv-card__titles">
        <p class="pv-card__title">A sample video</p>
        <p class="pv-card__sub">Your video player, in your brand</p>
      </div>
    </div>

    <div class="pv-video">
      <div class="pv-video__poster" aria-hidden="true"></div>
      <button type="button" class="pv-video__bigplay" aria-label="Play (preview)" disabled>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </button>

      <div class="pv-video__controls">
        <div class="pv-progress">
          <div class="pv-progress__fill" style:width="{VIDEO_PROGRESS * 100}%"></div>
        </div>
        <div class="pv-video__row">
          <span class="pv-video__glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </span>
          <span class="pv-time pv-time--onmedia">
            {fmt(VIDEO_PROGRESS * AUDIO_DURATION)} / {fmt(AUDIO_DURATION)}
          </span>
          <span class="pv-transport__spacer"></span>
          <span class="pv-video__glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  </article>
</main>

<style>
  .pv {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--container-md);
    margin: 0 auto;
    padding: var(--space-8) var(--space-4);
  }

  .pv__intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .pv__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-heading, var(--color-text));
  }

  .pv__lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 52ch;
  }

  /* ── Card shell ── */
  .pv-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .pv-card__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .pv-badge {
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-brand-primary);
    background: var(--color-brand-primary-subtle);
    border-radius: var(--radius-full);
  }

  .pv-card__titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .pv-card__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-heading, var(--color-text));
  }

  .pv-card__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Audio ── */
  .pv-audio__wave {
    min-height: var(--space-16);
  }

  .pv-transport {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .pv-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-11);
    height: var(--space-11);
    color: var(--color-text-on-brand, #fff);
    background: var(--color-brand-primary);
    border: none;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .pv-time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }

  .pv-transport__spacer {
    flex: 1;
  }

  .pv-chip,
  .pv-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .pv-chip {
    min-width: var(--space-8);
    height: var(--space-8);
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
  }

  .pv-icon {
    width: var(--space-8);
    height: var(--space-8);
  }

  /* ── Video ── */
  .pv-video {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    isolation: isolate;
  }

  /* Poster stand-in — a brand-tinted wash so the frame reads as "video" without
     shipping a real asset. */
  .pv-video__poster {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        120% 120% at 30% 20%,
        var(--color-brand-primary-subtle),
        transparent 60%
      ),
      linear-gradient(
        135deg,
        color-mix(in oklch, var(--color-brand-primary) 30%, var(--color-surface-secondary)),
        var(--color-surface-secondary)
      );
  }

  .pv-video__bigplay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-16);
    height: var(--space-16);
    color: var(--color-text-on-brand, #fff);
    background: var(--color-brand-primary);
    border: none;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-lg);
    z-index: 1;
  }

  .pv-video__controls {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-3) var(--space-3);
    background: linear-gradient(
      to top,
      var(--color-player-gradient-bottom, rgb(0 0 0 / 0.6)),
      transparent
    );
  }

  .pv-progress {
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in oklch, var(--color-player-text, #fff) 30%, transparent);
    overflow: hidden;
  }

  .pv-progress__fill {
    height: 100%;
    background: var(--color-brand-primary);
    border-radius: var(--radius-full);
  }

  .pv-video__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pv-video__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-player-text, #fff);
  }

  .pv-time--onmedia {
    color: var(--color-player-text, #fff);
  }

  /* Nothing here is operable — it's a static brand preview. */
  .pv-card button {
    cursor: default;
  }
</style>
