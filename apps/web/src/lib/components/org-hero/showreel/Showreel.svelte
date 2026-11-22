<!--
  @component Showreel

  The org hero's Showreel (Codex-1yd58.6, plan §4; the v4 mock in
  docs/handover/org-landing-sources/showreel, git-ignored): the org's film,
  then its featured pieces, one at a time, through the brand's own shader.
  OrgHero renders it for `comp: 'showreel'`; the reel itself is decided in
  `$lib/org-hero/reel.ts`.

  ── LAYOUTS ────────────────────────────────────────────────────────────────
  Corner: the playing title lower left, the index on the right. Wide: the
  title set across the width, its line and button on one row, the strip
  along the foot. Name window: the org's name, very large, is the window the
  film plays through; the playing piece sits beneath it. On a phone the
  index becomes story segments; a tap on the left third goes back, the rest
  forward; a press and hold pauses. The film holds still in the window while
  these words scroll over it (the fixed stage, WP-1).

  ── WHAT STOPS IT ──────────────────────────────────────────────────────────
  Pause (WCAG 2.2.2) stops everything that moves: the reel, the footage and
  the shader (`shaderTone.hold`). Its button comes first in the reel's tab
  order. A phone's press and hold pauses the same way while it lasts (owner,
  2026-11-19). A hold stops only the moving on: the pointer over the words,
  the index or the strip (a mouse resting on the film is no hold), focus
  inside, the film playing (in the hero or the phone's pop-up), or the hero
  off screen. Reduced motion, or "Loop and move on" off,
  is the static path: stills, no moving on, the shader held. Save-Data plays
  stills that still move on (owner, 2026-11-19).

  ── CONTRAST BY CONSTRUCTION ───────────────────────────────────────────────
  Two full-width soft scrims, as the mock draws them, one from the top and
  one from the foot, in the brand's own ground (`--color-background`),
  deepened on a dark brand or paled on a light one only as far as its inks
  need (`scrimTint`; which way from the ground alone, `groundPoles`, and a
  colour that veil cannot carry is lifted toward the other pole). Each holds
  the least opacity (`--_pool`) under which every ink keeps 4.5:1 (3:1 large) over ANY
  film pixel (`reel-scrim.ts`) as far as its words reach, measured from the
  laid-out words, then fades away. The foot scrim is clear again at the
  hero's very edge, where the page's own fade-in takes over, so the hero
  hands over to the page with no line. The focus ring is the brand's focus
  colour, mixed toward the ink only as far as 3:1 over any frame needs
  (`focusInk`).
-->
<script lang="ts" module>
  /** The shortfalls (a solved tint and the roles it leaves short) reported this page load (review R6, r6 L1). */
  const warnedShortfalls = new Set<string>();
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { flushSync, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { preloadPlayerOnIntent } from '$lib/components/player/load-core';
  import { clock as lengthOf } from '$lib/components/player/timeline';
  import { PlayIcon, Volume2Icon } from '$lib/components/ui/Icon';
  import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
  import { type FilmLook, NAME_FADE_PX } from '$lib/components/ui/ShaderHero/compositor/stage';
  import { shaderTone } from '$lib/components/ui/ShaderHero/shader-tone';
  import type { HeroOptions } from '$lib/org-hero/hero-config';
  import type { ReelEntry } from '$lib/org-hero/reel';
  import { type GlyphBox, glyphBox } from '$lib/org-hero/showreel/glyph-box';
  import { fitTitle, type NameLines, nameInRoom, nameLines } from '$lib/org-hero/showreel/name-lines';
  import { prefersSavingData, reelMode } from '$lib/org-hero/showreel/playback';
  import { ReelClock, reelKeys } from '$lib/org-hero/showreel/reel-clock.svelte';
  import { reelMedia } from '$lib/org-hero/showreel/reel-media';
  import { useReelMotion } from '$lib/org-hero/showreel/reel-motion.svelte';
  import { pieceSeconds } from '$lib/org-hero/showreel/reel-push';
  import {
    FIRST_PAINT,
    focusInk,
    glowLeaves,
    groundPoles,
    growShades,
    haloAlpha,
    type Ink,
    liftedNodes,
    liftStep,
    MAX_SCRIM_ALPHA,
    type Need,
    outlineAlpha,
    over,
    ownPole,
    type Rgb,
    ringCarries,
    ringHalo,
    SHADE_PEAK_MAX,
    SHADES,
    SHADES_CAP,
    type Shade,
    scrimAlpha,
    scrimTint,
    secondCarrier,
    shadeFloor,
    shadeProps,
    wordRoom,
  } from '$lib/org-hero/showreel/reel-scrim';
  import { type ReelWords, reelWords } from '$lib/org-hero/showreel/reel-words';
  import { drawTitleMask } from '$lib/org-hero/showreel/title-mask';
  import { logger } from '$lib/observability';
  import { type TheatreItem, theatreFor } from '$lib/org-hero/showreel/theatre';
  import { themeState } from '$lib/theme.svelte';
  import * as m from '$paraglide/messages';
  import ReelStage from './ReelStage.svelte';
  import ReelTheatre from './ReelTheatre.svelte';

  interface Props {
    reel: readonly ReelEntry[];
    options: HeroOptions;
    name: string;
    description: string;
    /** The logo, or '' for none. */
    logoUrl: string;
    /**
     * The logo failed to load: OrgHero's own handler, which logs it and marks
     * it failed (`logoFailed`).
     */
    onlogofail: (event: Event & { currentTarget: HTMLImageElement }) => void;
    /**
     * The logo failed (OrgHero's `markFailed`). It keeps its box, unseen, so
     * nothing in the top bar moves when it fails after the first paint (a
     * load failure must keep its box); a logo leading alone gets the name as
     * its stand-in, drawn over its place.
     */
    logoFailed?: boolean;
    /** The facts as one sentence ("4 portals, 14 films and 15 essays"), or ''. */
    facts: string;
    /** Join or Explore, beside Follow (owner, 2026-11-19), or null. */
    action: { href: string; label: string } | null;
    exploreHref: string;
    /** The intro film's length, for its kicker and button. */
    filmDuration: string | null;
    following: boolean;
    followBusy: boolean;
    onfollow: () => void;
    /** The film button: opens the film in full, or its preview with sound. */
    onfilm: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
    /** The film is playing inside the hero (desktop): the words step aside. */
    filmOpen: boolean;
    /**
     * The film is playing anywhere: in the hero, or in the phone's pop-up.
     * The reel holds on it, so the button the page returns focus to stays.
     */
    filmPlaying: boolean;
    /** The page's in-hero film player, drawn inside the hero's box. */
    filmLayer?: Snippet;
  }

  let {
    reel,
    options,
    name,
    description,
    logoUrl,
    onlogofail,
    logoFailed = false,
    facts,
    action,
    exploreHref,
    filmDuration,
    following,
    followBusy,
    onfollow,
    onfilm,
    filmOpen,
    filmPlaying,
    filmLayer,
  }: Props = $props();

  /** The words go out (`--duration-normal`), the film cuts, the words come in. */
  const OUT_MS = 200;
  /** A press longer than this holds the reel instead of tapping it on. */
  const PRESS_MS = 350;
  /** A pointer that moves further than this is a swipe or a scroll, never a tap. */
  const TAP_SLOP = 10;
  /** The name window's largest size: desktop (with the peek, smaller) and
   *  phone, the mock's 228 or 196, and 138. */
  const NAME_MAX = { desk: 228, deskPeek: 196, phone: 138 };
  /** The Wide title's range (the mock's). */
  const WIDE_TITLE = { min: 72, max: 150 };
  /**
   * The owner's floor (2026-11-22): on a short screen the big type shrinks
   * with the room it has, never under this, Wide's least fitted size, and the
   * hero grows only as far as the floor needs. Type already under it (a
   * phone's) keeps its own size.
   */
  const TYPE_FLOOR = WIDE_TITLE.min;
  /** Where the name window rests out of flow, its centre, as a share of the hero's height (`top: 36%`). */
  const NAME_AT = 0.36;
  /** The longest word a phone's top bar holds whole, in letters (`longWord`). */
  const NAME_WORD_MAX = 17;

  // The complement of `--below-md` (breakpoints.css), as the landing reads it.
  const desktop = new MediaQuery('(min-width: 48rem)');
  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
  let saveData = $state(false);
  $effect(() => {
    saveData = prefersSavingData(window);
  });

  const layout = $derived(options['reel-layout']);
  /**
   * The peek (owner, 2026-11-21: on by default): the hero stops a lift short
   * of the screen's foot (`--_lift`), so the landing's first section, its
   * featured row, rises above the fold. Off when the org has no featured row
   * (`resolveHero`). The stage is the hero's own box, so the film ends at the
   * hero's foot too; the fit and the name measure again.
   */
  const peek = $derived(options['reel-peek'] === 'on');
  /** How the words keep their contrast over the film (owner, 2026-11-20). */
  const edge = $derived(options['reel-edge']);
  /**
   * The shades the server draws, until the fit has measured a word: the cap,
   * the most the fit may grow them to, in both edges, with every word in the
   * pole ink (`--_pole-ink`), so every word passes from the first paint and
   * 'shadow' never shows an outline (owner, 2026-11-21). The fit then eases
   * them back: to what each word needs in 'shadow', to as drawn in 'outline'
   * (drawn, its first paint left the grey-140 ground's index 4.43:1).
   * Strength only: nothing moves.
   */
  const firstShades = shadeProps(SHADES_CAP);
  const mode = $derived(
    reelMode({ reducedMotion: reducedMotion.current, saveData, loop: options['reel-loop'] === 'on' })
  );
  // One clock for the visit. The landing hands over a new `reel` whenever its
  // data refreshes (a tab return, the activity poll), so the clock follows
  // what the reel holds, never its identity: a pause, the holds and the piece
  // on show all survive it (WCAG 2.2.2).
  const moves = $derived(mode !== 'static');
  const clock = new ReelClock(
    untrack(() => reel.length),
    untrack(() => moves)
  );
  const keys = $derived(reelKeys(reel));
  $effect.pre(() => {
    const now = keys;
    untrack(() => clock.follow(now));
  });
  $effect.pre(() => {
    clock.moves = moves;
  });
  const words = $derived(reel.map((entry, i) => reelWords(entry, i, { name, description, filmDuration })));
  const media = $derived(reel.map((entry) => reelMedia(entry, mode)));
  let rootEl: HTMLElement | undefined = $state();
  let titleEl: HTMLElement | undefined = $state();
  /** The stage, to retry a refused film from the visitor's own touch. */
  let stage: ReturnType<typeof ReelStage> | undefined;
  let windowEl: HTMLElement | undefined = $state();

  // ── the words follow the clock, a beat behind (out, cut, in) ──
  // The entry on show, by its key: a refresh that moves it (a piece added
  // or removed before it) shows the same entry at its new place, no swap.
  let shownKey = $state(untrack(() => keys[0] ?? ''));
  const shown = $derived(Math.max(0, keys.indexOf(shownKey)));
  let swap = $state<'' | 'out' | 'in'>('');
  // The entry the words wait to show: they come in with its picture, at the
  // cut's bottom (WP-6, the motion's effect below), never over the last one.
  let due = $state<string | null>(null);
  $effect(() => {
    const target = keys[clock.index] ?? '';
    const on = untrack(() => shownKey);
    due = null;
    if (target === on) {
      // Back where the words already are, before they went out (two quick
      // picks): bring them back in.
      untrack(() => {
        if (swap === 'out') swap = 'in';
      });
      return;
    }
    // Still, or the entry on show has left the reel: no swap, the words
    // change with the picture.
    if (!clock.moves || reducedMotion.current || !keys.includes(on)) {
      due = target;
      return;
    }
    swap = 'out';
    const timer = setTimeout(() => {
      due = target;
    }, OUT_MS);
    return () => clearTimeout(timer);
  });
  // WP-5b: the compositor places a portrait piece, and draws the surface and
  // the stills' push-in on the footage alone, the push-in by the reel's own
  // clock (it holds when the reel does). A reel held still pushes none in.
  // The push reads the piece ON SHOW (review M1r2): the clock moves on
  // before the words and the stage do, and until they follow, the still on
  // show keeps its last reading (its full push), never the next piece's 0
  // under the old picture. They follow at the cut's bottom (WP-6, review
  // M4), so the next starts about the cut's fall in, out of sight there.
  // A push restarts only when the piece on show CHANGES (review M1r3): a
  // reel of one goes round to the same piece (`go(0)`), and a visitor may
  // re-pick the piece on show or go back to it mid-fall (WP-6 r2 R2-M3);
  // each zeroes the clock under the same still. On the same piece the push
  // holds what it has reached.
  // Canvas (`pieceSeconds`) and page (`--_push-progress`) read this one.
  //
  // How far into the piece ON SHOW, the one reading both follow: the
  // clock's while it is on that piece; until the words and the stage follow
  // it to the next, the last, so the index's bar and the phone's segment
  // stay with their highlight through the cut's fall (WP-6 review r2 R2-M2:
  // the bar under the old highlight ran back to 0 and refilled). A new
  // piece on show starts from 0 until the clock is on it. A piece played
  // again (a reel of one, a re-pick) starts its bar again: the push alone
  // holds what it has reached.
  let shownProgress = 0;
  let progressKey = '';
  function progressOnShow(): number {
    if (keys[clock.index] === shownKey) shownProgress = clock.progress;
    else if (progressKey !== shownKey) shownProgress = 0;
    progressKey = shownKey;
    return shownProgress;
  }
  let pushProgress = 0;
  let pushKey = '';
  function pushOnShow(): number {
    const now = progressOnShow();
    pushProgress = shownKey === pushKey ? Math.max(pushProgress, now) : now;
    pushKey = shownKey;
    return pushProgress;
  }
  const pushClock = pieceSeconds({
    get progress() {
      return pushOnShow();
    },
  });
  const look = $derived<FilmLook>({
    frame: layout === 'name' ? 'film-name' : 'film-fill',
    band: options['reel-band'],
    surface: options['reel-surface'],
    push: options['reel-push'] === 'on' && moves ? pushClock : null,
  });
  const current = $derived(words[shown] ?? words[0]);
  // In the name window the name is the headline, so the film's slide
  // carries the org's line instead (the mock's).
  const lineFirstAt = (i: number) => layout === 'name' && reel[i]?.type === 'film' && !!words[i]?.line;
  const lineFirst = $derived(lineFirstAt(shown));

  // ── the theatre: a piece's preview with sound (Codex-1yd58.8) ──
  const theatres = $derived(reel.map((entry, i) => theatreFor(entry, words[i]?.title ?? name)));
  let theatre = $state<{ index: number; item: TheatreItem } | null>(null);
  // The film's main button plays its preview there, unless a press plays the
  // full film (Codex-0hkkt): that one keeps the page's own film player.
  const mainOpensAt = (i: number) => {
    const entry = reel[i];
    return entry?.type === 'film' && !entry.film.fullFilm && !!theatres[i];
  };
  const mainOpensTheatre = $derived(mainOpensAt(shown));
  /** The piece's preview with sound, where its main button plays something else. */
  const previewAt = (i: number) => !!theatres[i] && !mainOpensAt(i);
  /**
   * What opened the theatre, given focus back as it closes. The body or the
   * root is none (Safari focuses no clicked button: review L5); then the
   * index's current piece takes it (`nextFocus`).
   */
  let theatreOpener: HTMLElement | null = null;
  /** In the press's own tick, so the theatre's player keeps the sound. */
  function openTheatre() {
    const item = theatres[shown];
    if (!item) return;
    const at = document.activeElement;
    theatreOpener =
      at instanceof HTMLElement && at !== document.body && at !== document.documentElement ? at : null;
    theatre = { index: shown, item };
    flushSync();
  }
  function closeTheatre(reason: 'closed' | 'ended') {
    const at = theatre?.index;
    const opener = theatreOpener;
    theatreOpener = null;
    theatre = null;
    // Played to its end, the reel carries on as it would have (the mock's;
    // plan §4), and its film button goes with the piece: focus takes the
    // index's current one. A reel that never moves on by itself (`static`:
    // Loop off, reduced motion; playback.ts) or that the visitor paused
    // (WCAG 2.2.2) stays on its piece, and focus goes back to the opener
    // (WP-7 review r3). Not `clock.running`: the film's hold is still on.
    const moved = reason === 'ended' && at === clock.index && clock.moves && !clock.paused;
    if (moved) clock.next();
    // The reel behind stops being inert in this flush, and only then can it
    // take focus: asked while it still was, focus fell to the body (review
    // H1, 2026-11-21: Svelte switches the branch before the render effect
    // that clears `inert`).
    flushSync();
    // The opener only while its words are still the clock's piece (WP-7
    // review r4 LOW 1): pressed inside a pick's out-beat, it is fading out,
    // and the cut's bottom takes it away (a film's button becomes a piece's
    // link), so focus would fall to the body.
    const theirs = keys[clock.index] === shownKey;
    const back = !moved && theirs && opener?.isConnected ? opener : nextFocus();
    back?.focus({ preventScroll: true });
    // Firefox fires no focusout for a focused node that is removed: the
    // keyboard hold follows where focus is now, never where it was.
    const now = document.activeElement;
    clock.hold('focus', now instanceof Element && !!rootEl?.contains(now) && now.matches(':focus-visible'));
  }
  /**
   * What takes focus when the theatre's opener cannot (an 'ended' close; a
   * Safari click, which focuses nothing): the index's button for the piece
   * the CLOCK is on, as the owner decided (Codex-1yd58.8: "the opener or the
   * current index button"; WCAG 2.4.3); where the index is out of sight (a
   * phone's), the reel's pause. In that order, never by tree order, where
   * the pause comes first (WP-7 review r2). By the clock, since the index's
   * `aria-current` follows only once the words' swap lands, at the cut's
   * bottom (WP-6 review M4).
   * Where checkVisibility is missing (Safari before 17.4) a stop serves as
   * Dialog's does.
   */
  function nextFocus(): HTMLElement | null {
    const inSight = (el: HTMLElement | null | undefined) => (el && (el.checkVisibility?.() ?? true) ? el : null);
    const item = rootEl?.querySelectorAll<HTMLElement>('.reel__item')[clock.index];
    return inSight(item) ?? inSight(rootEl?.querySelector<HTMLElement>('.reel__round')) ?? null;
  }

  // ── time: the clock runs while nothing stops it ──
  $effect(() => {
    const root = rootEl;
    const c = clock;
    if (!root || !c.running) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      c.tick(Math.min(100, now - last));
      last = now;
      root.style.setProperty('--_progress', String(progressOnShow()));
      root.style.setProperty('--_push-progress', String(pushOnShow()));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });
  // Each piece starts its bar from 0, under a hold too (an index pick while
  // the pointer rests on the index), when no frame writes it; and the bar
  // and the push follow the piece on show when it changes (its own swap,
  // out of a frame).
  $effect(() => {
    void clock.starts;
    void shownKey;
    const root = rootEl;
    if (!root) return;
    untrack(() => {
      root.style.setProperty('--_progress', String(progressOnShow()));
      root.style.setProperty('--_push-progress', String(pushOnShow()));
    });
  });

  // A phone's press and hold pauses, while it lasts (owner, 2026-11-19).
  const pressed = $derived(clock.holding('press'));
  // Pause, the press and the static path hold the window's shader too (owner Q6).
  $effect(() => {
    if (!clock.paused && !pressed && clock.moves) return;
    return shaderTone.hold();
  });

  $effect(() => {
    clock.hold('film', filmPlaying || theatre !== null);
  });

  // The tab or the hero out of view: nothing plays, nothing moves on.
  let pageVisible = $state(true);
  let onScreen = $state(true);
  $effect(() => {
    const root = rootEl;
    if (!root) return;
    const visibility = () => (pageVisible = document.visibilityState === 'visible');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
    });
    observer.observe(root);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  });
  $effect(() => {
    clock.hold('away', !onScreen);
  });
  // The footage stops while a film plays over it (the hero's, or the phone's
  // pop-up) and while the theatre plays its own copy, with sound: a page
  // never decodes two films at once (2026-11-21).
  const playing = $derived(
    mode === 'footage' &&
      !clock.paused &&
      !filmPlaying &&
      !theatre &&
      !pressed &&
      pageVisible &&
      onScreen
  );

  // ── motion (WP-6): the hero's four motion settings, in the window's shader ──
  // The logic is the hook's (`reel-motion.svelte.ts`). The stage shows the
  // piece it names: the one going out until the cut's bottom.
  const reelMotion = useReelMotion({
    options: () => options,
    frame: () => look.frame,
    root: () => rootEl,
    keys: () => keys,
    index: () => clock.index,
    paused: () => clock.paused || pressed || !onScreen,
    moves: () => moves,
    phone: () => !desktop.current,
    reducedMotion: () => reducedMotion.current,
    filmPlaying: () => filmPlaying,
  });
  // The words come in when the stage shows their piece (review M4): at the
  // cut's bottom, never over the piece going out. With no stage named yet
  // (the hook not run), as soon as they are out.
  $effect(() => {
    const key = due;
    if (key === null) return;
    const at = reelMotion.stage;
    const staged = at === null ? null : (keys[at] ?? null);
    if (staged !== null && staged !== key) return;
    untrack(() => {
      due = null;
      if (shownKey === key) return;
      shownKey = key;
      if (swap === 'out') swap = 'in';
    });
  });

  // ── holds: the pointer over the words, index or strip; focus; a press ──
  function hover(on: boolean) {
    return (event: PointerEvent) => {
      if (event.pointerType === 'mouse') clock.hold('pointer', on);
    };
  }
  // Keyboard focus holds (a reader tabbing through); a click's focus does not,
  // or Play would wait for a click elsewhere before it plays.
  function focusIn(event: FocusEvent) {
    clock.hold('focus', event.target instanceof Element && event.target.matches(':focus-visible'));
  }
  function focusOut(event: FocusEvent) {
    const to = event.relatedTarget;
    if (!(to instanceof Node && rootEl?.contains(to))) clock.hold('focus', false);
  }

  let press: { x: number; y: number; timer: ReturnType<typeof setTimeout>; held: boolean } | null = null;
  function pressStart(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    // A press in the theatre is the theatre's, never a tap on the reel.
    if (event.target instanceof Element && event.target.closest('a, button, input, [role="dialog"]')) return;
    const timer = setTimeout(() => {
      if (!press) return;
      press.held = true;
      clock.hold('press', true);
    }, PRESS_MS);
    press = { x: event.clientX, y: event.clientY, timer, held: false };
  }
  function pressMove(event: PointerEvent) {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) pressEnd(false);
  }
  /** `tapped`: the press ended where it began; a swipe, scroll or cancel is not a tap. */
  function pressEnd(tapped: boolean) {
    if (!press) return;
    clearTimeout(press.timer);
    const { held, x } = press;
    press = null;
    clock.hold('press', false);
    // A film the browser refused to autoplay may play from a touch: a tap or
    // a press's release is the gesture it waits for (a film-only reel has no
    // other piece to tap on to).
    if (tapped) stage?.retry();
    if (held || !tapped || !rootEl) return;
    const box = rootEl.getBoundingClientRect();
    if (x - box.left < box.width / 3) clock.back();
    else clock.next();
  }

  // ── type that fits: the Wide title, the name window ──
  let measurer: CanvasRenderingContext2D | null = null;
  function widthAt100(el: HTMLElement, text: string): number {
    measurer ??= document.createElement('canvas').getContext('2d');
    if (!measurer) return 0;
    const style = getComputedStyle(el);
    measurer.font = `${style.fontWeight} 100px ${style.fontFamily}`;
    return measurer.measureText(text).width;
  }
  /** Run `fit` now, once the fonts are in, and on every resize. */
  function refit(fit: () => void) {
    fit();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fit();
    });
    window.addEventListener('resize', fit);
    return () => {
      live = false;
      window.removeEventListener('resize', fit);
    };
  }

  // Every piece's title fitted to the words' width, so the one on show takes
  // its own the moment it shows. The sizers never take one: they hold Wide's
  // title at its most from the first paint (`--_wide-max`, review r5 S5).
  let wideSizes = $state<number[] | null>(null);
  $effect(() => {
    const el = titleEl;
    const titles = words.map((w) => w.title);
    if (layout !== 'wide' || !desktop.current || !el) {
      wideSizes = null;
      return;
    }
    return refit(() => {
      const available = el.parentElement?.clientWidth ?? 0;
      wideSizes = titles.map((title) => fitTitle(widthAt100(el, title), available, WIDE_TITLE.min, WIDE_TITLE.max));
    });
  });
  const wideSize = $derived(wideSizes?.[shown] ?? null);

  // The name as large as the width and its room let it be, never under
  // TYPE_FLOOR. Out of flow (a tall screen) the window moves nothing, so the
  // fit takes the room it has at its place, between the top bar and the
  // words. On a short screen CSS puts it in flow (the owner's floor): the
  // window fills the room between them, and CSS sets the name at the floor
  // there, so the hero grows only where the floor needs it. The fit sets the
  // name in that box and holds the box at what CSS drew (`nameBox`), so
  // nothing moves when the page hydrates.
  let nameFit = $state<NameLines | null>(null);
  let nameBox = $state<number | null>(null);
  $effect(() => {
    const el = windowEl;
    const max = desktop.current ? (peek ? NAME_MAX.deskPeek : NAME_MAX.desk) : NAME_MAX.phone;
    // The words' slot is the room's foot: it moves with the pieces' words.
    void words;
    if (layout !== 'name' || !el) {
      nameFit = null;
      nameBox = null;
      return;
    }
    return refit(() => {
      const measure = (text: string) => widthAt100(el, text);
      if (getComputedStyle(el).position === 'absolute') {
        nameBox = null;
        const room = roomAt(el);
        nameFit =
          room === null
            ? nameLines(name, measure, el.clientWidth, max)
            : nameInRoom(name, measure, el.clientWidth, max, room, TYPE_FLOOR);
        return;
      }
      const drawn = drawnName(el);
      const room = Math.max(drawn, rowRoom(el));
      const fit = nameInRoom(name, measure, el.clientWidth, max, room, TYPE_FLOOR);
      nameBox = drawn;
      // A name the canvas sets taller than CSS drew it keeps CSS's, so the
      // box never grows past the server's paint.
      nameFit = fit.lines.length * fit.size <= room + 0.5 ? fit : null;
    });
  });
  /**
   * The name in flow as CSS draws it, the server's paint: the height of one
   * run of text in the window's own rules (its size, `--_name-size`, the
   * floor; its tracking, in em), wrapped to the window's width. A hidden copy
   * of the window, with none of the fit's inline sizes, taken out at once.
   */
  function drawnName(el: HTMLElement): number {
    const probe = el.cloneNode(false);
    if (!(probe instanceof HTMLElement)) return 0;
    probe.removeAttribute('style');
    probe.style.cssText = `position:absolute;top:0;left:0;width:${el.clientWidth}px;margin:0;visibility:hidden`;
    const run = document.createElement('span');
    run.textContent = name;
    probe.appendChild(run);
    el.insertAdjacentElement('afterend', probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  }
  /**
   * The room the window in flow has as CSS lays it out: the second row as the
   * hero's least height leaves it, less the window's margins. Read from the
   * inner's other rows, which the window never sizes, so the name the fit set
   * last never inflates it.
   */
  function rowRoom(el: HTMLElement): number {
    const inner = el.parentElement;
    if (!inner) return 0;
    const grid = getComputedStyle(inner);
    const own = getComputedStyle(el);
    const [bar = 0, , foot = 0] = grid.gridTemplateRows.split(' ').map(Number.parseFloat);
    const room =
      Number.parseFloat(grid.minHeight) -
      Number.parseFloat(grid.paddingTop) -
      Number.parseFloat(grid.paddingBottom) -
      bar -
      foot -
      Number.parseFloat(own.marginTop) -
      Number.parseFloat(own.marginBottom);
    return Number.isFinite(room) ? Math.max(0, room) : 0;
  }
  /**
   * The room the name has out of flow, at its place (NAME_AT of the hero's
   * height, its centre): twice the less of its centre's reach up to the top
   * bar's foot and down to the words' slot. The window, out of flow, moves
   * neither. Null where nothing is laid out.
   */
  function roomAt(el: HTMLElement): number | null {
    const inner = el.parentElement;
    const top = inner?.querySelector('.reel__top')?.getBoundingClientRect();
    const slot = inner?.querySelector('.reel__slot')?.getBoundingClientRect();
    const box = inner?.getBoundingClientRect();
    if (!top || !slot || !box || !(box.height > 0)) return null;
    const centre = box.top + NAME_AT * box.height;
    return Math.max(0, 2 * Math.min(centre - top.bottom, slot.top - centre));
  }

  // The name as the film's window: drawn where the page lays it out, each
  // word on its baseline in its letter-spacing, at the window's size, white
  // on black (the compositor reads its red channel). The title's own
  // placement (`title-mask.ts`): one for both windows (review R3-M1). Its
  // translateY(-50%) is where the name rests, so it stays in.
  function drawMask(el: HTMLElement) {
    showreelFeed.setNameMask(drawTitleMask(el, { undoTranslation: false }));
  }
  $effect(() => {
    const el = windowEl;
    if (!nameFit || !el) {
      showreelFeed.setNameMask(null);
      return;
    }
    let live = true;
    void tick().then(() => {
      if (live) drawMask(el);
    });
    return () => {
      live = false;
    };
  });
  $effect(() => () => showreelFeed.setNameMask(null));

  // ── the title as the film's window on Corner and Wide (WP-6, owner 2026-11-21) ──
  // "Through the name" runs on every layout: there the big title's words are
  // the letters (`title-mask.ts`). The Name window's mask stays the effect
  // above's: this one never draws on that layout, and draws after it.
  const titleWindow = $derived(
    layout !== 'name' && (options['reel-opening'] === 'name' || options['reel-film'] === 'name')
  );
  $effect(() => {
    const el = titleEl;
    void current?.title;
    void wideSize;
    if (layout === 'name') return;
    if (!titleWindow || !el) {
      showreelFeed.setNameMask(null);
      return;
    }
    // Going out: the window stays where the last title sat until the next is in.
    if (swap === 'out') return;
    let live = true;
    let stop = () => {};
    void tick().then(() => {
      if (live) stop = refit(() => showreelFeed.setNameMask(drawTitleMask(el)));
    });
    return () => {
      live = false;
      stop();
    };
  });

  // ── contrast: the pools' least opacity for the inks as resolved ──
  let probe: CanvasRenderingContext2D | null = null;
  function rgba(color: string): { rgb: Rgb; alpha: number } | null {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe || !color) return null;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#010203';
    probe.fillStyle = color;
    if (probe.fillStyle === '#010203') return null;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = probe.getImageData(0, 0, 1, 1).data;
    return { rgb: [r, g, b], alpha: a / 255 };
  }
  /** What a scrim covers: its words, and the controls drawn in their ink. */
  const SCRIMMED = '[data-ink], .reel__round, .reel__ghost';
  /** Room the scrims keep past the last word, before they ease away. */
  const SCRIM_MARGIN = 24;
  /** The controls whose own glass fill carries their label or icon. */
  const FILLED = '.reel__ghost, .reel__round';
  /** The groups of words that read as one block: one outline strength each. */
  const GROUPED = '.reel__sig, .reel__meta, .reel__words, .reel__index, .reel__strip';
  /** The shades as solved: each scrim's peak, and its two ellipses. */
  function drawShades(root: HTMLElement, shades: readonly Shade[]) {
    for (const [prop, value] of Object.entries(shadeProps(shades))) {
      root.style.setProperty(prop, value);
    }
  }
  /** The ratio each scrimmed thing keeps: large text and the round icon
   *  control 3:1 (WCAG 1.4.3, 1.4.11), body text and the ghost's label 4.5:1. */
  function ratioOf(el: HTMLElement): number {
    if (el.dataset.ink) return el.dataset.ink === 'large' ? 3 : 4.5;
    return el.classList.contains('reel__round') ? 3 : 4.5;
  }
  /**
   * The scrims' tint and least opacity for the inks as resolved, and how far
   * each must hold it. No bands (owner, 2026-11-20): soft radial shades at
   * the header's corners and rising in from the foot's (`HEADER_SHADE`,
   * `FOOT_SHADE`), and each word's own halo (or a control's own fill) as
   * strong as its ink still needs over what the shades lay at its weakest
   * point. The header is its words and controls, and any control lying wholly
   * above the header's foot (the phone's pause); the foot is the rest. Each holds the least
   * opacity its own inks need. Below the foot's lowest word it clears over
   * all the room left (no margin: the held opacity already covers that word's
   * whole line box), so the hand-over to the page is as long and soft as the
   * layout allows.
   */
  function fitScrims(root: HTMLElement): boolean {
    const ground = rgba(getComputedStyle(root).getPropertyValue('--color-background'));
    if (!ground) return false;
    // An earlier fit's lifts and own poles come off FIRST, before any colour
    // is read, so every colour is the brand's as it set it. Read after them,
    // the last fit's lift counted as the brand's colour and each fit drew a
    // new tint, creeping toward black (review, 2026-11-21).
    for (const node of root.querySelectorAll<HTMLElement>('[data-lifted], [data-own-pole]')) {
      node.style.removeProperty('color');
      node.style.removeProperty('--_ring-tint');
      node.style.removeProperty('--_halo');
      node.style.removeProperty('--_ring2');
      node.style.removeProperty('--_soft');
      delete node.dataset.lifted;
      delete node.dataset.ownPole;
    }
    // The first paint's pole ink (until `data-fit`) stands aside while the
    // fit reads the brand's colours: within this task, so never painted.
    root.dataset.fitting = '';
    try {
      // A colour easing back from its lift reads as the lift (a transition's
      // start value), which the fit would take for the brand's (review R1).
      // The reel's words ease no colour; should one ever, it lands here at
      // once, so every colour read is the brand's own. `getAnimations`
      // flushes style, so the ease the removal starts is listed (Chrome,
      // calibrated 2026-11-21); jsdom has no Web Animations. Only the words
      // the fit reads: a theatre's hover or the film layer's ease, inside the
      // same reel, keeps its own 100 ms (wp4-review r3).
      for (const node of root.querySelectorAll<HTMLElement>(`${SCRIMMED}, :is(${SCRIMMED}) *`)) {
        for (const motion of node.getAnimations?.() ?? []) {
          if (easesColour(motion)) motion.finish();
        }
      }
      solveScrims(root, ground.rgb);
    } finally {
      delete root.dataset.fitting;
    }
    return true;
  }
  /** A CSS transition of `color` (a `CSSTransition`). */
  function easesColour(motion: Animation): boolean {
    return 'transitionProperty' in motion && motion.transitionProperty === 'color';
  }
  function solveScrims(root: HTMLElement, ground: Rgb) {
    const box = root.getBoundingClientRect();
    const laid = [...root.querySelectorAll<HTMLElement>(SCRIMMED)]
      // In 'shadow', each word judged where its glyphs sit (`glyphBox`, review
      // R4), never its block's far end. In 'outline' by its box: the ring and
      // its halo reach past the glyphs, and judged by them alone the index's
      // "02" fell short (4.47:1 on OBB). A control by its own box, which its
      // fill covers.
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, r, glyphs: el.matches(FILLED) || edge === 'outline' ? r : glyphBox(el) };
      })
      // Out of sight (the screen readers' name) or not laid out.
      .filter(({ r }) => r.width > 1 && r.height > 1);
    const inHeader = (el: HTMLElement) => el.closest('.reel__top') !== null;
    // The header bar's own box, laid out even when it shows no words (Name
    // on a phone), so the pause above it still counts as the header's.
    const bar = root.querySelector('.reel__top')?.getBoundingClientRect();
    const headerFoot = Math.max(
      0,
      bar && bar.height > 1 ? bar.bottom - box.top : 0,
      ...laid.filter(({ el }) => inHeader(el)).map(({ r }) => r.bottom - box.top)
    );
    // A box as fractions of the reel's.
    const span = (r: GlyphBox) => ({
      left: (r.left - box.left) / box.width,
      top: (r.top - box.top) / box.height,
      right: (r.right - box.left) / box.width,
      bottom: (r.bottom - box.top) / box.height,
    });
    // Each word's ink, with the most it may need where its glyphs sit
    // (`wordRoom`, review r3 n1, n3); a control's fill has the scrim's cap.
    const allInks: { ink: Ink; ratio: number; room?: number }[] = [];
    let top = 0;
    let foot = 0;
    let gap = box.height;
    for (const { el, r, glyphs } of laid) {
      const header = inHeader(el) || r.bottom - box.top <= headerFoot;
      const ink = rgba(getComputedStyle(el).color);
      if (ink) {
        const room = el.matches(FILLED) ? undefined : wordRoom(edge, span(glyphs));
        allInks.push({ ink, ratio: ratioOf(el), room });
      }
      if (header) top = Math.max(top, r.bottom - box.top);
      else {
        foot = Math.max(foot, box.bottom - r.top);
        gap = Math.min(gap, box.bottom - r.bottom);
      }
    }
    // The veil's pole from the ground alone, by the switch CSS draws the first
    // paint with (`--_light`: `--_gy`, 0 when unset, at the 0.1791 pivot):
    // a dark brand keeps a dark veil whatever its inks are (owner,
    // 2026-11-21), and every colour that fails is lifted toward white.
    const groundY = Number.parseFloat(getComputedStyle(root).getPropertyValue('--_gy'));
    const { veil, ink: pole } = groundPoles(Number.isFinite(groundY) ? groundY : 0);
    // Whole channels, as CSS will paint them: the alpha is solved for these.
    // A colour no scrim of the veil's pole can carry (a player text the
    // creator set, as #CB213C on #0F0000) is lifted below toward `pole`, or
    // ringed in its own: `scrimTint` solves it as that pole.
    const [r, g, b] = scrimTint(ground, veil, allInks, pole);
    const tint: Rgb = [Math.round(r), Math.round(g), Math.round(b)];
    root.style.setProperty('--_scrim', `rgb(${tint.join(' ')})`);
    // Each scrimmed thing's own need (`scrimAlpha` for its COMPUTED ink, with
    // FLOOR_MARGIN; a brand colour is solved as it is, never as an assumed
    // white or dark), over its glyphs. Null: no scrim of the tint can carry it.
    // A colour that cannot keep its floor where it sits is lifted toward the
    // ink pole opposite the veil (`pole`: white over a dark brand's), a
    // twentieth at a time, just far enough, over the footage only
    // (owner, 2026-11-20); never toward the reel's own ink, which a creator
    // may set to that very colour (review, 2026-11-21). What it must pass:
    // in 'shadow', a shade must carry it; a control's own fill carries any
    // colour a scrim of the tint carries by MAX_SCRIM_ALPHA; in 'outline', a
    // word no scrim carries keeps its colour inside a ring of its own pole,
    // so it needs only a ring that can. Each group of words glows softly in
    // the brand's dark at its strongest word's need (GLOW_SHARE, from the
    // 1 px ring probe), and the corner shades grow only as far as each word
    // still needs past it.
    const carried = (ink: Ink, ratio: number) => {
      const need = scrimAlpha([{ ink, ratio }], tint);
      return need !== null && glowLeaves(need, need) <= SHADE_PEAK_MAX;
    };
    const solvable = (ink: Ink, ratio: number) => scrimAlpha([{ ink, ratio }], tint) !== null;
    // A control's fill may cover the film as far as any scrim may.
    const filled = (ink: Ink, ratio: number) => {
      const need = scrimAlpha([{ ink, ratio }], tint);
      return need !== null && need <= MAX_SCRIM_ALPHA;
    };
    const ringed = (ink: Ink, ratio: number, under: number) =>
      solvable(ink, ratio) || outlineAlpha({ ink, ratio }, under, tint, ownPole([{ ink, ratio }])) !== null;
    const roles = laid.flatMap(({ el, glyphs }) => {
      // Its own ink and any child's in another (the kicker's number), so the
      // strictest of them is solved.
      const ratio = ratioOf(el);
      const fill = el.matches(FILLED);
      const at = span(glyphs);
      const drawn = shadeFloor(at, SHADES);
      const fits = (ink: Ink) =>
        fill ? filled(ink, ratio) : edge === 'shadow' ? carried(ink, ratio) : ringed(ink, ratio, drawn);
      const nodes = [el, ...el.querySelectorAll<HTMLElement>('*')].flatMap((node) => {
        const ink = rgba(getComputedStyle(node).color);
        return ink ? [{ node, ink }] : [];
      });
      if (nodes.length === 0) return [];
      // The nodes that cannot pass as they are: the ones a lift moves, from
      // the least step that passes each, or the pole itself.
      const lifted = nodes.filter(({ ink }) => !fits(ink));
      let step = 0;
      for (const { ink } of lifted) step = Math.max(step, liftStep(ink, pole, fits) ?? 20);
      return [{ el, span: at, ratio, fill, nodes, lifted, step }];
    });
    type Role = (typeof roles)[number];
    const inksOf = (role: Role) =>
      role.nodes.map(({ ink }) => ({
        ink: role.lifted.some((l) => l.ink === ink)
          ? { rgb: over(pole, role.step / 20, ink.rgb), alpha: ink.alpha }
          : ink,
        ratio: role.ratio,
      }));
    const needOf = (role: Role) => scrimAlpha(inksOf(role), tint);
    const groupOf = (el: HTMLElement) => el.closest<HTMLElement>(GROUPED) ?? el;
    let shades: readonly Shade[] = SHADES;
    const glows = new Map<HTMLElement, number>();
    // A word short where it sits, of what is drawn under it: in 'shadow', its
    // shades with its group's glow (a shade that falls short is no solve,
    // review R4); in 'outline', its ring, which past solid lays less than its
    // need asks (`ringCarries`, review r5).
    const short = (role: Role) => {
      const need = needOf(role);
      if (need === null || role.fill) return false;
      const under = shadeFloor(role.span, shades);
      if (edge === 'outline') return !ringCarries(need, under);
      return glowLeaves(need, glows.get(groupOf(role.el)) ?? 0) > under + 1e-9;
    };
    for (let round = 0; round <= 20; round++) {
      glows.clear();
      for (const role of roles) {
        const need = needOf(role);
        if (role.fill || need === null) continue;
        const group = groupOf(role.el);
        glows.set(group, Math.max(glows.get(group) ?? 0, need));
      }
      if (edge === 'outline') {
        // No shade grows in 'outline': a word short of its ring lifts its
        // failing nodes one step further, a twentieth at a time, as one short
        // of its shades does below.
        const further = roles.flatMap((role) => {
          if (role.step >= 20 || !short(role)) return [];
          const under = shadeFloor(role.span, shades);
          role.lifted = liftedNodes(role.nodes, role.lifted, (ink) => {
            const need = scrimAlpha([{ ink, ratio: role.ratio }], tint);
            return need === null || !ringCarries(need, under);
          });
          return role.lifted.length > 0 ? [role] : [];
        });
        if (further.length === 0) break;
        for (const role of further) role.step += 1;
        continue;
      }
      const asked = new Map<Need, Role>();
      for (const role of roles) {
        const need = needOf(role);
        if (role.fill || need === null) continue;
        const left = glowLeaves(need, glows.get(groupOf(role.el)) ?? 0);
        if (left <= SHADE_PEAK_MAX) asked.set({ span: role.span, need: left }, role);
      }
      // A word its carrier leaves short takes a second, bounded so the
      // header still reads as a shadow from each side (`secondCarrier`; a
      // phone's top-bar name, 2026-11-22).
      const needs = [...asked.keys()];
      const grown = secondCarrier(needs, growShades(needs).shades);
      shades = grown.shades;
      // A word still short where it sits: one step further, and again. A
      // colour carried as it is but short here (review r3 M1) starts at its
      // failing nodes, from step 0, a twentieth at a time like any lift;
      // only one still short at the pole itself wears it outright (below).
      const further = grown.short.flatMap((n) => {
        const role = asked.get(n);
        if (!role || role.step >= 20) return [];
        // Its failing nodes taken again each round, with those it already
        // lifts (review r4 LOW): as a lift lowers one node's need, the
        // group's glow can fall and a node that passed turn short.
        const under = shadeFloor(role.span, shades);
        const glow = glows.get(groupOf(role.el)) ?? 0;
        role.lifted = liftedNodes(role.nodes, role.lifted, (ink) => {
          const need = scrimAlpha([{ ink, ratio: role.ratio }], tint);
          return need === null || glowLeaves(need, glow) > under + 1e-9;
        });
        return role.lifted.length > 0 ? [role] : [];
      });
      if (further.length === 0) break;
      for (const role of further) role.step += 1;
    }
    // Checked, never assumed: every role must now have a solved need that
    // what is drawn under it meets (never `short`), or, in 'outline', a ring
    // of its own pole that carries it. One that does not wears the pole
    // outright; one the pole cannot rescue either is reported.
    const solved = (role: Role) => {
      if (needOf(role) !== null) return !short(role);
      if (role.fill || edge === 'shadow') return false;
      const under = shadeFloor(role.span, shades);
      const inks = inksOf(role);
      const own = ownPole(inks);
      return inks.every((ink) => outlineAlpha(ink, under, tint, own) !== null);
    };
    const unrescued: string[] = [];
    for (const role of roles) {
      if (solved(role)) continue;
      role.lifted = role.nodes;
      role.step = 20;
      if (!solved(role)) unrescued.push(role.el.className);
    }
    // Once per shortfall a page load (review R6): every fit of it would say
    // the same. Keyed on the roles too, so a later fit under the same tint
    // that leaves a different role short says so (wp4-review r6 L1).
    const brand = tint.join(' ');
    const shortRoles = unrescued.join(' | ');
    const shortfall = `${brand} ${shortRoles}`;
    if (unrescued.length > 0 && !warnedShortfalls.has(shortfall)) {
      warnedShortfalls.add(shortfall);
      logger.warn('Showreel: inks the reel cannot carry over every frame, even in its pole', {
        tint: brand,
        edge,
        roles: shortRoles,
      });
    }
    drawShades(root, shades);
    for (const role of roles) {
      for (const { node, ink } of role.lifted) {
        const [lr, lg, lb] = over(pole, role.step / 20, ink.rgb).map(Math.round);
        node.style.setProperty('color', `rgb(${lr} ${lg} ${lb} / ${ink.alpha})`, 'important');
        node.dataset.lifted = '';
      }
    }
    // A control's fill, exactly what its label still needs. In 'outline', one
    // strength per group (its strongest word's), so each group reads as one
    // block; a word no scrim of the tint can carry (red on a dark brand)
    // keeps its colour and is outlined in its own pole instead.
    const groups = new Map<HTMLElement, number>();
    let pool = 0;
    for (const role of roles) {
      const { el, span: at, fill } = role;
      const inks = inksOf(role);
      const need = needOf(role);
      const under = shadeFloor(at, shades);
      if (need !== null) pool = Math.max(pool, need);
      if (fill) {
        el.style.setProperty('--_halo', String(haloAlpha(need ?? 1, under)));
        continue;
      }
      if (edge !== 'outline') continue;
      if (need === null) {
        const own = ownPole(inks);
        const alpha = Math.max(...inks.map((ink) => outlineAlpha(ink, under, tint, own) ?? 1));
        el.style.setProperty('--_ring-tint', `rgb(${own.join(' ')})`);
        el.style.setProperty('--_halo', String(alpha));
        // Its own pole stays close to its glyphs: a second solid ring and no
        // soft glow, so a pale ring never washes the white words beside it.
        el.style.setProperty('--_ring2', '1');
        el.style.setProperty('--_soft', '0');
        el.dataset.ownPole = '';
        continue;
      }
      const group = groupOf(el);
      // Its ring at the solved halo and RING_MARGIN more (review r4 "02").
      groups.set(group, Math.max(groups.get(group) ?? 0, ringHalo(need, under)));
    }
    // The most any word needs, after its lift: what a word not yet fitted
    // holds meanwhile. Never a solid scrim taken for a colour the lift rescued.
    root.style.setProperty('--_pool', String(pool));
    for (const [group, halo] of groups) group.style.setProperty('--_halo', String(halo));
    for (const [group, glow] of glows) group.style.setProperty('--_glow', String(glow));
    // The ring from the brand's focus colour as the page has it (the
    // parent's: the reel's own is this one), and the reel's ink. It is drawn
    // on its own band of the solid scrim (the focus rule's box-shadow), so
    // that is what it keeps 3:1 against, whatever the frame.
    const focus = rgba(getComputedStyle(root.parentElement ?? root).getPropertyValue('--color-focus'));
    const ink = rgba(getComputedStyle(root).color);
    if (focus && ink) {
      const ring = focusInk(focus.rgb, ink.rgb, tint, 1).map(Math.round);
      root.style.setProperty('--color-focus', `rgb(${ring.join(' ')})`);
    }
    root.style.setProperty('--_top-reach', `${Math.ceil(top + SCRIM_MARGIN)}px`);
    root.style.setProperty('--_foot-reach', `${Math.ceil(foot + SCRIM_MARGIN)}px`);
    root.style.setProperty('--_foot-clear', `${Math.max(0, Math.floor(gap))}px`);
  }
  // Again for each piece (its words differ), on a resize, once the fonts are
  // in, when a failed logo's stand-in shows (a word the header's shade must
  // carry), and whenever the inks may have turned: the theme toggled, or the
  // brand repainted in place (the editor's live preview, hydration's own
  // brand). Once a frame at most, however many arrive in it.
  $effect(() => {
    const root = rootEl;
    void layout;
    void peek;
    void shown;
    void edge;
    void standIn;
    void themeState.theme;
    if (!root) return;
    let live = true;
    let frame = 0;
    // `data-fit`: a fit has run since the fonts were in (what a probe waits on).
    let fontsIn = !document.fonts;
    const fit = () => {
      if (!live || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!live) return;
        if (fitScrims(root) && fontsIn) root.dataset.fit = '';
      });
    };
    void tick().then(fit);
    void document.fonts?.ready.then(() => {
      fontsIn = true;
      fit();
    });
    // `ready` is one promise, and it can resolve before a face has begun to
    // load (a fast hydration beats the webfont). A face that lands later moves
    // the words the fit measured: fit again whenever one does (2026-11-21).
    document.fonts?.addEventListener('loadingdone', fit);
    const resized = new ResizeObserver(fit);
    resized.observe(root);
    const restyled = new MutationObserver(fit);
    const brand = root.closest('[data-org-brand]');
    if (brand) restyled.observe(brand, { attributes: true, attributeFilter: ['style', 'class'] });
    // A colour still easing (a link's `--transition-colors`) reads as its
    // in-between value: measure again once it has landed. Never for a lift's
    // own ease, which the fit lands itself (`fitScrims`): fitting again on
    // it, every fit's lift would ask for the next one (review R1).
    const landed = (event: TransitionEvent) => {
      if (event.propertyName !== 'color') return;
      if (event.target instanceof Element && event.target.closest('[data-lifted]')) return;
      fit();
    };
    root.addEventListener('transitionend', landed);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      document.fonts?.removeEventListener('loadingdone', fit);
      resized.disconnect();
      restyled.disconnect();
      root.removeEventListener('transitionend', landed);
    };
  });

  const strip = $derived(layout !== 'corner');
  // With the logo leading alone the name stays in the page for screen
  // readers (OrgHero's rule), and in sight when there is no logo to lead,
  // and with a failed one too, where its stand-in shows it (`standIn`).
  const nameHidden = $derived(options.lead === 'logo' && !!logoUrl);
  // A logo leading alone that failed: the name stands in over its place, out
  // of flow, so its showing moves nothing (WP-0's fallback, under the rule
  // that a load failure keeps its box). Unseen to screen readers, which have
  // the h1 already.
  const standIn = $derived(layout !== 'name' && nameHidden && logoFailed);
  // A word in the name longer than any phone's top bar holds (320 px less
  // the gutters, a logo and its gap, at 0.6 em a letter): it steps down and
  // breaks where it must on a phone, never past the reel (WP-5a).
  const longWord = $derived(name.split(/\s+/).some((word) => word.length > NAME_WORD_MAX));
