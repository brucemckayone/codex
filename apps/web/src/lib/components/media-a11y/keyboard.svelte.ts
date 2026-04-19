/**
 * Shared keyboard handlers for media-related widgets.
 *
 * Two sibling composables live here:
 *
 * 1. `createMediaKeyboardHandler` — for real `<audio>` / `<video>` elements. Mutates
 *    `HTMLMediaElement.currentTime` directly. Enforces Ref 05 §"Media elements" §3:
 *    keyboard shortcuts MUST be scoped to the player wrapper (or portal node for
 *    portaled overlays) rather than `<svelte:window>` so Space / Arrow / m / f don't
 *    hijack page-wide keyboard nav whenever a player is mounted.
 *
 * 2. `createSliderKeyboardHandler` — for canvas-based slider widgets (Waveform,
 *    timeline scrubbers, XY pads) that expose `role="slider"` without a real media
 *    element. Works through an `onSeek(time)` callback rather than `currentTime`
 *    mutation. Implements the WAI-ARIA APG slider contract (Home/End/PageUp/PageDown
 *    plus Shift+Arrow fine-grain). Ref 05 §"Media elements" §10 is the canonical spec.
 *
 * They are siblings, not one replacing the other — pick the one that matches your
 * primitive. Canvas visualisers with no underlying media element use (2); real
 * `<audio>` players with a seek bar UI use (1) (and may ALSO use (2) for a secondary
 * canvas scrubber).
 *
 * Usage — wrapper-scoped (AudioPlayer, HeroInlineVideo):
 *   <script>
 *     let wrapperEl: HTMLElement | undefined = $state();
 *     const handleKey = createMediaKeyboardHandler({
 *       getWrapper: () => wrapperEl,
 *       getMedia: () => audioEl ?? null,
 *       shortcuts: { playPause: togglePlay, mute: toggleMute, seekSecs: 10 },
 *     });
 *   </script>
 *   <div bind:this={wrapperEl} tabindex="-1" onkeydown={handleKey}>...</div>
 *
 * Usage — portal-scoped (ImmersiveShaderPlayer):
 *   The portal node lives under document.body so wrapperEl?.contains(activeEl)
 *   always returns false when focus is elsewhere. Pass `skipContainmentCheck: true`
 *   and attach the handler directly on the portal node, with auto-focus on mount
 *   via `$effect(() => overlayEl?.focus())`.
 *
 * Usage — canvas slider (Waveform):
 *   <script>
 *     const handleKey = createSliderKeyboardHandler({
 *       onSeek: (t) => audioEl.currentTime = t,
 *       getCurrentTime: () => currentTime,
 *       duration,
 *     });
 *   </script>
 *   <div role="slider" tabindex="0" onkeydown={handleKey}>...</div>
 *
 * Both handlers preserve the INPUT/TEXTAREA/contentEditable guard so nested form
 * controls (search inputs, caption editors) don't lose their keyboard.
 */

interface MediaShortcuts {
  /** Toggle play/pause — Space / k */
  playPause?: () => void;
  /** Toggle mute — m */
  mute?: () => void;
  /** Seek by ±secs on ArrowLeft / ArrowRight. Shift modifier gives fine-grain ±1s. */
  seekSecs?: number;
  /** Optional: handle Escape (e.g. close overlay). */
  escape?: () => void;
  /** Optional: handle fullscreen toggle — f */
  fullscreen?: () => void;
  /** Optional: handle Home / End (0 / duration). */
  onHomeEnd?: (pos: 'start' | 'end') => void;
}

interface CreateMediaKeyboardHandlerOptions {
  /** The wrapper element — used for containment check to scope shortcuts. */
  getWrapper?: () => HTMLElement | undefined;
  /** The underlying media element. Returning null disables shortcuts. */
  getMedia: () => HTMLMediaElement | null;
  /** The set of shortcuts to enable. */
  shortcuts: MediaShortcuts;
  /**
   * For portaled overlays: skip the wrapper containment check (the portal node
   * lives under document.body so the usual scoping approach fails). Pair with
   * auto-focus on mount so the handler only fires when the overlay has focus.
   */
  skipContainmentCheck?: boolean;
}

/**
 * Builds a keyboard event handler scoped to the player. Attach to the wrapper
 * element via `onkeydown={handleKey}` — NEVER to `<svelte:window>`.
 */
