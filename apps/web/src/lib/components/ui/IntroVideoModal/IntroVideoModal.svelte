<!--
  @component IntroVideoModal

  The theatre: a film over the page, in the same player as a film that plays
  in place (`PreviewPlayerCore`) — scrubber, time, mute, captions when there
  are tracks, and full screen — with sound, because a press opened it. The
  org landing page opens it for its intro film on a phone; a sales page, for
  a film with no frame to play in (the hero's cover, the guide's quote, a
  Button that plays the preview: owner P2).

  A dark room over the page, a row with the film's name and a close button,
  and the film at 16:9 as large as the window allows. Escape, the close
  button or a click on the room outside the film dismiss it; Tab stays
  inside, and focus goes back to what had it before it opened. When the film
  ends, its poster returns with "Watch again".

  The player's code loads on demand (`components/player/load-core.ts`).
  When it has loaded — a kit play button fetches it ahead — the theatre
  mounts it with itself, in the press's tick, so its `play()` keeps the
  sound; otherwise it waits for it, and the film may start muted.

  @prop {boolean} open - Whether the modal is visible
  @prop {string | Promise<string | {playlistUrl, expiresAt?}>} src - HLS
    manifest URL, or a promise of one while the full film is being asked for
    (`requestFilm`)
  @prop {() => Promise<{playlistUrl, expiresAt?} | null>} [renew] - Asks again
    for a full film whose links are running out (the player's RENEWAL)
  @prop {string} [title] - The film's name: the theatre's heading and the
    player's accessible label
  @prop {string | null} [poster] - Shown until the first frame, and again at the end
  @prop {Array<{src, srclang, label, default?}>} [captions] - Optional caption
    tracks (ref 05 §"Media elements" §2); the CC button appears only with some
  @prop {() => void} onclose - Called when the modal is dismissed
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import {
    loadedPlayerCore,
    loadPlayerCore,
    type PlayerCore,
  } from '$lib/components/player/load-core';
  import { RefreshCwIcon, XIcon } from '$lib/components/ui/Icon';
  import { getThumbnailSrcset, getThumbnailUrl } from '$lib/utils/image';
  import * as m from '$paraglide/messages';

  interface CaptionTrack {
    src: string;
    srclang: string;
    label: string;
    default?: boolean;
  }

  interface Props {
    open: boolean;
    src: ComponentProps<PlayerCore>['src'];
    renew?: ComponentProps<PlayerCore>['renew'];
    title?: string;
    poster?: string | null;
    /**
     * Caption tracks per ref 05 §"Media elements" §2. Provide one entry per
     * language; exactly one should carry `default: true`. The transcoding
     * pipeline makes none yet (Codex-jw0pn).
     */
    captions?: CaptionTrack[];
    onclose: () => void;
  }

  const { open, src, renew, title, poster = null, captions, onclose }: Props =
    $props();

  const name = $derived(title || m.player_intro_video());
  // The ended still is contained in the theatre, so never wider than the
  // viewport: the browser picks its file from the srcset (Codex-kk9nv.1).
  const stillSrcset = $derived(poster ? getThumbnailSrcset(poster) : '');

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let Player = $state.raw<PlayerCore | null>(loadedPlayerCore());
  let failed = $state(false);

  // What had focus before the theatre opened, read as it is made: the
  // player inside takes focus for itself as it mounts.
  const opener =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  // The player's code, when the theatre opened before it arrived.
  $effect(() => {
    if (!open || Player) return;
    let gone = false;
    loadPlayerCore().then(
      (loaded) => {
        if (!gone) Player = loaded;
      },
      () => {
        if (!gone) failed = true;
      }
    );
    return () => {
      gone = true;
    };
  });

  // Focus into the theatre (unless the player already took it), and back out
  // to its opener when it closes.
  $effect(() => {
    if (!open) return;
    if (!dialogEl?.contains(document.activeElement)) {
      dialogEl?.focus({ preventScroll: true });
    }
    return () => opener?.focus({ preventScroll: true });
  });

  // ── Click outside ──
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  /**
   * The player answers its own keys (Space, K, M, the arrows, F) from
   * anywhere inside it; the theatre adds Escape to close, and keeps Tab
   * inside: from the last control to the first, and back.
   *
   * Heard on the WINDOW while open, not on the dialog: a film that fails to
   * play removes the control that had focus, which drops focus to `<body>`,
   * and a listener on the dialog then heard nothing, so Escape did nothing
   * and Tab walked out to the page behind (Codex-s1ebi). Tab from outside
   * now brings focus back in.
   */
  function handleKey(e: KeyboardEvent) {
    if (!open || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'Tab' && dialogEl) {
      const stops = [
        ...dialogEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href]'
        ),
      ];
      const first = stops[0];
      const last = stops.at(-1);
      if (!first || !last) return;
      const at = document.activeElement;
      if (!dialogEl.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (at === first || at === dialogEl)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /**
   * Portal the modal root out of the section subtree.
   *
   * The sales-page section renderer wraps every section in `.jp-sec`
   * (`position: relative; isolation: isolate; container-type: inline-size`) and
   * the intro/reel stages add a second `isolation: isolate`. A `position: fixed`
   * overlay mounted inside that subtree has its `z-index` ranked only WITHIN the
   * section — and the wrapper's container-type makes it the containing block for
   * fixed descendants as well — so later sections paint their text OVER the
   * fullscreen video. Re-parenting to `.org-layout`
   * (NOT raw `<body>` — it carries the org-brand + `--color-player-*` cascade
   * this modal styles against) lets the modal stack against the root instead.
   *
   * Moving a node drops the focus inside it, and the player may already have
   * taken focus as it mounted: it is handed back after the move.
   *
   * A sales page can set its own brand over the org's: its renderer root is
   * a nested `[data-org-brand]` carrying only the overridden `--brand-*`
   * inputs. The move would leave those behind, and the theatre's play button
   * would turn the org's colour beside the page's, so they travel with it.
   */
  function portal(node: HTMLElement) {
    const target = document.querySelector('.org-layout') ?? document.body;
    const brand = node.parentElement?.closest<HTMLElement>('[data-org-brand]');
    const inputs = brand && brand !== target ? brand.getAttribute('style') : null;
    if (inputs) {
      node.setAttribute('style', inputs);
      node.setAttribute('data-org-brand', '');
    }
    const focused = node.contains(document.activeElement) ? document.activeElement : null;
    target.appendChild(node);
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#snippet again(replay: () => void)}
  {#if poster}
    <img
      class="intro-modal__still"
      src={getThumbnailUrl(poster, 'lg')}
      srcset={stillSrcset || undefined}
      sizes={stillSrcset ? '100vw' : undefined}
      alt=""
    />
  {/if}
  <button type="button" class="intro-modal__again" onclick={replay}>
    <RefreshCwIcon size={16} />
    {m.player_watch_again()}
  </button>
{/snippet}

<svelte:window onkeydown={handleKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="intro-modal"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={name}
    bind:this={dialogEl}
    use:portal
    onclick={handleOverlayClick}
  >
    <div class="intro-modal__inner">
      <div class="intro-modal__top">
        {#if title}<p class="intro-modal__name">{title}</p>{/if}
        <button
          type="button"
          class="intro-modal__close"
          onclick={onclose}
          aria-label={m.player_close()}
        >
          <XIcon size={20} />
        </button>
      </div>

      <div class="intro-modal__player">
        {#if Player}
          <Player
            {src}
            {renew}
            {poster}
            title={name}
            {captions}
            start="sound"
            takeFocus
            ended={again}
          />
        {:else if failed}
          <p class="intro-modal__error" role="alert">{m.player_error()}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .intro-modal {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-backdrop);
    display: grid;
    place-items: center;
    padding: var(--space-4);
    backdrop-filter: blur(var(--blur-2xl));
    -webkit-backdrop-filter: blur(var(--blur-2xl));
    background: var(--color-player-overlay-heavy);
    animation: modal-fade-in var(--duration-slow) var(--ease-out) both;
    /* Dialog is programmatically focused to enable scoped keyboard; hide the ring. */
    outline: none;
  }

  @keyframes modal-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* As large as the window allows at 16:9, leaving room for the top row. */
  .intro-modal__inner {
    display: grid;
    gap: var(--space-3);
    inline-size: min(100%, var(--container-xl), (100vh - var(--space-32)) * 16 / 9);
    animation: modal-scale-in var(--duration-slow) var(--ease-out) both;
    animation-delay: calc(var(--duration-fast) * 0.5);
  }

  @supports (height: 100dvh) {
    .intro-modal__inner {
      inline-size: min(100%, var(--container-xl), (100dvh - var(--space-32)) * 16 / 9);
    }
  }

  @keyframes modal-scale-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .intro-modal__top {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .intro-modal__name {
    min-inline-size: 0;
    margin: 0;
    color: var(--color-player-text);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
  }

  .intro-modal__close {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    margin-inline-start: auto;
    border-radius: var(--radius-full);
    background: var(--color-player-surface-hover);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .intro-modal__close:hover {
    background: var(--color-player-surface-active);
  }

  .intro-modal__close:focus-visible,
  .intro-modal__again:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-1);
  }

  /* No mask on the frame: a feathered edge would fade the controls away. */
  .intro-modal__player {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-neutral-900);
  }

  /* The ended layer: the poster again, under the replay. */
  .intro-modal__still {
    position: absolute;
    inset: 0;
    z-index: -1;
    inline-size: 100%;
    block-size: 100%;
    object-fit: contain;
  }

  .intro-modal__again {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--tap-target-min);
    padding: var(--space-2) var(--space-5) var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-player-overlay-heavy);
    color: var(--color-player-text);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .intro-modal__error {
    position: absolute;
    inset-block-end: var(--space-8);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-error-50);
    color: var(--color-error-700);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  @media (--below-md) {
    .intro-modal {
      padding: var(--space-3);
    }

    .intro-modal__player {
      border-radius: var(--radius-md);
    }
  }

  /*
    Reduced-motion — ref 05 §"Media elements" §5 + §8.
    CSS-first pattern replaces the previous JS matchMedia one-shot (which was
    captured at mount and didn't re-evaluate mid-session toggles).
  */
  @media (prefers-reduced-motion: reduce) {
    .intro-modal,
    .intro-modal__inner {
      animation: none;
    }

    .intro-modal__close {
      transition: none;
    }
  }
</style>