</script>

{#snippet item(w: ReelWords, i: number, kind: boolean)}
  <li>
    <button type="button" class="reel__item" aria-current={i === shown ? 'true' : undefined} onclick={() => clock.go(i)}>
      <span class="reel__n" data-ink="body">{w.number}</span>
      <span class="reel__t" data-ink="body">{w.title}</span>
      {#if kind}<span class="reel__k" data-ink="body">{w.kind}</span>{/if}
      <span class="reel__bar" aria-hidden="true"><i></i></span>
    </button>
  </li>
{/snippet}

<!-- The pause, first in the reel's tab order (WCAG 2.2.2), drawn where each
     layout keeps it: atop the index, at the strip's end, by the phone's segments. -->
{#snippet pause()}
  <div class="reel__ctl">
    <!-- The mouse resting on it holds the reel, as over the index it sits by. -->
    <button
      type="button"
      class="reel__round"
      onpointerenter={hover(true)}
      onpointerleave={hover(false)}
      aria-label={clock.paused ? m.org_hero_reel_play() : m.org_hero_reel_pause()}
      onclick={() => clock.togglePause()}
    >
      {#if clock.paused}
        <PlayIcon size={14} aria-hidden="true" />
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
      {/if}
    </button>
  </div>
{/snippet}

<!-- The org, its facts, Follow and its Join or Explore. -->
{#snippet top()}
  <header class="reel__top">
    <div class="reel__sig">
      {#if logoUrl}<img src={logoUrl} alt="" onerror={onlogofail} data-failed={logoFailed ? '' : undefined} />{/if}
      {#if layout !== 'name'}<h1 class={['reel__name', { 'sr-only': nameHidden }]} data-ink="body" data-long-word={longWord ? '' : undefined}>{name}</h1>{/if}
      {#if standIn}<span class="reel__name reel__stand-in" aria-hidden="true" data-ink="body" data-long-word={longWord ? '' : undefined}>{name}</span>{/if}
    </div>
    <div class="reel__meta">
      {#if facts}<span data-ink="body">{facts}</span>{/if}
      <button type="button" class="reel__ghost" onclick={onfollow} disabled={followBusy}>
        {following ? m.org_following() : m.org_hero_follow_short()}
      </button>
      {#if action}<a class="reel__ghost" href={action.href}>{action.label}</a>{/if}
    </div>
  </header>
{/snippet}

<!-- The Name window: the org's name, the film's window. -->
{#snippet nameWindow()}
  <h1
    class="reel__window"
    bind:this={windowEl}
    data-still={media[shown]?.still ? '' : undefined}
    style:font-size={nameFit ? `${nameFit.size}px` : undefined}
    style:min-block-size={nameBox === null ? undefined : `${nameBox}px`}
    style:--_still={media[shown]?.still ? `url("${media[shown]?.still}")` : undefined}
  >
    {#if nameFit}
      {#each nameFit.lines as line, i (i)}<span data-line>{line}</span>{/each}
    {:else}
      <span data-line>{name}</span>
    {/if}
  </h1>
{/snippet}

<!-- The phone's story segments. -->
{#snippet segments()}
  <div class="reel__segs">
    <ol>
      {#each words as _, i (i)}
        <li data-on={i === shown ? '' : undefined} data-done={i < shown ? '' : undefined}><i></i></li>
      {/each}
    </ol>
  </div>
{/snippet}

<!-- What is playing: its number and kind, its title, its line and its button. -->
{#snippet playingNow(now: ReelWords)}
  <div
    class="reel__words"
    data-swap={swap || undefined}
    role="group"
    aria-roledescription="slide"
    aria-label={m.org_hero_reel_slide({ number: now.number, total: String(reel.length).padStart(2, '0') })}
    aria-live={clock.running ? 'off' : 'polite'}
    onpointerenter={hover(true)}
    onpointerleave={hover(false)}
  >
    <p class="reel__kicker reel__swap" data-ink="body"><b>{now.number}</b> <span>{now.kicker}</span></p>
    {#if lineFirst}
      <h2 class="reel__title reel__title--line reel__swap" data-ink="body">{now.line}</h2>
    {:else}
      <h2
        class="reel__title reel__swap"
        bind:this={titleEl}
        data-ink="large"
        data-long={now.title.length > 20 ? '' : undefined}
        style:--_size={wideSize ? `${wideSize}px` : undefined}
      >
        {now.title}
      </h2>
    {/if}
    <div class="reel__row reel__swap">
      {#if now.line && !lineFirst}<p class="reel__line" data-ink="body">{now.line}</p>{/if}
      {@render acts(now)}
    </div>
  </div>
{/snippet}

<!-- Its button, and the preview with sound where its button plays something else. -->
{#snippet acts(now: ReelWords)}
  <div class="reel__acts">
    {#if now.action.kind === 'film'}
      <button
        type="button"
        class="reel__btn"
        onclick={mainOpensTheatre ? openTheatre : onfilm}
        {@attach preloadPlayerOnIntent}
      >
        <PlayIcon size={16} aria-hidden="true" />
        {now.action.label}
      </button>
    {:else}
      <a class="reel__btn" href={now.action.href}>{now.action.label}</a>
    {/if}
    {#if previewAt(shown)}
      <button
        type="button"
        class="reel__ghost reel__preview"
        aria-label={m.org_hero_reel_preview_sound()}
        onclick={openTheatre}
        {@attach preloadPlayerOnIntent}
      >
        <Volume2Icon size={16} aria-hidden="true" />
        <span class="reel__preview-label">{m.org_hero_reel_preview_sound()}</span>
      </button>
    {/if}
  </div>
{/snippet}

<!--
  A piece's words as they lay out when it shows, unseen (WP-5b): one per
  piece, stacked under the words in their slot, so the slot is always the
  tallest piece's height and a short screen's hero, grown to hold it, keeps
  its height as the pieces change. Out of sight, out of the accessibility
  tree and inert, with no control, link, id or `data-ink`: the fit, the
  probes, axe and the tab order never meet one. Its preview is a stand-in
  with the preview's box (`.reel__sizer-preview`), not the ghost the fit reads;
  its title is no heading, with the heading's box (a crawler reads the server's
  HTML, and would meet every piece's title as one more heading).
-->
{#snippet sizer(w: ReelWords, i: number)}
  <div class="reel__sizer">
    <p class="reel__kicker"><b>{w.number}</b> <span>{w.kicker}</span></p>
    {#if lineFirstAt(i)}
      <div class="reel__title reel__title--line">{w.line}</div>
    {:else}
      <div class="reel__title" data-long={w.title.length > 20 ? '' : undefined}>{w.title}</div>
    {/if}
    <div class="reel__row">
      {#if w.line && !lineFirstAt(i)}<p class="reel__line">{w.line}</p>{/if}
      <div class="reel__acts">
        <span class="reel__btn">
          {#if w.action.kind === 'film'}<PlayIcon size={16} aria-hidden="true" />{/if}
          {w.action.label}
        </span>
        {#if previewAt(i)}
          <span class="reel__sizer-preview">
            <Volume2Icon size={16} aria-hidden="true" />
            <span class="reel__preview-label">{m.org_hero_reel_preview_sound()}</span>
          </span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

<!-- Every entry: the strip along the foot (Wide, Name), or the index (Corner). -->
{#snippet entries()}
  {#if strip}
    <ol class="reel__strip" onpointerenter={hover(true)} onpointerleave={hover(false)}>
      {#each words as w, i (i)}{@render item(w, i, false)}{/each}
    </ol>
  {:else}
    <nav class="reel__index" aria-label={m.org_hero_reel_label()} onpointerenter={hover(true)} onpointerleave={hover(false)}>
      <ol>
        {#each words as w, i (i)}{@render item(w, i, true)}{/each}
      </ol>
      <a class="reel__all" href={exploreHref} data-ink="body">{m.org_hero_explore_everything()}</a>
    </nav>
  {/if}
{/snippet}

<section
  class="reel"
  bind:this={rootEl}
  data-hero-root
  data-layout={layout}
  data-peek={peek ? '' : undefined}
  data-edge={edge}
  data-mode={mode}
  data-paused={clock.paused ? '' : undefined}
  data-theatre={theatre?.item.kind}
  aria-roledescription="carousel"
  aria-label={m.org_hero_reel_label()}
  style:--_pool={FIRST_PAINT.pool}
  style:--_fp-deepen={FIRST_PAINT.deepen}
  style:--_fp-pale={FIRST_PAINT.pale}
  style:--_wide-max={`${WIDE_TITLE.max}px`}
  style:--_type-floor={`${TYPE_FLOOR}px`}
  style:--_name-fade-px={`${NAME_FADE_PX}px`}
  style:--_peak-top={firstShades['--_peak-top']}
  style:--_top-0={firstShades['--_top-0']}
  style:--_top-1={firstShades['--_top-1']}
  style:--_peak-foot={firstShades['--_peak-foot']}
  style:--_foot-0={firstShades['--_foot-0']}
  style:--_foot-1={firstShades['--_foot-1']}
  onfocusin={focusIn}
  onfocusout={focusOut}
  onpointerdown={pressStart}
  onpointermove={pressMove}
  onpointerup={() => pressEnd(true)}
  onpointercancel={() => pressEnd(false)}
>
  <ReelStage bind:this={stage} {media} {keys} index={reelMotion.stage ?? shown} {playing} {look} withheld={theatre?.item.kind === 'audio'} />
  <div class="reel__scrim-top" aria-hidden="true"></div>
  <div class="reel__scrim-foot" aria-hidden="true"></div>

  {@render filmLayer?.()}

  <div class="reel__inner" inert={filmOpen || theatre !== null}>
    {@render pause()}
    {@render top()}
    {#if layout === 'name'}{@render nameWindow()}{/if}
    {@render segments()}
    <div class="reel__slot">
      {#if current}{@render playingNow(current)}{/if}
      <div class="reel__sizers" aria-hidden="true" inert>
        {#each words as w, i (i)}{@render sizer(w, i)}{/each}
      </div>
    </div>
    {@render entries()}
  </div>
  {#if theatre}
    <ReelTheatre
      item={theatre.item}
      closeLabel={m.org_hero_reel_theatre_close()}
      caption={(seconds) =>
        seconds === null
          ? m.player_preview_label()
          : m.org_hero_reel_theatre_caption({ length: lengthOf(seconds) })}
      onclose={closeTheatre}
    />
  {/if}
</section>

<style>
  .reel {
    --_gutter: var(--space-24);
    /* 1 on a light ground, 0 on a dark one: the theme's ground luminance as
       the page resolves it (org-brand.css's `--_gy`, from the brand editor's
       `--brand-ground-y`), at the 0.1791 pivot the page's own inks turn on,
       so the right ink is there from the server's first paint. A light
       brand's reel reads in its own light palette, its text over a veil of
       its ground; a dark one keeps the player's white over its dark. The
       soft ink is the main one at the player's 80% either way, never the
       brand's secondary token: that one mixes `--color-text`, which a brand
       re-tuned from dark to light can still hold pale (OBB on 2026-11-20:
       pink on cream, which no veil carries). */
    /* The page's own switch (review R2): org-brand.css's `--_gw`, turned
       round, so a light page bound AT the pivot (`bindingLuminance`) is light
       here too; `groundPoles` reads the same. Unset, it reads dark. */
    --_light: calc(1 - clamp(0, (0.1791 - var(--_gy, 0)) * 1e12, 1));
    --_ink: color-mix(
      in srgb,
      var(--color-text-primary) calc(var(--_light) * 100%),
      var(--color-player-text)
    );
    --_ink-soft: color-mix(
      in srgb,
      color-mix(in srgb, var(--color-text-primary) calc(var(--opacity-80, 0.8) * 100%), transparent)
        calc(var(--_light) * 100%),
      var(--color-player-text-secondary)
    );
    /* The ink that stands furthest from the veil: white over a dark brand's,
       black over a light one's. Every word wears it until the fit has solved
       the brand's own colours over this film (`data-fit`), and with no script
       at all, so the first paint is never weaker than the fitted one: no
       brand colour and no soft ink before the fit has carried them (review
       M3, 2026-11-21). */
    --_pole-ink: color-mix(in srgb, black calc(var(--_light) * 100%), white);
    /* Until fitScrims has measured: the brand's ground, a deep shade of it
       under white ink or a pale one under dark (`FIRST_PAINT`, set on the
       root: pale enough that every word clears its floor's margin on a light
       ground at the pivot, review R5), held over the header and the foot's
       lower two thirds. */
    --_scrim: color-mix(
      in oklab,
      white calc(var(--_light) * var(--_fp-pale, 0.2) * 100%),
      color-mix(in oklab, black calc((1 - var(--_light)) * var(--_fp-deepen, 0.64) * 100%), var(--color-background))
    );
    --_top-reach: 12%;
    --_foot-reach: 66%;
    --_foot-clear: 0px;
    /* The ring is drawn over film, not the page's ground: until fitScrims
       has solved the brand's focus colour against the scrim (`focusInk`),
       the pole's ink, never the player text, which a creator may set dark on
       a dark brand (review R3: #8B1A2B). */
    --color-focus: var(--_pole-ink);
    --_glass-a: 0.55;
    --_line: color-mix(in srgb, var(--_ink) 22%, transparent);
    --_progress: 0;
    /* The piece on show's progress, for the stage's push-in (`pushOnShow`). */
    --_push-progress: 0;
    /* The peek's lift: none until `data-peek` sets it. */
    --_lift: 0px;
    /* The hero's least height: the screen less the lift. The big type's caps
       on a short screen are read from it (the owner's floor, below). */
    --_room: calc(100svh - var(--_lift));

    position: relative;
    z-index: 2;
    isolation: isolate;
    min-height: var(--_room);
    overflow: hidden;
    color: var(--_ink);
    touch-action: pan-y;
  }

  /* The peek: the hero a lift short of the screen's foot (the mock's 150 px;
     132 on a phone, below), so the featured row rises above the fold. */
  .reel[data-peek] {
    --_lift: calc(var(--space-32) + var(--space-5) + var(--space-0-5));
  }

  /* No colour eases on the reel's words or its links (review R1): a link's
     `--transition-colors` read back its START value, the lift, in the very
     task the fit took the lift off, so the fit judged it carried and dropped
     it, and its transitionend fitted again: a fit every 230 ms, the scrim
     flickering. Their background and border still ease. */
  .reel :is([data-ink], [data-ink] *, a, .reel__ghost, .reel__round) {
    transition-property: background-color, border-color;
  }

  /* The first paint (see `--_pole-ink`): set aside only while a fit reads
     the brand's colours (`data-fitting`, within one task, never painted). */
  .reel:not([data-fit]):not([data-fitting]) :is([data-ink], [data-ink] *, .reel__ghost, .reel__round) {
    color: var(--_pole-ink) !important;
  }

  .reel :global(p),
  .reel h1,
  .reel h2,
  .reel ol {
    margin: 0;
  }

  .reel ol {
    padding: 0;
    list-style: none;
  }

  /* ── the shades: soft radials, no band (owner, 2026-11-20) ── */
  /* The header's two corners and the foot's two radials (V-A, the owner's
     pick): ellipses anchored off the box, so no edge ever shows over the
     film, on RAMP's eased stops at their peak (its tail lands with no slope,
     so no ellipse ends in a kink). reel-scrim.ts holds the same
     ellipses (HEADER_SHADE, FOOT_SHADE), and fitScrims solves each word's
     halo over what they lay under it. */
  .reel__scrim-top,
  .reel__scrim-foot {
    --_ramp:
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 100%), transparent) 0%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 98.52%), transparent) 10%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 94.16%), transparent) 20%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 87.07%), transparent) 30%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 77.54%), transparent) 40%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 65.98%), transparent) 50%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 52.85%), transparent) 60%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 38.77%), transparent) 70%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 24.43%), transparent) 80%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 16.63%), transparent) 85%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 8.67%), transparent) 90%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 2.49%), transparent) 95%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 0.66%), transparent) 97.5%,
      color-mix(in srgb, var(--_scrim) calc(var(--_peak) * 0.11%), transparent) 99%,
      transparent 100%;

    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* Behind the name, and behind the facts and Follow. */
  .reel__scrim-top {
    --_peak: var(--_peak-top, 0.6);

    background:
      radial-gradient(var(--_top-0, ellipse 36% 22% at 2% -6%), var(--_ramp)),
      radial-gradient(var(--_top-1, ellipse 64% 24% at 100% -6%), var(--_ramp));
  }

  /* Rising in from off the bottom-left behind the words, and off the
     bottom-right behind the index. Below the lowest word it clears again
     (smoothstep's stops over all the room left), so the hero's edge draws
     only what the page below it draws, with no line. */
  .reel__scrim-foot {
    --_peak: var(--_peak-foot, 0.94);
    --_clear: linear-gradient(
      to top,
      transparent 0,
      rgb(0 0 0 / 0.05) calc(var(--_foot-clear) * 0.13),
      rgb(0 0 0 / 0.2) calc(var(--_foot-clear) * 0.29),
      rgb(0 0 0 / 0.55) calc(var(--_foot-clear) * 0.53),
      rgb(0 0 0 / 0.85) calc(var(--_foot-clear) * 0.76),
      rgb(0 0 0) var(--_foot-clear)
    );

    background:
      radial-gradient(var(--_foot-0, ellipse 78% 82% at 0% 108%), var(--_ramp)),
      radial-gradient(var(--_foot-1, ellipse 60% 82% at 102% 108%), var(--_ramp));
    mask-image: var(--_clear);
  }

  /* ── the parts in flow (WP-5b): the top bar at the head; the words, the
     index or the strip, and the pause at the foot; the room between them the
     grid's flexible row. On a tall screen that row takes the rest, so each
     part sits where it sat when placed on the reel; on a short one the hero
     grows to hold them all, and never clips or overlaps its own words. The
     name window and the phone's segments and pause are placed on it still. */
  .reel__inner {
    position: relative;
    min-height: inherit;
    display: grid;
    grid-template: auto minmax(var(--space-6), 1fr) auto / minmax(0, 1fr);
    padding: var(--space-10) var(--_gutter) 0;
    isolation: isolate;
    /* Corner's words take 56% of the reel's width (`cqw`, below). */
    container-type: inline-size;
  }

  /* ── the top: the org, its facts and Follow ── */
  .reel__top {
    grid-area: 1 / 1 / 2 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .reel__sig,
  .reel__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .reel__sig img {
    height: var(--space-10);
    width: auto;
  }

  /* A failed logo keeps its box, unseen: dropped, the bar would lose its
     height and the name its place after the first paint. */
  .reel__sig {
    position: relative;
  }

  .reel__sig img[data-failed] {
    visibility: hidden;
  }

  /* The name standing in for a failed logo that led alone: over the logo's
     place, centred on its box, out of flow so nothing moves when it shows.
     Its own width, held by the name's measure where one applies (a phone's). */
  .reel__stand-in {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0;
    inline-size: max-content;
    translate: 0 -50%;
  }

  .reel__name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-normal);
    color: var(--_ink);
  }

  .reel__meta {
    font-size: var(--text-sm);
    color: var(--_ink-soft);
  }

  /* The 'shadow' edge (the default; owner, 2026-11-20): no outline, a soft
     glow round every word in the brand's own dark (a light brand's pale
     ground), blurred all through, at its group's strongest need (`--_glow`).
     It lays a share of that on the ground touching the glyphs (GLOW_SHARE,
     from the 1 px ring probe), and the shades grow only for the rest. */
  .reel[data-edge='shadow'] [data-ink] {
    --_g: color-mix(in srgb, var(--_scrim) calc(var(--_glow, var(--_pool)) * 100%), transparent);

    text-shadow:
      0 0 2px var(--_g),
      0 0 6px var(--_g),
      0 0 14px var(--_g);
  }

  /* The 'outline' edge (a creator's choice; owner, 2026-11-20): each word
     outlined in the brand's own dark (or a light brand's pale ground), close
     round its glyphs, never a box. Unblurred 1 px offsets all round and
     softened 2 px ones, at the group's solved strength (`--_halo`, set on
     each group, its strongest word's) taken up by 1.6, so the ring touching
     each stroke keeps the word's floor over any frame; then a soft glow. A
     word no scrim of the tint can carry is outlined in its own pole
     (`--_ring-tint`: red on a dark brand, pale) at its own strength. */
  .reel[data-edge='outline'] [data-ink] {
    --_h: var(--_halo, var(--_pool));
    --_h-ring: color-mix(
      in srgb,
      var(--_ring-tint, var(--_scrim)) calc(min(1, var(--_h) * 1.6) * 100%),
      transparent
    );
    --_h-soft: color-mix(
      in srgb,
      var(--_ring-tint, var(--_scrim)) calc(var(--_h) * var(--_soft, 1) * 100%),
      transparent
    );
    --_h-ring2: color-mix(
      in srgb,
      var(--_ring-tint, var(--_scrim)) calc(min(1, var(--_h) * 1.6) * var(--_ring2, 0) * 100%),
      transparent
    );

    text-shadow:
      1px 0 0 var(--_h-ring),
      -1px 0 0 var(--_h-ring),
      0 1px 0 var(--_h-ring),
      0 -1px 0 var(--_h-ring),
      1px 1px 0 var(--_h-ring),
      -1px -1px 0 var(--_h-ring),
      1px -1px 0 var(--_h-ring),
      -1px 1px 0 var(--_h-ring),
      2px 0 1px var(--_h-ring),
      -2px 0 1px var(--_h-ring),
      0 2px 1px var(--_h-ring),
      0 -2px 1px var(--_h-ring),
      2px 2px 0 var(--_h-ring2),
      -2px -2px 0 var(--_h-ring2),
      2px -2px 0 var(--_h-ring2),
      -2px 2px 0 var(--_h-ring2),
      2px 0 0 var(--_h-ring2),
      -2px 0 0 var(--_h-ring2),
      0 2px 0 var(--_h-ring2),
      0 -2px 0 var(--_h-ring2),
      0 0 6px var(--_h-soft),
      0 0 14px var(--_h-soft);
  }

  .reel__ghost,
  .reel__round {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width) solid var(--_line);
    /* Glass, solved: at least the glass's own shade, and as much as the
       label or icon still needs over the shades under it (`--_halo`). */
    background: color-mix(
      in srgb,
      var(--_scrim) calc(max(var(--_glass-a), var(--_halo, var(--_pool))) * 100%),
      transparent
    );
    color: var(--_ink);
    backdrop-filter: blur(var(--blur-md));
    cursor: pointer;
    text-decoration: none;
  }

  .reel__ghost {
    white-space: nowrap;
    min-height: var(--space-9);
    padding: 0 var(--space-4);
    border-radius: var(--radius-button);
    font-size: var(--text-sm);
  }

  .reel__round {
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-full);
  }

  .reel__round svg {
    width: var(--space-3-5);
    height: var(--space-3-5);
  }

  /* R14's ring, on keyboard focus only. A row of the index or strip, and the
     "All" link, have no inline padding (their words sit on the box's edges),
     so their ring stands further off and rounds, clear of "01" and "Film". */
  .reel__ghost:focus-visible,
  .reel__round:focus-visible,
  .reel__btn:focus-visible,
  .reel__item:focus-visible,
  .reel__all:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    /* Its own band of the solid scrim under the ring and a little past it:
       a two-tone indicator, so the ring keeps 3:1 over any frame. */
    box-shadow: 0 0 0 calc(var(--space-0-5) + var(--border-width-thick) + var(--space-0-5)) var(--_scrim);
  }

  .reel__item:focus-visible,
  .reel__all:focus-visible {
    outline-offset: var(--space-1-5);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 calc(var(--space-1-5) + var(--border-width-thick) + var(--space-0-5)) var(--_scrim);
  }

  /* ── what is playing: the words over their pieces' sizers, at the foot ── */
  .reel__slot {
    grid-area: 3 / 1;
    align-self: end;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    margin-bottom: calc(var(--space-24) + var(--space-4));
  }

  .reel__slot > *,
  .reel__sizers > * {
    grid-area: 1 / 1;
    align-self: end;
  }

  .reel__sizers {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    visibility: hidden;
  }

  /* A sizer's title is no heading: it takes what the words' h2 has as one,
     the reel's heading margin (`.reel h2`) and base.css's tracking, so its
     box is the words' title's. */
  .reel__sizer .reel__title {
    margin: 0;
    letter-spacing: var(--tracking-tight);
  }

  /* Wide's sizers hold the title, on its one line, at the most its fit sets
     (`--_wide-max`, WIDE_TITLE.max) or at the size it paints before the fit,
     the larger: the slot is one height from the first paint through every
     fit, so a short screen's hero never grows when the fit lands (review r5
     S5: 17-21 px). */
  @media (--breakpoint-md) {
    .reel[data-layout='wide'] .reel__sizer .reel__title {
      --_size: max(var(--_wide-max), calc(var(--text-display) * 1.6));
    }
  }

  /* A sizer's preview: the preview button's box (`.reel__ghost`, at
     `.reel__preview`'s height), without the classes the fit reads. */
  .reel__sizer-preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--space-12);
    padding: 0 var(--space-4);
    border: var(--border-width) solid transparent;
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .reel__kicker {
    /* Not the page's 65ch prose measure: it is centred in the Name window. */
    max-width: none;
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    font-size: var(--text-base);
    color: var(--_ink-soft);
  }

  .reel__kicker b {
    font-weight: var(--font-normal);
    font-variant-numeric: tabular-nums;
    color: var(--_ink);
  }

  /* Each title's own size is `--_size`. On a short screen Wide's big type
     takes its cap (`--_cap`, the owner's floor, 2026-11-22), never more: CSS,
     so the server's paint is the fitted one. With no cap (Corner, whose index
     holds a short screen's hero whatever its title's size), its own size. */
  .reel__title {
    --_size: calc(var(--text-display) * 1.3);
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: min(var(--_size), var(--_cap, var(--_size)));
    line-height: var(--leading-none);
    color: var(--_ink);
    text-wrap: balance;
  }

  .reel__title[data-long] {
    --_size: calc(var(--text-display) * 1.1);
  }

  .reel__title--line {
    max-width: 52ch;
    margin-inline: auto;
    --_size: var(--text-2xl);
    line-height: var(--leading-relaxed);
  }

  .reel__row {
    margin-top: var(--space-5);
  }

  .reel__line {
    max-width: 54ch;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--_ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .reel__acts {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-8);
  }

  .reel__preview {
    min-height: var(--space-12);
  }

  /* ── the theatre's room: the words and the index step aside (the mock's) ── */
  .reel__inner,
  .reel__scrim-top,
  .reel__scrim-foot {
    transition: opacity var(--duration-slow) var(--ease-out);
  }

  .reel[data-theatre] .reel__inner,
  .reel[data-theatre] .reel__scrim-top {
    opacity: 0;
  }

  .reel[data-theatre] .reel__scrim-foot {
    opacity: 0.45;
  }

  .reel__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2-5);
    min-height: var(--space-12);
    padding: 0 var(--space-6);
    border: none;
    border-radius: var(--radius-button);
    background: var(--color-interactive);
    color: var(--color-on-interactive);
    font-size: var(--text-lg);
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
  }

  /* out, cut, in */
  .reel__words[data-swap='out'] .reel__swap {
    opacity: 0;
    transform: translateY(var(--space-1-5));
    transition:
      opacity var(--duration-normal) var(--ease-in),
      transform var(--duration-normal) var(--ease-in);
  }

  .reel__words[data-swap='in'] .reel__swap {
    animation: reel-rise var(--duration-slower) var(--ease-out) both;
  }

  .reel__words[data-swap='in'] .reel__swap:nth-child(2) {
    animation-delay: calc(var(--duration-fast) / 2);
  }

  .reel__words[data-swap='in'] .reel__swap:nth-child(3) {
    animation-delay: var(--duration-fast);
  }

  @keyframes reel-rise {
    from {
      opacity: 0;
      transform: translateY(var(--space-3));
    }
  }

  /* ── the pause: first in the tab order, drawn where each layout keeps it ──
     Wide and Name: at the strip's end, in the column the strip keeps for it
     (its ::after), so the strip's pool covers it as before. Above the reel's
     other words, so nothing laid over its place takes its press. */
  .reel__ctl {
    position: relative;
    z-index: 1;
    grid-area: 3 / 1;
    justify-self: end;
    align-self: end;
    margin-bottom: var(--space-9);
  }

  /* ── Corner: the index on the right, the pause atop it ──
     The pause and the index share one grid cell: the index keeps the pause's
     room at its top, so its pool covers both, as when the pause sat inside it.
     The words span the room above as well as the foot's row, so the index
     alone sizes that row and the pause stays at its top. */
  .reel[data-layout='corner'] .reel__inner {
    grid-template: auto minmax(var(--space-6), 1fr) auto / minmax(0, 1fr) var(--container-drawer);
    padding-bottom: var(--space-20);
  }

  .reel[data-layout='corner'] .reel__slot {
    grid-area: 2 / 1 / 4 / 2;
    /* 56% of the reel's width (its gutters with the inner's content box),
       and never into the index's column. */
    width: min(var(--container-content), calc((100cqw + 2 * var(--_gutter)) * 0.56), 100%);
    margin: var(--space-6) 0 0;
  }

  .reel[data-layout='corner'] .reel__ctl,
  .reel__index {
    grid-area: 3 / 2;
  }

  .reel[data-layout='corner'] .reel__ctl {
    align-self: start;
    margin-bottom: 0;
  }

  .reel__index {
    padding-top: calc(var(--space-9) + var(--space-3-5));
  }

  .reel__index .reel__item {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-9) minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) 0;
    border: none;
    border-top: var(--border-width) solid var(--_line);
    background: none;
    color: var(--_ink-soft);
    font-size: var(--text-base);
    text-align: start;
    cursor: pointer;
  }

  .reel__index li:last-child .reel__item {
    border-bottom: var(--border-width) solid var(--_line);
  }

  .reel__item[aria-current] {
    color: var(--_ink);
  }

  .reel__n,
  .reel__k {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .reel__t {
    font-family: var(--font-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reel__bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--space-0-5);
    overflow: hidden;
  }

  /* A piece's progress: the index's and strip's bars, the phone's segments. */
  .reel__bar i,
  .reel__segs li i {
    display: block;
    height: 100%;
    background: var(--_ink);
    transform: scaleX(0);
    transform-origin: left;
  }

  [aria-current] > .reel__bar i {
    transform: scaleX(var(--_progress));
  }

  .reel__all {
    display: inline-block;
    margin-top: var(--space-3-5);
    font-size: var(--text-sm);
    color: var(--_ink);
  }

  /* ── Wide and Name: the strip along the foot ── */
  .reel__strip {
    grid-area: 3 / 1;
    align-self: end;
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-5);
    align-items: end;
  }

  /* Where the pause stands too. On the inner's own: `.reel ol`'s margin
     reset outranks the strip's class. */
  .reel__inner > .reel__strip {
    margin-bottom: var(--space-9);
  }

  /* The pause's column, the strip's last (the pause is drawn over it). */
  .reel__strip::after {
    content: '';
  }

  .reel__strip .reel__item {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2-5);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) 0 0;
    border: none;
    background: none;
    color: var(--_ink-soft);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
  }

  .reel__strip .reel__bar {
    top: 0;
    bottom: auto;
    background: var(--_line);
  }

  .reel[data-layout='wide'] .reel__title {
    --_size: calc(var(--text-display) * 1.6);
    white-space: nowrap;
  }

  /* The owner's floor (2026-11-22): on a short screen Wide's title, and so
     its sizers and the slot, takes what the hero's least height leaves it
     (`--_cap`), never under the floor. The rest of the hero, beside the title
     (the bar, the kicker, the line and buttons, the strip and the margins),
     is the floor sweep's on OBB: 304 px from 1280 up, and 335 below, where
     the bar wraps at 844. A brand whose rest is taller grows the hero a
     little past the screen; nothing is clipped, the parts are in flow. A
     phone's title is under the floor and keeps its size. */
  @media (--breakpoint-md) {
    .reel[data-layout='wide'] {
      --_cap: max(var(--_type-floor), calc(var(--_room) - 335px));
    }
  }

  @media (--breakpoint-xl) {
    .reel[data-layout='wide'] {
      --_cap: max(var(--_type-floor), calc(var(--_room) - 304px));
    }
  }

  .reel[data-layout='wide'] .reel__row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-12);
  }

  .reel[data-layout='wide'] .reel__line {
    max-width: 46ch;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .reel[data-layout='wide'] .reel__acts {
    margin-top: 0;
    flex: none;
  }

  /* ── Name window: the name is the window; the piece beneath ── */
  .reel__window {
    /* Its own size, before the fit sets the name's (`nameFit`). */
    --_name-size: calc(var(--text-display) * 2.8);
    position: absolute;
    left: var(--_gutter);
    right: var(--_gutter);
    top: 36%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--_name-size);
    line-height: var(--leading-none);
    text-align: center;
    /* The canvas draws the letters as the film's window; without it (no
       WebGL2, a lost context, before hydration) the still shows through them. */
    color: transparent;
    background-image: var(--_still, none);
    background-size: cover;
    background-position: center;
    background-clip: text;
    -webkit-background-clip: text;
  }

  /* With no still to show through, the name is drawn in ink. */
  .reel__window:not([data-still]) {
    color: var(--_ink);
  }

  /* The owner's floor (2026-11-22). On a screen too short for the name to
     sit clear at its place, CSS puts the window in flow: it fills the room
     between the top bar and the words (the inner's second row), with the
     name set at the floor (`--_type-floor`), so the hero grows only where
     the room holds less than the name at the floor. The fit then sets the
     name as large as that box lets it be, and holds the box at what CSS drew
     (`nameBox`): nothing moves when the page hydrates.

     The heights are where OBB's name stops sitting clear at its place on
     HEAD, by width band and peek (the floor sweep, 2026-11-22): in flow
     there and below, at its place above. They differ with a brand's density
     and an org's words; where they are off, the fit still keeps the name out
     of the bar and the words (`roomAt`). */
  @media (--below-md) and (max-height: 601px),
    (--breakpoint-md) and (max-width: 79.9375rem) and (max-height: 705px),
    (--breakpoint-xl) and (max-height: 822px) {
    .reel:not([data-peek]) .reel__window {
      --_name-size: var(--_type-floor);
      position: relative;
      inset: auto;
      transform: none;
      grid-area: 2 / 1;
      margin-block: var(--space-6);
    }
  }

  @media (--below-md) and (max-height: 713px),
    (--breakpoint-md) and (max-width: 79.9375rem) and (max-height: 833px),
    (--breakpoint-xl) and (max-height: 862px) {
    .reel[data-peek] .reel__window {
      --_name-size: var(--_type-floor);
      position: relative;
      inset: auto;
      transform: none;
      grid-area: 2 / 1;
      margin-block: var(--space-6);
    }
  }

  /* The canvas draws the name while the page is at the top. Its letters hold
     still with the film, so they go over the first NAME_FADE_PX of scroll
     (`--_name-fade-px`, on the root from the first paint), and the page's own glyphs take the name
     back over the same span (owner, 2026-11-21): a scroll-driven animation,
     in step with the scroll; elsewhere the hook's `--_ink-back`, a frame late. */
  :global(.org-layout:has(> .shader-hero--fullpage[data-film])) .reel__window {
    color: color-mix(in srgb, var(--_ink) calc(var(--_ink-back, 0) * 100%), transparent);
    background-image: none;
  }

  @supports (animation-timeline: scroll()) and (animation-range: 0 32px) {
    :global(.org-layout:has(> .shader-hero--fullpage[data-film])) .reel__window {
      color: transparent;
      animation: reel-ink-back linear both;
      animation-timeline: scroll(root block);
      animation-range: 0 var(--_name-fade-px, 32px);
    }
  }

  @keyframes reel-ink-back {
    to {
      color: var(--_ink);
    }
  }

  .reel[data-layout='name'] .reel__slot {
    text-align: center;
  }

  .reel[data-layout='name'] .reel__kicker,
  .reel[data-layout='name'] .reel__acts {
    justify-content: center;
  }

  .reel[data-layout='name'] .reel__title {
    --_size: var(--text-5xl);
  }

  .reel[data-layout='name'] .reel__title--line {
    --_size: var(--text-xl);
  }

  .reel[data-layout='name'] .reel__line {
    display: none;
  }

  .reel[data-layout='name'] .reel__acts {
    margin-top: var(--space-6);
  }

  /* ── the phone's story segments (hidden on a desktop) ── */
  .reel__segs {
    display: none;
  }

  .reel__segs ol {
    display: flex;
    flex: 1;
    gap: var(--space-1);
  }

  .reel__segs li {
    flex: 1;
    height: var(--space-0-5);
    border-radius: var(--radius-full);
    background: var(--_line);
    overflow: hidden;
  }

  .reel__segs li[data-done] i {
    transform: none;
  }

  .reel__segs li[data-on] i {
    transform: scaleX(var(--_progress));
  }

  @media (--below-md) {
    .reel {
      --_gutter: var(--space-4);
    }

    .reel[data-peek] {
      --_lift: calc(var(--space-32) + var(--space-1));
    }

    .reel__segs {
      position: absolute;
      top: var(--space-3);
      left: var(--_gutter);
      right: var(--_gutter);
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    /* The pause's place, top right, which the segments' pool covers. */
    .reel__segs::after {
      content: '';
      flex: none;
      width: var(--space-9);
      height: var(--space-9);
    }

    /* One column; the top bar under the segments. */
    .reel__inner,
    .reel[data-layout='corner'] .reel__inner {
      grid-template: auto minmax(var(--space-6), 1fr) auto / minmax(0, 1fr);
      padding: calc(var(--space-12) + var(--space-2)) var(--_gutter) 0;
    }

    /* Placed on the inner, out of the grid's cells: a grid area would hold
       it instead (Corner's pause sat at the foot's right, under the words). */
    .reel__ctl,
    .reel[data-layout='corner'] .reel__ctl {
      position: absolute;
      grid-area: auto;
      top: var(--space-3);
      right: var(--_gutter);
      margin: 0;
    }

    /* The mock's phone: the org, its segments and pause; Follow and the
       org's action wait for the page below. */
    .reel__meta {
      display: none;
    }

    /* The org's name in balanced lines no longer than 7em (WP-5a,
       2026-11-22): on one line it reached past what the header's left shade
       carries (OBB's, 0.15-0.66 of a 390 reel, 3.2-4.3:1); wrapped, it sits
       near its corner. A word longer than the measure keeps its own width
       (the least wins over the most); one longer than any phone's bar
       (`data-long-word`) takes a step down and breaks where it must. */
    .reel__name {
      max-inline-size: 7em;
      min-inline-size: min-content;
      text-wrap: balance;
    }

    .reel__name[data-long-word] {
      min-inline-size: 0;
      font-size: var(--text-lg);
      overflow-wrap: anywhere;
    }

    .reel__index,
    .reel__strip {
      display: none;
    }

    .reel__slot,
    .reel[data-layout='corner'] .reel__slot {
      grid-area: 3 / 1;
      width: auto;
      /* Clear of the app's tab bar (`.org-main`'s own bottom padding). */
      margin: 0 0 calc(var(--space-20) + var(--space-2));
    }

    .reel__title {
      --_size: calc(var(--text-display) * 0.9);
    }

    .reel__title[data-long] {
      --_size: calc(var(--text-display) * 0.78);
    }

    .reel[data-layout='wide'] .reel__title {
      --_size: calc(var(--text-display) * 1.13);
      white-space: normal;
    }

    .reel[data-layout='wide'] .reel__row {
      display: block;
    }

    .reel[data-layout='name'] .reel__title {
      --_size: calc(var(--text-display) * 0.6);
    }

    .reel__title--line,
    .reel[data-layout='name'] .reel__title--line {
      --_size: var(--text-lg);
    }

    .reel__line {
      font-size: var(--text-base);
    }

    .reel__acts {
      margin-top: var(--space-5);
    }

    .reel__btn {
      flex: 1;
      justify-content: center;
      font-size: var(--text-base);
    }

    /* The mock's: on a phone the preview is its icon, named for the ear. */
    .reel__preview,
    .reel__sizer-preview {
      width: var(--space-12);
      padding: 0;
    }

    .reel__preview-label {
      display: none;
    }

    .reel__window {
      --_name-size: calc(var(--text-display) * 3.1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reel__words .reel__swap {
      animation: none;
      transition: none;
    }
  }
</style>