export function createMediaKeyboardHandler(
  opts: CreateMediaKeyboardHandlerOptions
): (event: KeyboardEvent) => void {
  return function handleKey(e: KeyboardEvent) {
    const media = opts.getMedia();
    if (!media) return;

    const target = e.target as HTMLElement | null;
    // Preserve form-control guard so nested inputs / contenteditable don't lose typing.
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

    // Containment check — default path (wrapper-scoped). Portaled overlays opt out.
    if (!opts.skipContainmentCheck) {
      const wrapper = opts.getWrapper?.();
      if (wrapper && !wrapper.contains(document.activeElement)) {
        // Focus lives outside the player — don't hijack.
        return;
      }
    }

    const { shortcuts } = opts;
    const seekSecs = shortcuts.seekSecs ?? 10;

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        if (shortcuts.playPause) {
          e.preventDefault();
          shortcuts.playPause();
        }
        break;
      case 'ArrowLeft':
      case 'j':
      case 'J': {
        e.preventDefault();
        const step = e.shiftKey ? 1 : seekSecs;
        media.currentTime = Math.max(0, media.currentTime - step);
        break;
      }
      case 'ArrowRight':
      case 'l':
      case 'L': {
        e.preventDefault();
        const step = e.shiftKey ? 1 : seekSecs;
        const dur = Number.isFinite(media.duration) ? media.duration : 0;
        media.currentTime = Math.min(dur, media.currentTime + step);
        break;
      }
      case 'Home':
        if (shortcuts.onHomeEnd) {
          e.preventDefault();
          shortcuts.onHomeEnd('start');
        } else {
          e.preventDefault();
          media.currentTime = 0;
        }
        break;
      case 'End':
        if (shortcuts.onHomeEnd) {
          e.preventDefault();
          shortcuts.onHomeEnd('end');
        } else if (Number.isFinite(media.duration)) {
          e.preventDefault();
          media.currentTime = media.duration;
        }
        break;
      case 'm':
      case 'M':
        if (shortcuts.mute) {
          e.preventDefault();
          shortcuts.mute();
        }
        break;
      case 'f':
      case 'F':
        if (shortcuts.fullscreen) {
          e.preventDefault();
          shortcuts.fullscreen();
        }
        break;
      case 'Escape':
        if (shortcuts.escape) {
          e.preventDefault();
          shortcuts.escape();
        }
        break;
    }
  };
}

/* ------------------------------------------------------------------ *
 * createSliderKeyboardHandler — canvas-based slider (role="slider")  *
 * Ref 05 §"Media elements" §10                                        *
 * ------------------------------------------------------------------ */

interface CreateSliderKeyboardHandlerOptions {
  /** Callback invoked with the new time (clamped to [0, duration]). */
  onSeek: (time: number) => void;
  /** Reads the current playhead value. Allows reactive state (e.g. $state) to flow. */
  getCurrentTime: () => number;
  /**
   * Total duration in the same unit as `getCurrentTime()`. Accepts either a
   * concrete number (for static durations) or a getter that returns the current
   * value each call — use the getter form when the value lives in Svelte runes
   * so reactive updates flow through the handler.
   */
  duration: number | (() => number);
  /** Coarse step for ArrowLeft / ArrowRight / ArrowUp / ArrowDown. Default 5s. */
  stepSecs?: number;
  /** Page step for PageUp / PageDown. Defaults to 10% of duration. */
  pageSecs?: number;
}

/**
 * Builds a WAI-ARIA-compliant keyboard handler for a canvas-based slider. Attach
 * to the slider wrapper via `onkeydown={handleKey}` — the element must also carry
 * `role="slider"`, `tabindex="0"`, and the usual `aria-valuemin`/max/now attributes.
 *
 * Contract (per APG "Slider"):
 *  - ArrowRight / ArrowUp    → +stepSecs (or +1s if Shift is held)
 *  - ArrowLeft  / ArrowDown  → −stepSecs (or −1s if Shift is held)
 *  - Home                    → 0
 *  - End                     → duration
 *  - PageUp                  → +pageSecs (default duration × 0.1)
 *  - PageDown                → −pageSecs
 *
 * Keys outside the contract fall through untouched. The handler preserves the
 * INPUT / TEXTAREA / contentEditable guard so embedded form controls keep their
 * keyboard.
 */
export function createSliderKeyboardHandler(
  opts: CreateSliderKeyboardHandlerOptions
): (event: KeyboardEvent) => void {
  const { onSeek, getCurrentTime } = opts;
  const stepSecs = opts.stepSecs ?? 5;
  const readDuration =
    typeof opts.duration === 'function'
      ? (opts.duration as () => number)
      : () => opts.duration as number;
  return function handleKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

    const durationNow = readDuration();
    const safeDuration =
      Number.isFinite(durationNow) && durationNow > 0 ? durationNow : 0;
    const page = opts.pageSecs ?? safeDuration * 0.1;
    const now = getCurrentTime();
    const step = e.shiftKey ? 1 : stepSecs;
    let next = now;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(safeDuration, now + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, now - step);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = safeDuration;
        break;
      case 'PageUp':
        next = Math.min(safeDuration, now + page);
        break;
      case 'PageDown':
        next = Math.max(0, now - page);
        break;
      default:
        return;
    }

    e.preventDefault();
    onSeek(next);
  };
}
