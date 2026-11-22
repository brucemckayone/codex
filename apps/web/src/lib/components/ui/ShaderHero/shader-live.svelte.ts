/**
 * Whether the org's moving background is painting.
 *
 * The org layout's `data-hero-shader-active` gate, which about 25 page-kit and
 * layout rules read, used to come only from the stored brand tokens. So a
 * renderer that failed to start, or a dark theme that resolves to 'none',
 * still cleared those surfaces over a canvas that showed nothing. The layout
 * now starts from the tokens, which is what the server renders, and this
 * channel corrects it once the shader settles (`heroShaderActive` in
 * `$lib/page-builder/org-grounds`).
 *
 * ONE WRITER: the `tone` ShaderHero, which is the org layout's fullpage one.
 * There is one channel per window, and it describes the shader that sits
 * behind the page's surfaces. Any other ShaderHero (the auth pane's) stands
 * behind nothing the gate styles, and with two writers the last report would
 * win. A newer `claim()` takes over from an older one, so a layout that mounts
 * before the previous one has gone cannot be reset by the old one's unmount.
 *
 * Only the browser writes it: on the server the state stays 'pending', and
 * the gate renders the token guess exactly as it did before.
 *
 * 'pending' has no time limit. A renderer chunk whose request stalls (no
 * answer, no error) keeps the token guess until it resolves or fails, as a gate
 * on the tokens alone would. Bounding it would mean reporting a provisional
 * failure, and every slow but healthy load would then flash the page's surfaces
 * opaque and back: a product choice, not this channel's.
 */

/**
 * - `pending`: nothing has settled since the shader mounted, or none is mounted.
 * - `none`: no preset to draw.
 * - `live`: a renderer has drawn a frame, and the canvas shows it.
 * - `failed`: a preset that cannot draw: it would not load or start, there is
 *   no WebGL, or the context was lost. It holds until a renderer draws, even
 *   through a brand switch to no preset (the failed one already shows
 *   nothing); the gate reads `none` and `failed` alike.
 */
export type ShaderLiveState = 'pending' | 'none' | 'live' | 'failed';

export interface ShaderLiveWriter {
  /** What the shader shows now; ignored once a newer claim has taken over. */
  report(state: Exclude<ShaderLiveState, 'pending'>): void;
  /** The shader unmounted: back to `pending`, unless a newer claim holds it. */
  release(): void;
}

class ShaderLiveChannel {
  #state = $state<ShaderLiveState>('pending');
  #owner: object | null = null;

  /** Read reactively, by the org layout's gate. */
  get state(): ShaderLiveState {
    return this.#state;
  }

  /** The `tone` ShaderHero, at mount: it alone reports from now on. */
  claim(): ShaderLiveWriter {
    const owner = {};
    this.#owner = owner;
    this.#state = 'pending';
    return {
      report: (state) => {
        if (this.#owner === owner) this.#state = state;
      },
      release: () => {
        if (this.#owner !== owner) return;
        this.#owner = null;
        this.#state = 'pending';
      },
    };
  }
}

export const shaderLive = new ShaderLiveChannel();
