<!--
  @component PreviewPlayerCore

  A film player that sells nothing: the `<video>`, its HLS stream and its
  controls — play/pause, a scrubber whose lighter band is what has loaded
  (buffering shows there, never as a spinner over the picture:
  Codex-1g5lh.14), the time as the stream reports it, mute, captions (only
  when it has tracks) and full screen. `PreviewPlayer` is this plus the
  content page's paywall; the page kit plays it in a section's own frame
  (`InlineFilm`) or in the theatre (`IntroVideoModal`). It imports no
  checkout remote and no `$app/state`, so it loads on demand (`load-core.ts`).

  It fills its parent: the frame decides the shape, and the film letterboxes
  inside it (`fit`) on a dark backdrop.

  SOUND (owner P7). `start="sound"` is a press: mounted in the press's own
  tick, the core calls `play()` unmuted before anything awaits, so Safari
  keeps the activation, and the stream attaches after (`start.ts`). A
  browser that refuses sound gets the film muted, and the mute button reads
  "Tap for sound".

  ONE AT A TIME (owner P3, `now-playing.svelte.ts`): starting this film
  pauses any other, and it pauses itself once scrolled out of view.

  RENEWAL. A full film is a signed stream (`src` resolving to `{ playlistUrl,
  expiresAt? }`) whose links run out in about ten minutes, so a longer film
  would stall. With `renew`, the core asks again ONCE per stream, and only
  for a stream that has played a frame: shortly before `expiresAt` while the
  film PLAYS (a one-shot timer, armed on play and cleared on pause, at the
  end, on an error and on destroy, so a paused or forgotten tab never asks:
  the owner's cost rule), at a press that resumes it once the links have run
  out, or when the stream answers 403 (`onUrlExpired`). The answer replaces
  the stream, and the film carries on from the same moment, playing or
  paused as it was, or as a press while it swapped said. No answer ends the
  film where it stands, as its own end does ("Watch again" then asks
  afresh): it never drops to the 30-second
  preview mid-film. A 403 BEFORE the stream's first frame is a refusal, not
  an expiry (a variant it will not serve, a token it will not take): asking
  again would loop, so a first stream says it could not play and a renewed
  one ends the film. And per PLAYBACK, never two asks within two minutes on
  the monotonic clock (`MIN_ASK_INTERVAL_MS`): a device clock running fast,
  or a 403 that is no expiry, cannot loop either. A plain string `src` (a
  preview) is public and never renewed.

  KEYBOARD (`media-a11y`), from anywhere inside it: Space or K play and
  pause, M mutes, the arrows seek five seconds, F is full screen.

  ITS OWN CONTROLS, ELSEWHERE (opt-in). A frame that draws its own chrome
  over a core with `controls={false}` hears the clock through `ontime` and
  drives the film through the core's own `toggle` and `toggleMute` (bound
  with `bind:this`), so it plays, pauses, renews and takes refused sound
  exactly as the core's buttons do. The Preview block's listening card
  plays audio this way, the picture hidden. No other caller passes it.

  `createHlsPlayer` returns `{ hls, cleanup }`: `hls` is the HLS.js instance
  (null on Safari's native HLS), `cleanup` detaches the native path's
  listener. Teardown calls both: `cleanup()` always, then `hls?.destroy()`.
  A stream that resolves after the core is gone is torn down on arrival.

  @prop src - The HLS manifest, or a promise of one while a press is still
    asking for the full film (`requestFilm`); read once, as it mounts
  @prop title - The film's name, for its accessible label
  @prop start - `sound` (a press), `muted` (autoplay) or `paused`
-->
<script lang="ts">
  import { flushSync, onMount, type Snippet, untrack } from 'svelte';
  import type Hls from 'hls.js';
  import {
    createMediaKeyboardHandler,
    MediaLiveRegion,
  } from '$lib/components/media-a11y';
  import {
    MaximizeIcon,
    PauseIcon,
    PlayIcon,
    Volume2Icon,
    VolumeXIcon,
  } from '$lib/components/ui/Icon';
  import { createHlsPlayer, type HlsErrorKind } from '$lib/components/VideoPlayer/hls';
  import * as m from '$paraglide/messages';
  import { claim, displaced, mark, release, showing } from './now-playing.svelte';
  import { playNow, settleStart } from './start';
  import { clock, loadedTo, type PlayerClock } from './timeline';

  interface CaptionTrack {
    src: string;
    srclang: string;
    label: string;
    default?: boolean;
  }

  /** A signed stream (a full film), and when its links run out (ISO). */
  interface SignedStream {
    playlistUrl: string;
    expiresAt?: string;
  }

  interface Props {
    src: string | Promise<string | SignedStream>;
    /** Ask again for a signed stream that is running out; `null` ends the film. */
    renew?: () => Promise<SignedStream | null>;
    /** Shown until the first frame, as `stillFit` sits it. */
    poster?: string | null;
    title: string;
    /** One per language; the CC button appears only when there is one. */
    captions?: CaptionTrack[];
    /** `contain` letterboxes the film inside its frame; `cover` fills it. */
    fit?: 'contain' | 'cover';
    /**
     * How the poster sits until the first frame; `fit` when unset.
     * `InlineFilm` passes its frame's own (`cover`), so a press never
     * redraws the full-bleed still as a letterboxed strip.
     */
    stillFit?: 'contain' | 'cover';
    /**
     * `sound`: a press, so `play()` runs unmuted as the core mounts — mount
     * it in the press's own tick. `muted`: plays muted once the stream is
     * attached (the content page's preview). `paused`: waits for its own
     * play button.
     */
    start?: 'sound' | 'muted' | 'paused';
    /** Stop here, in seconds, and count as ended: a preview's time limit. */
    limit?: number;
    /** Draw the "Preview" badge. */
    badge?: boolean;
    /** Draw the controls: off while something covers the film (a paywall). */
    controls?: boolean;
    /** Move focus to the play button as it mounts: a press removed the control that had it. */
    takeFocus?: boolean;
    onplay?: () => void;
    /**
     * The film stopped: `end`, it played to its end (or its `limit`);
     * `lapsed`, its stream ran out and no fresh one came back. A frame that
     * closes on a real end must not close on a lapse, or the film vanishes
     * mid-play with no word.
     */
    onended?: (reason: 'end' | 'lapsed') => void;
    /**
     * The film cannot play; `message` is what the core shows. A frame that
     * can offer a retry (`InlineFilm`) takes the visitor back to its poster.
     */
    onfail?: (message: string) => void;
    /**
     * Hears the clock as the element reports it (its `timeupdate`, length,
     * play and pause events; nothing polls), for a frame drawing its own
     * controls (ITS OWN CONTROLS, ELSEWHERE above).
     */
    ontime?: (clock: PlayerClock) => void;
    /** Drawn over the film once it ends, in place of the controls; `replay` starts it over. */
    ended?: Snippet<[replay: () => void]>;
    /**
     * A fixed moment, drawn with no stream: the brand studio's Player lens
     * (`brand-preview/player`) shows this very chrome in the org's colours,
     * so it can never drift from it (Codex-cijzb.17). Nothing attaches,
     * plays or listens; the controls answer hover and do nothing else. Read
     * once, as it mounts.
     */
    demo?: {
      time: number;
      duration: number;
      /** How far it has loaded, in seconds. */
      loaded: number;
      paused?: boolean;
      /** Sound was refused: the mute button reads "Tap for sound". */
      askSound?: boolean;
    };
    class?: string;
  }

  const {
    src,
    renew,
    poster = null,
    title,
    captions = [],
    fit = 'contain',
    stillFit,
    start = 'paused',
    limit,
    badge = false,
    controls = true,
    takeFocus = false,
    onplay,
    onended,
    onfail,
    ontime,
    ended,
    demo,
    class: className,
  }: Props = $props();

  const fixed = untrack(() => demo);

  /** iPhone Safari has no element full screen, only the video's own. */
  type AppleVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

  const SCRUB_STEPS: Record<string, number> = {
    ArrowLeft: -5,
    ArrowDown: -5,
    ArrowRight: 5,
    ArrowUp: 5,
  };

  /** A signed stream is renewed this long before its links run out. */
  const RENEW_LEAD_MS = 30_000;

  /**
   * Never two asks closer than this, whatever the device's clock says: a
   * fresh stream lives ten minutes, so no real expiry comes sooner. Measured
   * on the monotonic clock (`performance.now()`), because a clock running
   * fast puts every `expiresAt` in the past.
   */
  const MIN_ASK_INTERVAL_MS = 120_000;

  let root: HTMLDivElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let playButton: HTMLButtonElement | undefined = $state();
  let hls: Hls | null = null;
  let hlsCleanup: (() => void) | null = null;
  let destroyed = false;

  /**
   * The stream attached now; a signed one may be renewed (RENEWAL above).
   * `renewal`: it is a renewal's answer, so refusing it ends the film.
   */
  let stream: { url: string; signed: boolean; renewal: boolean } | null = null;
  /** When this playback last asked for a stream (`performance.now()`). */
  let lastAskAt: number | null = null;
  /** When its links run out (epoch ms), if the server said. */
  let expiry: number | null = null;
  /** Its links have run out (it answered 403), at `stoppedAt` seconds in. */
  let expired = false;
  let stoppedAt = 0;
  /** It has had its one renewal ask: once per expiry. */
  let asked = false;
  /** It has played a frame since it attached; a 403 before that is a refusal. */
  let flowing = false;
  /** Its element's error has had its one HLS.js recovery (`handleMediaError`). */
  let recovered = false;
  /** Drops the last swap's resume, should that stream go before it loads. */
  let unresume: (() => void) | null = null;
  let renewing = false;
  let renewTimer: ReturnType<typeof setTimeout> | null = null;
  /** The stream ran out and none came back: "Watch again" asks afresh. */
  let lapsed = false;

  // Mirrors of the element, driven by its own events, so the controls read
  // true whichever way it changed (a button, a key, the system's controls).
  // A demo starts, and stays, at its own moment.
  let paused = $state(fixed ? (fixed.paused ?? false) : true);
  let muted = $state(fixed?.askSound ?? false);
  /** Sound was refused: the mute button asks for it (owner P7). */
  let askSound = $state(fixed?.askSound ?? false);
  /** Nothing to show yet, or the stream has stalled: the scrubber says so. */
  let waiting = $state(!fixed);
  /** The first frame has loaded (the live region stops saying "loading"). */
  let ready = $state(Boolean(fixed));
  let time = $state(fixed?.time ?? 0);
  let duration = $state(fixed?.duration ?? 0);
  let loaded = $state(fixed?.loaded ?? 0);
  let finished = $state(false);
  let fullscreen = $state(false);
  let canFullscreen = $state(Boolean(fixed));
  let captionsOn = $state(false);
  let error = $state<string | null>(null);
  /**
   * The visitor wants it playing: false at any pause (theirs, the page's
   * one-film rule, the end), so nothing resumes behind them. A stream swap
   * fires no pause: the element's own reset is silent, so mid-swap the play
   * button reads, and a press sets, this instead (`resuming`).
   */
  let wanted = $state(false);
  /** A silent reset waits on its resume (`suspend`, `resumeAt`). */
  let resuming = $state(false);

  /** The play button offers Play: mid-swap, unless the visitor wants it playing. */
  const offerPlay = $derived(resuming ? !wanted : paused);
  const played = $derived(duration > 0 ? Math.min(1, time / duration) : 0);
  const fill = $derived(duration > 0 ? Math.min(1, loaded / duration) : 0);
  const muteLabel = $derived(
    askSound ? m.player_tap_for_sound() : muted ? m.player_unmute() : m.player_mute()
  );

  // The clock, told to a frame drawing its own controls. Read only while one
  // listens, so for every other caller a time update re-runs nothing.
  $effect(() => {
    if (!ontime) return;
    const now: PlayerClock = { time, duration, offerPlay, askSound };
    untrack(() => ontime(now));
  });

  function teardown() {
    if (hlsCleanup) {
      hlsCleanup();
      hlsCleanup = null;
    }
    if (hls) {
      hls.destroy();
      hls = null;
    }
    unresume?.();
    unresume = null;
  }

  /**
   * The film cannot play: say so, once, stop asking for it, and let the
   * stream go, so nothing is left to play under the error. Only a browser
   * with no way to play HLS at all (`unsupported`) is told to try another; a
   * media error past recovery is as often the film's own.
   */
  function fail(kind?: HlsErrorKind) {
    if (error !== null) return;
    error = kind === 'unsupported' ? m.player_error_format() : m.player_error();
    waiting = false;
    resuming = false;
    disarm();
    teardown();
    onfail?.(error);
  }

  function finish() {
    finished = true;
    resuming = false;
    disarm();
    onended?.(lapsed ? 'lapsed' : 'end');
  }

  function replay() {
    if (!video) return;
    finished = false;
    wanted = true;
    if (lapsed || stale()) {
      // The old stream's links are dead, or nearly: ask afresh, from the start.
      lapsed = false;
      void refresh(0);
    } else {
      video.currentTime = 0;
      playNow(video).catch(() => {});
    }
    // The ended layer that had focus has gone; the play button takes it.
    flushSync();
    playButton?.focus({ preventScroll: true });
  }

  /** Play or pause, as the play button does: a frame's own controls call it too. */
  export function toggle() {
    // Behind an error there is nothing to play, Space and K included.
    if (!video || fixed || error !== null) return;
    if (finished) {
      replay();
    } else if (resuming) {
      // Mid-swap the element sits paused, silently, either way: a press is
      // the visitor's say, and the resume honours it (`resumeAt`).
      wanted = !wanted;
    } else if (video.paused) {
      wanted = true;
      // Paused past its links' end: renew first, and the answer plays it.
      if (stale()) void refresh();
      else playNow(video).catch(() => {});
    } else {
      wanted = false;
      video.pause();
    }
  }

  /** Mute or unmute, as the mute button does ("Tap for sound" included). */
  export function toggleMute() {
    if (video && !fixed) video.muted = !video.muted;
  }

  function toggleCaptions() {
    if (!video?.textTracks) return;
    captionsOn = !captionsOn;
    const tracks = Array.from(video.textTracks);
    const lead = captions.find((track) => track.default) ?? captions[0];
    const shown = tracks.find((track) => track.language === lead?.srclang) ?? tracks[0];
    for (const track of tracks) {
      track.mode = captionsOn && track === shown ? 'showing' : 'hidden';
    }
  }

  async function toggleFullscreen() {
    if (!root || !video || fixed) return;
    try {
      if (document.fullscreenElement === root) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await root.requestFullscreen();
      else (video as AppleVideo).webkitEnterFullscreen?.();
    } catch {
      // Refused (a permissions policy, an iframe): the film plays on in place.
    }
  }

  function seek(to: number) {
    if (!video || fixed || duration <= 0) return;
    video.currentTime = Math.min(duration, Math.max(0, to));
    time = video.currentTime;
  }

  function measure() {
    if (!video) return;
    time = video.currentTime;
    // jsdom has no buffered ranges.
    loaded = video.buffered ? loadedTo(video.buffered, time) : 0;
  }

  function handlePlay() {
    paused = false;
    finished = false;
    // Playing, whoever asked (the OS's media keys too): the visitor wants
    // it, as any pause says they don't, so it renews and resumes after a
    // swap; and the button reads the element again.
    wanted = true;
    resuming = false;
    if (video) claim(video);
    arm();
    onplay?.();
  }

  function handlePause() {
    paused = true;
    wanted = false;
    disarm();
  }

  function handleLoaded() {
    ready = true;
    // A frame: the stream's links are good, so their end may be renewed.
    // Renewal first arms here, even for a press that played before the
    // stream attached.
    flowing = true;
    arm();
  }

  // The element's own error, which HLS.js does not always raise (a decode
  // failure). HLS.js recovers one on its next append, but the element says
  // so first, so each stream gets that recovery once; a second error is the
  // film's. The recovery resets the element, silently, so a film that was
  // playing picks up from its place once the stream is back; a paused one
  // already says so. On Safari's own HLS a network error is the renewal
  // signal, which the helper hands to `lapse`.
  function handleMediaError() {
    if (hls && video && !recovered) {
      recovered = true;
      const wasPlaying = !video.paused;
      const from = video.currentTime;
      const since = mark();
      hls.recoverMediaError();
      if (wasPlaying) {
        suspend();
        resumeAt(video, from, since);
      }
      return;
    }
    if (!hls && video?.error?.code === MediaError.MEDIA_ERR_NETWORK) return;
    fail('media');
  }

  function handleTimeUpdate() {
    measure();
    if (video && limit !== undefined && time >= limit && !finished) {
      video.pause();
      finish();
    }
  }

  function handleDuration() {
    if (video) duration = Number.isFinite(video.duration) ? video.duration : 0;
  }

  function handleVolume() {
    if (!video) return;
    muted = video.muted;
    if (!muted) askSound = false;
  }

  function handleFullscreen() {
    fullscreen = Boolean(root) && document.fullscreenElement === root;
  }

  const handleKey = createMediaKeyboardHandler({
    getWrapper: () => root,
    getMedia: () => video ?? null,
    shortcuts: {
      playPause: toggle,
      mute: toggleMute,
      seekSecs: 5,
      fullscreen: () => void toggleFullscreen(),
    },
  });

  function handleRootKey(event: KeyboardEvent) {
    // A focused button keeps its own Space; a demo answers no keys.
    if (fixed || (event.key === ' ' && event.target instanceof HTMLButtonElement)) return;
    handleKey(event);
  }

  // The shared handler leaves an input's keys to the input, and a range's
  // own arrow step would be a tenth of a second here.
  function handleScrubKey(event: KeyboardEvent) {
    const step = SCRUB_STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      seek(time + step);
    } else if (event.key === ' ' || event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      toggle();
    }
  }

  /** Attach `source` (a renewal's answer, or not); false when the core went while it attached. */
  async function attach(
    media: HTMLVideoElement,
    source: string | SignedStream,
    renewal: boolean
  ) {
    const signed = typeof source !== 'string';
    stream = { url: signed ? source.playlistUrl : source, signed, renewal };
    const end = signed && source.expiresAt ? Date.parse(source.expiresAt) : Number.NaN;
    expiry = Number.isFinite(end) ? end : null;
    expired = false;
    asked = false;
    flowing = false;
    recovered = false;
    const handle = await createHlsPlayer({
      media,
      src: stream.url,
      // The helper has already destroyed its instance.
      onError: (_message, kind) => {
        hls = null;
        fail(kind);
      },
      onUrlExpired: signed && renew ? lapse : undefined,
    });
    hls = handle.hls;
    hlsCleanup = handle.cleanup;
    if (destroyed) {
      teardown();
      return false;
    }
    return true;
  }

  async function begin(media: HTMLVideoElement) {
    try {
      // A press may still be asking for the full film; its play() already
      // holds the activation. That ask is this playback's first, so the
      // two-minute floor between asks counts from it.
      const askedAt = performance.now();
      const source = typeof src === 'string' ? src : await src;
      if (typeof source !== 'string') lastAskAt = askedAt;
      if (destroyed || !(await attach(media, source, false))) return;
      if (start === 'muted') {
        wanted = true;
        media.muted = true;
        // A browser that blocks even muted autoplay leaves it to the play button.
        playNow(media).catch(() => {});
      }
    } catch {
      fail();
    }
  }

  /** This playback asked for a stream less than MIN_ASK_INTERVAL_MS ago. */
  function askedLately() {
    return lastAskAt !== null && performance.now() - lastAskAt < MIN_ASK_INTERVAL_MS;
  }

  /**
   * How long until this stream's one early renewal (ms), or `null`: a
   * preview, no `expiresAt`, its ask already made (once per expiry), no frame
   * played yet (a stream stuck loading never asks), or an error on screen.
   * Never sooner than MIN_ASK_INTERVAL_MS after the last ask.
   */
  function renewalDelay() {
    if (!renew || expiry === null || asked || !flowing || error !== null) return null;
    const sinceAsk =
      lastAskAt === null ? Number.POSITIVE_INFINITY : performance.now() - lastAskAt;
    return Math.max(0, expiry - RENEW_LEAD_MS - Date.now(), MIN_ASK_INTERVAL_MS - sinceAsk);
  }

  /** Its links have run out, or nearly: a resume renews first. */
  function stale() {
    return renewalDelay() === 0;
  }

  /**
   * The one-shot early renewal, armed only while the film plays: a paused,
   * scrolled-away or forgotten film never asks (the owner's cost rule).
   * Re-armed on every play, cleared on pause, at the end, on an error and
   * on destroy.
   */
  function arm() {
    disarm();
    const delay = renewalDelay();
    if (delay === null || !wanted || paused || finished) return;
    renewTimer = setTimeout(() => {
      renewTimer = null;
      void refresh();
    }, delay);
  }

  function disarm() {
    if (renewTimer) clearTimeout(renewTimer);
    renewTimer = null;
  }

  /**
   * The element has been reset, silently (a stream's destroy, HLS.js's
   * recovery): paused at 0, and no `pause` fired. The mirror says so and the
   * timer stops. Until the resume (`resumeAt`) the play button reads, and a
   * press sets, the visitor's intent (`wanted`); after the end nothing resumes.
   */
  function suspend() {
    paused = true;
    disarm();
    resuming = !finished;
  }

  // The stream answered 403, and the helper has already destroyed its HLS.js
  // instance. Before the stream's first frame that is a refusal, never an
  // expiry: asking again would only loop (ask, attach, 403). A first stream
  // refused could not play; a renewal's answer refused is a failed renewal,
  // which ends the film ("Watch again"). After it, the links have run out.
  // The destroy detached the element and reset its `currentTime` to 0, so
  // the film resumes from `time`, the last moment it reported (the reset's
  // own `timeupdate` is still queued). A renewal under way decides;
  // otherwise renew, unless this stream already had its one ask (the
  // timer's) or this playback asked too lately for a real expiry (an ABR
  // switch to a refused rung, Safari's own HLS on a flaky network), which
  // ends the film where it stands.
  function lapse() {
    hls = null;
    suspend();
    if (!flowing) {
      teardown();
      if (stream?.renewal) endLapsed();
      else fail();
      return;
    }
    expired = true;
    stoppedAt = time;
    if (renewing) return;
    if (asked || askedLately()) endLapsed();
    else void refresh();
  }

  /**
   * No stream came back: the film ends here, never on the 30s preview. Its
   * stream is dead, so "Watch again" answered `null` ends it again.
   */
  function endLapsed() {
    lapsed = true;
    expired = true;
    video?.pause();
    finish();
  }

  /**
   * Ask `renew` for a fresh signed stream, swap it in, and carry on from the
   * same moment (`at`, by default where it stands once the answer is in),
   * playing if the visitor wants it. With no answer, a stream that has run
   * out ends the film; one renewed early (the timer, or a press that
   * resumes it) plays on until it runs out, and ends then (`lapse`).
   *
   * The ask takes a moment, and the film lives on meanwhile: gone, an error
   * or its end drops the answer; another film started, or a pause, leaves
   * the swap paused.
   */
  async function refresh(at?: number) {
    const media = video;
    if (!media || !renew || !stream?.signed || renewing || finished || error !== null) {
      return;
    }
    renewing = true;
    asked = true;
    lastAskAt = performance.now();
    const since = mark();
    let next: SignedStream | null = null;
    try {
      next = await renew();
    } catch {
      next = null;
    }
    renewing = false;
    if (destroyed || error !== null || finished) return;
    if (displaced(media, since)) wanted = false;
    if (!next?.playlistUrl) {
      if (expired) endLapsed();
      else if (wanted && paused) playNow(media).catch(() => {});
      return;
    }
    // The timer's renewal ran while the film played on.
    const from = at ?? (expired ? stoppedAt : media.currentTime);
    teardown();
    suspend();
    try {
      if (!(await attach(media, next, true))) return;
    } catch {
      fail();
      return;
    }
    resumeAt(media, from, since);
  }

  /**
   * Seek the new stream to `from` once it knows its length, and play on if
   * still wanted. Its wait goes with the stream (`teardown`), so a stream
   * refused before it loads leaves nothing to fire later.
   *
   * While it loads the element sits paused, silently: a scroll away,
   * another film's start (`since`, a `mark()`) or the system's pause fire
   * nothing on it. So it looks again before it plays: the observer has
   * recorded a scroll away in `wanted`, and another film's start shows here.
   */
  function resumeAt(media: HTMLVideoElement, from: number, since: number) {
    // One resume at a time: a later reset's replaces it.
    unresume?.();
    const carryOn = () => {
      unresume = null;
      resuming = false;
      media.currentTime = from;
      if (displaced(media, since)) wanted = false;
      if (!wanted) return;
      void settleStart(media, playNow(media), () => wanted && !destroyed).then(
        (outcome) => {
          if (!destroyed && outcome === 'muted') askSound = true;
        }
      );
    };
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
      carryOn();
      return;
    }
    media.addEventListener('loadedmetadata', carryOn, { once: true });
    unresume = () => media.removeEventListener('loadedmetadata', carryOn);
  }

  onMount(() => {
    const media = video;
    const box = root;
    // A demo is its own moment: no stream, no play, no page to tell.
    if (!media || !box || fixed) return;
    canFullscreen = Boolean(
      document.fullscreenEnabled || (media as AppleVideo).webkitEnterFullscreen
    );
    captionsOn = captions.some((track) => track.default);

    // A press: play now, unmuted, before anything awaits (`start.ts`).
    if (start === 'sound') {
      wanted = true;
      media.muted = false;
      void settleStart(media, playNow(media), () => wanted && !destroyed).then(
        (outcome) => {
          if (!destroyed && outcome === 'muted') askSound = true;
        }
      );
    }
    if (takeFocus) playButton?.focus({ preventScroll: true });

    void begin(media);

    // Out of view, it pauses; on screen, the page knows (`now-playing`). It
    // records the intent, not the element's state: mid-swap the element is
    // already paused, silently, and would otherwise resume off-screen.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        showing(box, entry.isIntersecting);
        if (!entry.isIntersecting) {
          wanted = false;
          // Silently paused, it fires no pause to stop the timer.
          disarm();
          if (!media.paused) media.pause();
        }
      }
    });
    observer.observe(box);
    document.addEventListener('fullscreenchange', handleFullscreen);

    return () => {
      destroyed = true;
      disarm();
      observer.disconnect();
      showing(box, false);
      release(media);
      document.removeEventListener('fullscreenchange', handleFullscreen);
      teardown();
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={root}
  class="player {className ?? ''}"
  role="region"
  aria-label={m.player_named({ title })}
  tabindex="-1"
  data-fit={fit}
  data-still-fit={ready ? undefined : (stillFit ?? fit)}
  onkeydown={handleRootKey}
>
  <MediaLiveRegion loading={!ready && !error} {error} loadingLabel={m.player_loading()}>
    {#if error}<p class="player__error" aria-hidden="true">{error}</p>{/if}
  </MediaLiveRegion>

  <!-- The `<track>` branch satisfies `a11y_media_has_caption` at compile
       time; the pipeline makes no captions yet (Codex-jw0pn). -->
  <video
    bind:this={video}
    class="player__video"
    poster={poster ?? undefined}
    playsinline
    preload={start === 'paused' ? 'metadata' : 'auto'}
    aria-label={title}
    onclick={toggle}
    onplay={handlePlay}
    onpause={handlePause}
    onwaiting={() => (waiting = true)}
    onplaying={() => (waiting = false)}
    oncanplay={() => (waiting = false)}
    onloadeddata={handleLoaded}
    onerror={handleMediaError}
    ontimeupdate={handleTimeUpdate}
    onprogress={measure}
    ondurationchange={handleDuration}
    onloadedmetadata={handleDuration}
    onvolumechange={handleVolume}
    onended={finish}
  >
    {#if captions.length > 0}
      {#each captions as track (track.srclang)}
        <track
          kind="captions"
          src={track.src}
          srclang={track.srclang}
          label={track.label}
          default={track.default ?? false}
        />
      {/each}
    {/if}
  </video>

  {#if badge}<span class="player__badge" aria-hidden="true">{m.player_preview_label()}</span>{/if}

  {#if finished && ended}
    <div class="player__ended">{@render ended(replay)}</div>
  {:else if controls && !error}
    <div class="player__bar" role="group" aria-label={m.player_controls()}>
      <button
        bind:this={playButton}
        type="button"
        class="player__button player__play"
        aria-label={offerPlay ? m.player_play() : m.player_pause()}
        onclick={toggle}
      >
        {#if offerPlay}
          <PlayIcon size={18} fill="currentColor" stroke="none" />
        {:else}
          <PauseIcon size={18} fill="currentColor" stroke="none" />
        {/if}
      </button>

      <div class="player__scrub" data-waiting={waiting && !paused ? '' : undefined}>
        <span class="player__track" aria-hidden="true">
          <span class="player__loaded" style:--_to={fill}></span>
          <span class="player__played" style:--_to={played}></span>
        </span>
        <input
          class="player__range"
          type="range"
          min="0"
          max={duration}
          step="any"
          value={time}
          disabled={duration <= 0}
          inert={Boolean(fixed)}
          aria-label={m.player_seek()}
          aria-valuetext={m.player_time({ time: clock(time), duration: clock(duration) })}
          oninput={(event) => seek(Number(event.currentTarget.value))}
          onkeydown={handleScrubKey}
        />
      </div>

      <span class="player__time" aria-hidden="true">
        {clock(time)}{#if duration > 0}<span class="player__total">{' / '}{clock(duration)}</span>{/if}
      </span>

      {#if captions.length > 0}
        <button
          type="button"
          class="player__button"
          aria-label={m.player_captions()}
          aria-pressed={captionsOn}
          onclick={toggleCaptions}
        >
          <span class="player__cc" aria-hidden="true">CC</span>
        </button>
      {/if}

      <button
        type="button"
        class="player__button player__mute"
        data-ask={askSound ? '' : undefined}
        aria-label={muteLabel}
        onclick={toggleMute}
      >
        {#if muted}
          <VolumeXIcon size={18} />
        {:else}
          <Volume2Icon size={18} />
        {/if}
        {#if askSound}<span aria-hidden="true">{m.player_tap_for_sound()}</span>{/if}
      </button>

      {#if canFullscreen}
        <button
          type="button"
          class="player__button"
          aria-label={m.player_fullscreen()}
          aria-pressed={fullscreen}
          onclick={toggleFullscreen}
        >
          <MaximizeIcon size={18} />
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Fills its frame, which gives the shape; the backdrop is what a film
     that does not fill it letterboxes on. */
  .player {
    position: relative;
    container-type: inline-size;
    inline-size: 100%;
    block-size: 100%;
    overflow: hidden;
    background: var(--color-neutral-900);
    color: var(--color-player-text);
    outline: none;
  }

  .player__video {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: contain;
    cursor: pointer;
  }

  .player[data-fit='cover'] .player__video {
    object-fit: cover;
  }

  /* Until the first frame the poster sits as the frame's own still did. */
  .player[data-still-fit='cover'] .player__video {
    object-fit: cover;
  }

  .player[data-still-fit='contain'] .player__video {
    object-fit: contain;
  }

  .player__badge {
    position: absolute;
    inset-block-start: var(--space-3);
    inset-inline-start: var(--space-3);
    z-index: 2;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    pointer-events: none;
  }

  /* `max-inline-size: none` lifts the app's global prose cap on `p`. */
  .player__error {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    background: var(--color-player-overlay-heavy);
    color: var(--color-player-text);
    font-size: var(--text-sm);
    text-align: center;
  }

  .player__ended {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: var(--color-player-overlay);
  }

  /* ── the bar ───────────────────────────────────────────────────────────── */
  .player__bar {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-10) var(--space-1-5) var(--space-1);
    background: linear-gradient(to top, var(--color-player-gradient-bottom), transparent);
  }

  .player__button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    min-inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-player-text);
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  @media (hover: hover) {
    .player__button:hover {
      background: var(--color-player-surface-hover);
    }
  }

  /* The bar is always dark (the player's inverse scheme), so the ring is the
     player's own ink, not the brand, which can be as dark as the bar. */
  .player__button:focus-visible,
  .player__range:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  /* The play button and the played fill are the brand's primary (owner
     rule, Codex-cijzb.17); the Player Chrome dials govern the rest. */
  .player__play {
    inline-size: var(--tap-target-min);
    padding: 0;
    background: var(--color-brand-primary, var(--color-primary-500));
    color: var(--color-text-on-brand, var(--color-player-text));
  }

  @media (hover: hover) {
    .player__play:hover {
      background: var(--color-brand-primary-hover, var(--color-primary-600));
    }
  }

  .player__mute[data-ask] {
    padding-inline: var(--space-2-5) var(--space-3-5);
    background: var(--color-player-surface-hover);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-player-border);
  }

  .player__cc {
    padding: 0 var(--space-1);
    border: var(--border-width-thick) solid currentColor;
    border-radius: var(--radius-xs);
    line-height: var(--leading-tight);
  }

  .player__time {
    flex: none;
    padding-inline: var(--space-2);
    color: var(--color-player-text);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .player__total {
    color: var(--color-player-text-secondary);
  }

  /* ── the scrubber: what has loaded is the lighter band, never a spinner ── */
  /* The track is inset by half the thumb, so the fill ends under its centre. */
  .player__scrub {
    --_thumb: var(--space-3-5);
    position: relative;
    flex: 1 1 auto;
    display: grid;
    align-items: center;
    min-inline-size: 0;
    block-size: var(--tap-target-min);
  }

  .player__track {
    position: relative;
    block-size: var(--space-1);
    margin-inline: calc(var(--_thumb) / 2);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--color-player-surface);
  }

  .player__loaded,
  .player__played {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: calc(var(--_to) * 100%);
    border-radius: inherit;
  }

  .player__loaded {
    background: var(--color-player-surface-active);
  }

  .player__played {
    background: var(--color-brand-primary, var(--color-primary-500));
  }

  /* Waiting on the stream: a sheen runs along the track. */
  @media (prefers-reduced-motion: no-preference) {
    .player__scrub[data-waiting] .player__track::after {
      content: '';
      position: absolute;
      inset-block: 0;
      inline-size: 40%;
      background: linear-gradient(
        90deg,
        transparent,
        var(--color-player-text-secondary),
        transparent
      );
      animation: player-buffering calc(var(--duration-slow) * 3) var(--ease-default) infinite;
    }
  }

  @keyframes player-buffering {
    from {
      translate: -100% 0;
    }

    to {
      translate: 260% 0;
    }
  }

  .player__range {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
  }

  .player__range:disabled {
    cursor: default;
  }

  .player__range::-webkit-slider-runnable-track {
    block-size: 100%;
    background: transparent;
  }

  .player__range::-webkit-slider-thumb {
    inline-size: var(--_thumb);
    block-size: var(--_thumb);
    margin-block-start: calc((var(--tap-target-min) - var(--_thumb)) / 2);
    border-radius: var(--radius-full);
    background: var(--color-player-text);
    box-shadow: var(--shadow-sm);
    appearance: none;
  }

  .player__range::-moz-range-track {
    background: transparent;
  }

  .player__range::-moz-range-thumb {
    inline-size: var(--_thumb);
    block-size: var(--_thumb);
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-player-text);
    box-shadow: var(--shadow-sm);
  }

  .player__range:disabled::-webkit-slider-thumb {
    visibility: hidden;
  }

  .player__range:disabled::-moz-range-thumb {
    visibility: hidden;
  }

  /* A narrow frame (a portrait, a phone): the scrubber takes its own row
     above the buttons. Narrower still, the time gives way; the scrubber
     still says it. */
  @container (max-width: 26rem) {
    .player__bar {
      flex-wrap: wrap;
      padding-block-start: var(--space-6);
    }

    .player__scrub {
      flex-basis: 100%;
      order: -1;
      block-size: var(--space-7);
    }

    .player__time {
      margin-inline-end: auto;
    }

    .player__range::-webkit-slider-thumb {
      margin-block-start: calc((var(--space-7) - var(--_thumb)) / 2);
    }
  }

  /* Below 17rem, never at it: Soft's centred portrait is exactly 17rem, and
     its time fits. */
  @container (width < 17rem) {
    .player__time {
      display: none;
    }

    .player__play {
      margin-inline-end: auto;
    }
  }
</style>
