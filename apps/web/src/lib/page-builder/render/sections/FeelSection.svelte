<!--
  @component FeelSection

  What a practice FEELS like, and what is inside it (SPEC §4.1 `feel`).

  ── THE AXES THIS SECTION CONSUMES: EIGHT ──────────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion`. Every
  layout / rhythm / type-scale / edge / surface / motion decision reads a `--jp-*`
  property that `render/SectionRenderer.svelte` resolves onto the `.jp-sec`
  wrapper as a `data-jp-*` attribute. COLOUR STAYS `--color-*` (contract A11);
  the one exception is the `--jp-accent-*` family.

  ── AND EIGHT DESIGN LANGUAGES, NOT EIGHT PERMUTATIONS ─────────────────────
  The eight presets are permutations of those axes, but each one is a NAMED
  research family with a falsifiable TELL (§1 of the research doc, restated per
  preset in §4). A section that only reads the axis tokens gets the permutation
  and not the language: it comes out generic on seven looks and cinematic on one,
  which is measurably what happened — candlelit's tell was implemented 4-28x more
  densely than any sibling's across the tree.

  So the seven other looks are addressed HERE, by name, each through the axis
  value that identifies it. The map, and it is the reason every rule below is
  keyed the way it is:

    plain-facts   `edge: offset`      UNIQUE   radius 0 · 2px rules · mono labels
    syllabus      `accent: edge`      UNIQUE   left stripe not a badge · mono numerals
                  `type: restrained`  UNIQUE   one dense type step
    quiet-studio  `accent: none`      UNIQUE   three type sizes · no accent colour
                  `density: vast`     UNIQUE   more empty space than content
    open-air      `edge: soft`        UNIQUE   no border anywhere · pill rows
                  `surface: tint`     UNIQUE   a shadow you have to look for
    full-send     `surface: invert`   UNIQUE   whole bands · pill rows · big numerals
                  `motion: stagger`   UNIQUE   spring easing
    long-read     `surface: bare` + `type: balanced`  (long-read ONLY — quiet-studio
                  is the other `bare` look and it is `monumental`)
                  a hairline under every head · a flat page, not a card
    signal        `surface: panel` + `type: balanced` (signal ONLY — the other two
                  `panel` looks are `monumental` and `restrained`)
                  rounded cards · hairlines · one small neutral shadow

  ── WHY CANDLELIT IS UNTOUCHED, AS ARITHMETIC ──────────────────────────────
  Candlelit is `surface: media` · `edge: none` · `accent: glow` · `media: bleed`,
  and those four identify it alone. Its other five values are SHARED —
  `type: monumental`, `align: center`, `density: airy`, `width: text`,
  `motion: drift` — so a bare rule on any of THOSE restyles the one look that
  already works.

  THE RULE EVERY BLOCK BELOW OBEYS: a selector is candlelit-safe if and only if it
  requires an axis value candlelit does not have. Every look-specific rule in this
  file requires one of `surface: bare|tint|panel|invert`, `edge: hairline|soft|
  heavy|offset`, `accent: none|text|fill|edge`, `type: balanced|restrained` or
  `motion: none|stagger`. Candlelit has none of those nine values, so none of those
  rules can match it — checkable by reading the selectors, not by trusting this
  paragraph.

  `media` is DELIBERATELY unconsumed, and it STAYS unconsumed now that playback is
  real. Research §2.2 names the five types where the axis is meaningful — `hero`,
  `introVideo`, `reel`, `guide`, `proof` — and says the rest "ignore it, exactly as
  they ignore a variant they do not offer."

  The note here used to say the axis would become this section's ninth "if
  `Codex-scab9` ever wires real playback". It is now wired — the taste plays
  `context.sellPreview.reel`'s 30s public manifest through the same
  `createHlsPlayer` handle `IntroVideoModal` and `AudioPlayer` use — and the axis
  still has nothing to shape, because this section's clip has no VISIBLE box: the
  element is an off-layout `<video>` carrying the SOUND, and the waveform is the
  picture. `--jp-media-*` are an aspect ratio, a frame treatment and a bleed; a
  1px sound source has none of them, so claiming nine would still mean inventing a
  consumer (contract A50). What WOULD make this section media-aware is giving the
  clip a frame of its own — and that composition already exists as `reel`.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `paired` (default) · `column` · `statement` · `grid` · `ledger` · `stack`.
  `paired` is the arrangement this component has always drawn (the retired prose
  `twocol`); `column` absorbs the retired `centered` + `wide` (they were `align` +
  `width`); both are ported from the since-deleted canvas partial
  `render-edit/journey-sections/_prose.css` (contract A12). `grid`, `ledger` and
  `stack` are new (research §3).

  All four of `paired` / `grid` / `ledger` / `stack` arrange `inclusions[]`, and
  `statement` runs them on as a quiet inline list. With that array empty EVERY
  composition degrades to the copy alone — the list self-hides rather than
  rendering an empty container. That matters today, because `inclusions[]` is a
  `repeater` field with no editor UI yet (contract A29), so no page can hold one.

  COMPOSITIONS CARRY ARRANGEMENT, NEVER TYPE SCALE. `statement` is "oversized"
  through a tight measure and extra rhythm, not a larger `font-size`. The section
  `<h2>` is `--jp-heading-size` via `.jp-sec__heading--sub`, never `--jp-display`
  (contract A36).

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): a fully-legible layout — all copy, the
    waveform drawn at rest, the inclusion list complete. This is what the server
    emits, so the section is never blank and never JS-gated. The bars are computed
    deterministically (pure, SSR-safe) so they paint identically on both sides.
    THE TRANSPORT IS NOT IN THE BASELINE, and that is the point: play/pause/mute
    only exist once the component has mounted, because they only WORK once it has.
    A play button served to a no-JS client is the same broken promise the mock was.
  • ENHANCED (browser + motion OK): blocks arrive on the `motion` axis's timing,
    the free-taste player breathes as an equaliser, and the playhead tracks the
    clip's own `timeupdate`.

  ── THE FREE TASTE PLAYS THE REAL CLIP (`Codex-scab9`) ─────────────────────
  It did not. `playing` was a boolean, `elapsed` was advanced by a rAF accumulator
  against an invented 8-minute duration, and there was no media element anywhere in
  the file — `context` was not even destructured, so the section COULD NOT have
  read `sellPreview` by accident. A visitor pressed play on the most
  conversion-critical page in the product, watched a clock run and a waveform move,
  and heard nothing; and because the rAF effect bailed on `!enhanced`, a
  reduced-motion visitor got a button that reported `aria-pressed="true"` while the
  clock never moved at all. Two failures, one control.

  Now: `previewTitle` is the AUTHOR's switch and `context.sellPreview.reel` is the
  FACT, and BOTH are required. With a title and no clip the transport does not
  render — mirroring `ReelSection`, which deleted its own `reel__play--empty` glyph
  for the same reason. No second player was written: the manifest goes to
  `createHlsPlayer` (`$lib/components/VideoPlayer/hls`), the same factory behind
  `IntroVideoModal` (which `ReelSection` mounts) and `AudioPlayer`.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import {
    PauseIcon,
    PlayIcon,
    Volume2Icon,
    VolumeXIcon,
  } from '$lib/components/ui/Icon';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import { aliasKeys, asObjectArray, asString, asStringFrom, fieldString } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type {
    FeelSectionProps,
    FeelInclusion,
    JourneySalesContext,
    PreviewMedia,
  } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';
  import type Hls from 'hls.js';

  interface Props {
    config: SectionProps;
    /**
     * Read for ONE thing: `context.sellPreview`, the streamed 30s public preview
     * this section's free taste plays. It used to be annotated "unused by this
     * section" and was not destructured at all, which is what made the transport a
     * mock rather than merely unwired (`Codex-scab9`).
     */
    context: JourneySalesContext;
    variant?: string;
    /**
     * READ, and for ONE reason: a Svelte-scoped style block cannot reach the
     * ANCESTOR `data-jp-*` attributes `SectionFrame` emits on `.jp-sec`, so a
     * rule that must fire for one design language and not another has to key on
     * an attribute THIS component owns. `ProofSection` (`data-motion`) and
     * `InviteSection` (`data-motion`, `data-plated`) established the pattern;
     * this file needs the same seam for six axes rather than one.
     *
     * The axes still land in CSS. Nothing here changes what is RENDERED except
     * the motion gate on the equaliser, which was a real defect (see `motionOk`).
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, context, variant, design, editable = false, onEdit }: Props =
    $props();

  // ══════════════════════════════════════════════════════════════════════════
  //  THE AXIS MIRRORS — six attributes this component puts on its OWN root.
  //
  //  WHY THEY EXIST: `SectionFrame` writes `data-jp-*` on `.jp-sec`, the
  //  ANCESTOR. Svelte's CSS scoping rewrites every selector to require a class it
  //  emitted onto a node in THIS file, so `[data-jp-edge='offset'] .feel` cannot
  //  match — the attribute sits on an element this component does not own. Two
  //  sibling sections already carry this exact seam and say so in their comments.
  //
  //  WHY SIX AND NOT NINE: `align` and `width` need no mirror, because every rule
  //  that reads them reads `--jp-align` / `--jp-text-align` / `--jp-measure` —
  //  inherited custom properties, which cross the scoping boundary fine. `media`
  //  stays deliberately unconsumed (see the header).
  //
  //  `undefined` when `design` is absent, which Svelte renders as NO ATTRIBUTE —
  //  so a section with no resolved design draws exactly what it drew before
  //  rather than inheriting a guessed look.
  // ══════════════════════════════════════════════════════════════════════════
  const axSurface = $derived(design?.surface);
  const axEdge = $derived(design?.edge);
  const axAccent = $derived(design?.accent);
  const axType = $derived(design?.type);
  const axMotion = $derived(design?.motion);
  const axDensity = $derived(design?.density);

  /**
   * A MEASURED DEFECT THIS PASS FIXES. `.feel-wave.is-playing i` animates
   * `feel-eq` at `var(--d, 1.1s)` — a LOCAL per-bar duration, not
   * `--jp-reveal-duration` — so the equaliser danced at `motion: none`, on both
   * looks that explicitly ask for stillness (`plain-facts`, `syllabus`). The
   * pulse ring escaped it only because ITS duration is derived from
   * `--jp-reveal-duration`, which is `0ms` there.
   *
   * `reduced` (the OS preference) was already handled, and the shared
   * `.jp-sec *` reduced-motion block kills the keyframes outright. Neither
   * reaches a creator who CHOSE `motion: none` — a stated preference, not a
   * system one, which is contract A40's distinction.
   *
   * Candlelit is `motion: drift`, so this predicate is `true` there and the
   * equaliser is byte-identical on the one look that already works.
   */
  const motionOk = $derived(axMotion !== 'none');

  const p: FeelSectionProps = $derived({
    /**
     * THE `Codex-tqr51` LOSS THIS SECTION WAS CARRYING. This read was
     * `asString(config, 'eyebrow')` while the builder writes `kicker`, and
     * `coerce.ts` has declared `feel: { eyebrow: ['eyebrow', 'kicker'] }` the
     * whole time with nothing consuming it — the alias table existed and this
     * file imported no `asStringFrom` at all. Measured before the fix:
     * `.feel__eyebrow` was ABSENT from the served HTML in all six org × theme
     * combinations, including the golden page, which stores
     * `kicker: "What to expect"`. `turn` never showed the defect because it has
     * always read through the table; this is the same shape copied across.
     */
    eyebrow: asStringFrom(config, aliasKeys('feel', 'eyebrow')),
    heading: asStringFrom(config, aliasKeys('feel', 'heading')),
    body: asStringFrom(config, aliasKeys('feel', 'body')),
    inclusions: asObjectArray<FeelInclusion>(config, 'inclusions', (entry) => {
      const label = fieldString(entry, 'label');
      if (!label) return null;
      return { label, detail: fieldString(entry, 'detail') };
    }),
  });

  // ── The optional free-taste player. `previewTitle` is the AUTHOR's switch and
  //    `context.sellPreview.reel` is the FACT; both are required, so `hasPlayer`
  //    alone no longer decides anything visible (see the `{#await}` in markup).
  //    `previewDuration` stays a DEFENSIVE numeric read because its `number`
  //    control has no editor UI yet (contract A29) and the text fallthrough writes
  //    a string like "480", which must not be trusted.
  const previewTitle = $derived(asString(config, 'previewTitle'));
  const previewSub = $derived(asString(config, 'previewSub'));

  /**
   * The authored runtime, or `undefined`. IT NO LONGER DEFAULTS TO 480.
   *
   * The 8-minute default was the loudest part of the mock: a page that authored no
   * duration published a clock counting towards `8:00` on a clip that is thirty
   * seconds long. With nothing authored the total is now taken from the clip, and
   * with nothing known the total is not printed at all — an elapsed reading with no
   * total is honest, and "0:00 / 8:00" was not.
   */
  const authoredDuration = $derived.by(() => {
    const raw = config['previewDuration'];
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? raw
      : undefined;
  });
  const hasPlayer = $derived(previewTitle ? 'yes' : 'no');

  const inclusions = $derived(p.inclusions ?? []);

  /**
   * The SSR-CRITICAL half of the section: everything a crawler must see and
   * everything that cannot flicker. Deliberately excludes the player, because the
   * player's existence now depends on an awaited promise — see the bottom of the
   * markup for why the copy branch must not live inside an `{#await}`.
   */
  const hasText = $derived(
    !!(p.eyebrow || p.heading || p.body || inclusions.length > 0)
  );

  const COMPOSITIONS = [
    'paired',
    'column',
    'statement',
    'grid',
    'ledger',
    'stack',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'paired'
  );

  /**
   * How the inclusions are arranged. `paired` and `column` both draw the ember
   * spine timeline this section has always drawn; the other four are the new
   * arrangements. `'none'` when the array is empty, which is what makes every
   * composition degrade to copy-only rather than to an empty container.
   *
   * String discriminants, not booleans: `apps/web` has `strictNullChecks` OFF, so
   * a boolean-literal discriminant does not narrow.
   */
  const listMode = $derived.by(() => {
    if (inclusions.length === 0) return 'none';
    if (composition === 'paired' || composition === 'column') return 'timeline';
    if (composition === 'statement') return 'runon';
    return composition;
  });

  /** Only `paired` puts the copy and the list side by side. */
  const split = $derived(composition === 'paired' ? 'yes' : 'no');

  // ── Deterministic waveform — pure, so SSR and the client paint the same bars.
  //    Quiet at the ends, full through the middle, textured per-bar.
  const BAR_COUNT = 56;
  interface Bar {
    h: number;
    dur: number;
    delay: number;
  }
  const bars: Bar[] = (() => {
    const out: Bar[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i / (BAR_COUNT - 1);
      const env = 0.3 + 0.7 * Math.sin(Math.PI * x);
      const tex = 0.5 + 0.5 * Math.sin(i * 0.9) * Math.cos(i * 0.37);
      const h = Math.max(0.14, Math.min(1, env * (0.42 + 0.58 * Math.abs(tex))));
      out.push({
        h: Number((h * 100).toFixed(1)),
        dur: Number((0.85 + (i % 7) * 0.11).toFixed(2)),
        delay: Number(((i % 11) * 0.05).toFixed(2)),
      });
    }
    return out;
  })();

  let mounted = $state(false);
  let reduced = $state(false);

  // ══════════════════════════════════════════════════════════════════════════
  //  THE FREE-TASTE TRANSPORT — REAL PLAYBACK (`Codex-scab9`)
  //
  //  What was here: `playing` as a bare boolean, `elapsed` advanced by a rAF
  //  accumulator, and no media element. `elapsed` is now READ from the element's
  //  own `currentTime`, so the playhead cannot disagree with what is audible, and
  //  the rAF loop is gone — with it the reduced-motion failure, where the effect
  //  bailed on `!enhanced` and left a button reporting `aria-pressed="true"` while
  //  the clock stood still. `enhanced` now gates ANIMATION only, never state.
  // ══════════════════════════════════════════════════════════════════════════
  let mediaEl: HTMLVideoElement | undefined = $state();
  let playing = $state(false);
  let muted = $state(false);
  /** Seconds, read from `timeupdate`. Never advanced by this component. */
  let elapsed = $state(0);
  /** The element's OWN duration once `loadedmetadata` lands; 0 until then. */
  let metaDuration = $state(0);
  /**
   * A real playback failure, which HIDES the transport rather than leaving a
   * control that cannot do its job. Same rule as "no clip ⇒ no transport", applied
   * to "no playable clip" — and it matters here because the preview manifest is
   * known to 404 in production today (`Codex-1g5lh.13`: `hlsPreviewKey` lives in
   * the private media bucket while the public CDN host serves the assets bucket).
   * Until that is fixed, this is the branch most real visitors would hit.
   */
  let unplayable = $state(false);

  /** The HLS handle, exactly as `IntroVideoModal` holds it: `{ hls, cleanup }`. */
  let hlsInstance: Hls | null = null;
  let hlsCleanup: (() => void) | null = null;
  /** The manifest currently attached, so a second play does not rebuild it. */
  let attachedUrl: string | null = null;

  const enhanced = $derived(mounted && !reduced);

  /**
   * THE 30-SECOND CAP, AND IT IS SOMEONE ELSE'S BUG THIS SECTION MUST NOT INHERIT.
   *
   * `packages/access` `toClip()` builds the preview clip from `media.hlsPreviewKey`
   * — a fixed 30s rendition ("30s preview" in the schema; `create_preview` caps it
   * in the RunPod handler) — but reports `durationSeconds` from the SOURCE asset.
   * So a 30-minute intro yields `durationSeconds: 1800` on a clip that plays for
   * thirty seconds. Sizing a playhead off that number makes it crawl across 1.7% of
   * the bar and stop, which reads as a broken player rather than a finished clip.
   *
   * Capping is the local defence; the upstream fix is a handoff, not a licence to
   * trust the field. The element's own `loadedmetadata` duration outranks this the
   * moment it arrives, which is why the cap only ever governs the pre-play label.
   */
  const PREVIEW_CAP_SECONDS = 30;

  const clipDuration = (clip: PreviewMedia | null): number | undefined => {
    const raw = clip?.durationSeconds;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      return undefined;
    }
    return Math.min(raw, PREVIEW_CAP_SECONDS);
  };

  /**
   * The total the clock counts towards, in precedence order: the ELEMENT's own
   * duration (the only source that cannot be wrong), then the authored number,
   * then the clip's capped advisory figure. `0` ⇒ unknown, and an unknown total is
   * not printed.
   */
  const totalSeconds = (clip: PreviewMedia | null): number =>
    metaDuration > 0 ? metaDuration : (authoredDuration ?? clipDuration(clip) ?? 0);

  const fmt = (secs: number, total: number): string => {
    const ceiling = total > 0 ? total : secs;
    const s = Math.max(0, Math.min(ceiling, Math.round(secs)));
    const mins = Math.floor(s / 60);
    return `${mins}:${String(s % 60).padStart(2, '0')}`;
  };

  onMount(() => {
    mounted = true;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
      teardownHls();
    };
  });

  /**
   * BOTH HALVES OF THE HANDLE, and the reason is recorded in `IntroVideoModal`:
   * assigning `createHlsPlayer`'s handle straight to an `Hls`-typed variable made
   * `destroy is not a function` throw on every close, so `cleanup()` never ran and
   * each open leaked a player whose worker kept fetching segments. `cleanup` is a
   * no-op on the hls.js branch and a `removeEventListener` on the Safari native
   * branch, so both are needed.
   */
  function teardownHls() {
    if (hlsCleanup) {
      hlsCleanup();
      hlsCleanup = null;
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    attachedUrl = null;
  }

  /**
   * Attach the manifest LAZILY — on the first play, never on mount. This is a
   * public sales page: an unasked-for manifest plus its first segments on every
   * page load is bandwidth spent on a visitor who never pressed play, and
   * `preload="none"` on the element says the same thing to the native path.
   */
  async function attachClip(url: string): Promise<boolean> {
    if (!mediaEl) return false;
    if (attachedUrl === url) return true;
    teardownHls();
    try {
      const handle = await createHlsPlayer({
        media: mediaEl,
        src: url,
        onError: () => {
          unplayable = true;
          playing = false;
          teardownHls();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      attachedUrl = url;
      return true;
    } catch {
      unplayable = true;
      return false;
    }
  }

  /**
   * CLICK TO PLAY, and unmuted by default — which is only allowed BECAUSE it is a
   * click. Autoplay policy blocks unmuted playback without a user gesture, and
   * hover is not a gesture in this codebase, so the two constraints agree: the
   * only honest free taste is one the visitor asks for. A rejected `play()` leaves
   * the button in its resting state rather than claiming to be playing.
   */
  async function togglePlay(url: string) {
    if (!mediaEl) return;
    if (playing) {
      mediaEl.pause();
      return;
    }
    if (!(await attachClip(url))) return;
    mediaEl.muted = muted;
    try {
      await mediaEl.play();
    } catch {
      playing = false;
    }
  }

  function toggleMute() {
    muted = !muted;
    if (mediaEl) mediaEl.muted = muted;
  }

  /**
   * The props key an inline edit must write BACK to: the one the displayed value
   * was actually READ from, never the renderer's own prop name.
   *
   * This matters because the alias lists are ordered. A page that stores
   * `eyebrow` (the six seeded `ache` sections do) would, if an edit wrote
   * `kicker`, end up holding BOTH keys — and `eyebrow` wins the preference list,
   * so the creator's edit would render as nothing at all while the data silently
   * grew a second copy. The fallback is the key `section-fields.ts` writes, which
   * is what a page that holds neither should acquire.
   */
  const readKey = (keys: readonly string[], fallback: string): string => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim() !== '') return key;
    }
    return fallback;
  };

  /**
   * The shared `.jp-reveal[data-jp-step]` ladder stops at 5 and
   * `--jp-reveal-stagger` is calibrated for about that many block beats, so a
   * twelve-entry inclusion list clamps rather than taking seconds to assemble
   * (pilot lesson 5). This replaces the local `d1`/`d2` delay classes, which
   * hardcoded `80ms`/`160ms` and so ignored the `motion` axis entirely.
   */
  const step = (i: number): string => String(Math.min(i + 1, 5));

  /**
   * The studio canvas's inline-edit seam for one field, as a spreadable attribute
   * bag: `contenteditable`, spellcheck ON, `role="textbox"`, an accessible name
   * saying which field this is, and a paste that arrives as PLAIN TEXT.
   *
   * Built in ONE place (`../editable`) rather than here. It used to be eleven
   * byte-identical copies, which is exactly how the same three defects — no
   * spellcheck, no `onpaste`, no role or name — reached all eleven sections at once
   * and stayed there. That module's header carries the full reasoning, including
   * why this is an ATTRIBUTE BAG and not a Svelte action (actions do not run during
   * SSR, so the text has to be a real child node, not something filled in later).
   *
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having no
   * seam at all.
   */
  const editAttrs = (key: string): HTMLAttributes<HTMLElement> =>
    editFieldAttrs('feel', key, editable, onEdit);
</script>

<!--
  THE FREE TASTE. One snippet, and every control inside it is gated on `live` —
  `clip !== null && mounted && !unplayable` — so there is exactly ONE predicate
  deciding whether this block can do what it looks like it does. Three separate
  conditions at three call sites is how the old markup came to promise playback it
  did not have.

  WHAT SURVIVES WITHOUT `live`: the title, the sub-line and the waveform at rest.
  That is a still of the practice, which is honest. What does NOT survive: the
  play button, the mute toggle and the clock — the three things that would be
  lying.
-->
{#snippet taste(clip: PreviewMedia)}
  {@const total = totalSeconds(clip)}
  {@const live = mounted && !unplayable}
  {@const progress = total > 0 ? Math.min(Math.max(elapsed / total, 0), 1) : 0}
  {@const playedBars = live ? Math.round(progress * BAR_COUNT) : 0}
  {@const headPct = live ? progress * 100 : 0}
  <div class="feel__player jp-reveal" data-jp-step="3">
    <div
      class="feel-taste"
      role="group"
      aria-label={m.journey_feel_preview_label({ title: previewTitle })}
    >
      <div class="feel-taste__aura" aria-hidden="true"></div>
      {#if live}
        <!--
          THE CLIP ITSELF — a `<video>`, off-layout, carrying the SOUND.

          `<video>` and not `<audio>`, and the reason is mechanical: the manifest is
          a video rendition, hls.js appends video buffers through MSE, and an
          `<audio>` element's media source cannot accept them. (`AudioPlayer` uses
          `<audio>` with this same factory, correctly — its manifests are audio-only.)

          Off-layout rather than `display: none`, because a display-none media
          element is entitled to have its decode pipeline dropped, and the audio is
          the entire point. `aria-hidden` + `tabindex="-1"` keep it out of the
          accessibility tree and the tab order: the accessible transport is the
          button below, and two focus stops for one clip is a worse experience than
          one.

          `preload="none"`: nothing is fetched until the visitor presses play.
        -->
        <video
          bind:this={mediaEl}
          class="feel-taste__media"
          playsinline
          preload="none"
          tabindex="-1"
          aria-hidden="true"
          onplay={() => {
            playing = true;
          }}
          onpause={() => {
            playing = false;
          }}
          ontimeupdate={() => {
            elapsed = mediaEl?.currentTime ?? 0;
          }}
          onloadedmetadata={() => {
            const own = mediaEl?.duration;
            metaDuration =
              typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : 0;
          }}
          onended={() => {
            playing = false;
            elapsed = 0;
            if (mediaEl) mediaEl.currentTime = 0;
          }}
        ></video>
      {/if}
      <div class="feel-taste__head">
        {#if live}
          <button
            class="feel-play"
            class:is-playing={playing}
            type="button"
            aria-pressed={playing}
            aria-label={playing
              ? m.journey_feel_preview_pause()
              : m.journey_feel_preview_play()}
            onclick={() => togglePlay(clip.playlistUrl)}
          >
            <!-- `Icon/*Icon.svelte` via `IconBase`, not an inline `<svg>`
                 (contract A8). `IconBase` sets `aria-hidden` itself, and
                 the button carries the accessible name. -->
            {#if playing}
              <PauseIcon class="feel-play__glyph" />
            {:else}
              <PlayIcon class="feel-play__glyph" />
            {/if}
          </button>
        {/if}
        <div class="feel-taste__meta">
          <div class="feel-taste__title">{previewTitle}</div>
          {#if previewSub}
            <div class="feel-taste__sub">{previewSub}</div>
          {/if}
        </div>
        {#if live}
          <!-- The total is printed only when one is KNOWN. It used to be
               `fmt(480)` on every page that authored no duration — "0:00 / 8:00"
               over a thirty-second clip. -->
          <div class="feel-taste__time" aria-hidden="true">
            <span class="feel-cur">{fmt(elapsed, total)}</span>
            {#if total > 0}
              <span class="feel-sep">/</span>
              <span>{fmt(total, total)}</span>
            {/if}
          </div>
          <!-- A MUTE TOGGLE, NOT A VOLUME SLIDER. Playback starts unmuted because
               it starts from a click, and the one thing a visitor needs after that
               is a way to silence it without hunting for the pause button. -->
          <button
            class="feel-mute"
            type="button"
            aria-pressed={muted}
            aria-label={muted
              ? m.journey_feel_preview_unmute()
              : m.journey_feel_preview_mute()}
            onclick={toggleMute}
          >
            {#if muted}
              <VolumeXIcon class="feel-mute__glyph" />
            {:else}
              <Volume2Icon class="feel-mute__glyph" />
            {/if}
          </button>
        {/if}
      </div>

      <!--
        THE WAVEFORM IS DECORATION, AND IT NO LONGER PRETENDS OTHERWISE.
        It used to carry `role="presentation"`, `aria-hidden="true"` AND an
        `onclick` seek handler: a control with no keyboard path, no role, no name
        and no route into the accessibility tree.

        It stays decoration now that playback is real, because a synthetic
        56-bar envelope is not this clip's amplitude — it is the same deterministic
        function it always was. What changed is that the FILL and the PLAYHEAD are
        now driven by the element's own `currentTime`, so the decoration tracks
        something true. A real scrubber is a separate piece of work and wants a
        real `<input type="range">`; `AudioPlayer` already has one, against a
        real `waveform.json`.
      -->
      <div
        class="feel-wave"
        class:is-playing={playing && enhanced && motionOk}
        aria-hidden="true"
      >
        {#each bars as bar, i (i)}
          <i
            class:is-on={i < playedBars}
            style="--h: {bar.h}%; --d: {bar.dur}s; --delay: {bar.delay}s"
          ></i>
        {/each}
        <span class="feel-wave__head" style="left: {headPct}%"></span>
      </div>
    </div>
  </div>
{/snippet}

<!--
  BOTH CONDITIONS, IN ONE PLACE. `previewTitle` is the author's switch and the
  resolved `reel` is the fact. With a title and no clip NOTHING renders here —
  mirroring `ReelSection`, which deleted its `reel__play--empty` glyph and its
  `reel__rest-rail` for exactly this reason: "a play affordance and a transport
  that are not controls, cannot become controls, and are the exact shape of a
  broken player".

  NO PENDING PLACEHOLDER, deliberately. A resting transport drawn while the
  promise is in flight is indistinguishable from the mock this replaces, and it
  would have to VANISH on a course with no clip — a worse shift than the one it
  avoids. The copy above it is unaffected either way.
-->
{#snippet player()}
  {#if hasPlayer === 'yes'}
    {#await context.sellPreview then preview}
      {#if preview?.reel?.playlistUrl}
        {@render taste(preview.reel)}
      {/if}
    {/await}
  {/if}
{/snippet}

{#snippet shell()}
  <!--
    THE SIX AXIS MIRRORS. Every look-specific rule in this file keys on at least
    one of these, because the `data-jp-*` originals are on an ancestor a scoped
    style block cannot reach. See the block that declares them for why.
  -->
  <div
    class="feel"
    data-feel={composition}
    data-split={split}
    data-surface={axSurface}
    data-edge={axEdge}
    data-accent={axAccent}
    data-type={axType}
    data-motion={axMotion}
    data-density={axDensity}
  >
    <!-- ONE observer for the whole section, on the container: the shared atom is
         `.reveal--armed .jp-reveal` (a DESCENDANT selector) and the action adds
         `.reveal--armed` to the node it is used on. -->
    <div class="feel__inner" use:reveal={{ disabled: editable }}>
      <div class="feel__grid">
        <!-- what it feels like -->
        <div class="feel__col">
          {#if p.eyebrow || p.heading || p.body}
            <div class="feel__copy">
              {#if p.eyebrow}
                <p
                  class="jp-sec__eyebrow feel__eyebrow jp-reveal"
                  {...editAttrs(readKey(aliasKeys('feel', 'eyebrow'), 'kicker'))}
                >
                  {p.eyebrow}
                </p>
              {/if}
              {#if p.heading}
                <h2
                  class="jp-sec__heading jp-sec__heading--sub feel__heading jp-reveal"
                  data-jp-step="1"
                  {...editAttrs(readKey(aliasKeys('feel', 'heading'), 'heading'))}
                >
                  {p.heading}
                </h2>
              {/if}
              {#if p.body}
                <p
                  class="feel__body jp-reveal"
                  data-jp-step="2"
                  {...editAttrs(readKey(aliasKeys('feel', 'body'), 'body'))}
                >
                  {p.body}
                </p>
              {/if}
            </div>
          {/if}

          {@render player()}
        </div>

        <!-- what is inside -->
        {#if listMode !== 'none'}
          <div class="feel__col feel__col--inside">
            <ul class="feel-list" data-list={listMode}>
              {#each inclusions as inclusion, i (i)}
                <li class="feel-list__row jp-reveal" data-jp-step={step(i)}>
                  {#if listMode === 'timeline'}
                    <span class="feel-list__m" aria-hidden="true"></span>
                  {/if}
                  <span class="feel-list__lead">{inclusion.label}</span>
                  {#if inclusion.detail}
                    <span class="feel-list__sub">{inclusion.detail}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

<!--
  SELF-HIDE, THE WAY NINE OF THE ELEVEN SECTIONS ALREADY DO — and the copy branch
  is NOT inside the `{#await}`, deliberately. The eyebrow, heading, body and
  inclusion list are SEO-critical and paint immediately; putting them inside an
  await branch would destroy and re-create them when the promise resolved,
  re-running `use:reveal` and making the copy flash out and back in. That is
  `ReelSection`'s reasoning verbatim, and it applies unchanged here.

  The await wrapper is reached only when there is NO text — where there is nothing
  to flicker and nothing to index, and the section's whole existence depends on
  whether a clip turned up. Before this, a `feel` section holding a `previewTitle`
  and nothing else rendered its bordered box, its aura and a fake transport for a
  course with no preview clip at all.
-->
{#if hasText}
  {@render shell()}
{:else if hasPlayer === 'yes'}
  {#await context.sellPreview then preview}
    {#if preview?.reel?.playlistUrl}
      {@render shell()}
    {/if}
  {/await}
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX — every value an axis read.

     `--jp-sec-pad-block` / `--jp-sec-pad-inline` / `--jp-sec-gap` are the shared
     role aliases from `journey-design.css`. They contain `6cqw`, so they MUST be
     consumed on a DESCENDANT of `.jp-sec` — an element is not its own query
     container, and reading them on the wrapper resolves the `cqw` against the
     page rather than the section (pilot lesson 1). `.feel` is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .feel {
    position: relative;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);
  }

  .feel__inner {
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  .feel__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: calc(var(--jp-sec-gap) * 2);
    align-items: stretch;
    justify-items: var(--jp-align);
  }

  .feel__col {
    display: flex;
    flex-direction: column;
    width: 100%;
    align-items: var(--jp-align);
  }

  .feel__copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: var(--jp-align);
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  /* The eyebrow was `--color-brand-accent`, i.e. a raw brand token used as TEXT.
     It now takes the accent's TEXT role, which resolves to the AA-calibrated
     `--jp-ember-text` and never to `--jp-ember` (8.49:1 light but 2.04:1 DARK on
     the golden org). This is the first time this element has ever rendered — see
     the bridge note in the script — so the contrast figure is new, not a
     regression.

     Tracking: the shared atom defaults to `--tracking-wider` (0.05em); this
     section shipped a raw `.28em`, the widest of four different spellings in the
     tree, and `--tracking-wider` is the widest that has a token. */
  .feel__eyebrow {
    color: var(--jp-accent-text);
  }

  .feel__heading {
    margin: 0;
  }

  .feel__body {
    margin: 0;
    max-width: var(--jp-measure);
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ═══ COMPOSITIONS ═══════════════════════════════════════════════════════ */

  /* `paired` — copy and player on one side, the inclusions on the other. The
     near-50/50 split this section has always drawn. */
  @container (min-width: 54rem) {
    .feel[data-split='yes'] .feel__grid {
      grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
      gap: calc(var(--jp-sec-gap) * 2.7);
      /* Columns must FILL in split mode; `justify-items` from the `align` axis
         would otherwise shrink each column to its content width. */
      justify-items: stretch;
    }

    /* Pin the two blocks to the base of their columns so a tall column fills
       rather than leaving a void. */
    .feel[data-split='yes'] .feel__player,
    .feel[data-split='yes'] .feel__col--inside {
      margin-block-start: auto;
    }
  }

  /* `statement` — the feeling line carrying the section. "Oversized" is a TIGHT
     MEASURE plus extra rhythm, not a bigger font-size (contract A36). Derived
     from `--jp-measure`, so the `width` axis still moves it; at `narrow` it lands
     on ~15ch, which is the canvas partial's own `16ch`. */
  .feel[data-feel='statement'] .feel__heading {
    max-width: calc(var(--jp-measure) / 3);
    margin-inline: var(--jp-measure-margin);
  }

  .feel[data-feel='statement'] {
    padding-block: calc(var(--jp-sec-pad-block) * 1.3);
  }

  /* ═══ LEFT · the free-taste player ═══ */
  .feel__player {
    width: 100%;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    padding-block-start: calc(var(--jp-sec-gap) * 1.3);
  }

  .feel-taste {
    position: relative;
    border-radius: var(--radius-xl);
    padding: calc(var(--space-6) * var(--jp-rhythm));
    background: linear-gradient(
      180deg,
      var(--color-surface-elevated),
      var(--color-surface-secondary)
    );
    /* WIDTH is a token, COLOUR is the axis: `edge: none` must not delete the only
       boundary between the card and the page. */
    border: var(--border-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
    overflow: hidden;
    text-align: start;
  }

  /* Warm hearth glow inside the card — gated on `surface: media` like every other
     atmosphere layer, so a `bare`/`panel` family gets a clean card. */
  .feel-taste__aura {
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
    background: radial-gradient(
      120% 90% at 12% 0%,
      color-mix(in oklab, var(--color-brand-primary) 16%, transparent),
      transparent 58%
    );
  }

  /*
    THE SOUND SOURCE — present, rendered, and off-layout.

    NOT `display: none` and NOT `visibility: hidden`: both make the element
    invisible in a way an engine is entitled to read as "no rendering needed", and
    the audio is the only thing this element is here for. 1px at zero opacity with
    no pointer surface is the shape that keeps a media element fully alive while
    taking no space and drawing nothing. `position: absolute` against `.feel-taste`
    (which is already `position: relative` for its aura) keeps it out of the flex
    row entirely, so it cannot open a gap in the transport.
  */
  .feel-taste__media {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .feel-taste__head,
  .feel-wave {
    position: relative;
    z-index: 1;
  }

  .feel-taste__head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  /* play / pause — a FUNCTIONAL control, so it stays on the semantic brand tokens
     `CtaLink` uses rather than on `--jp-accent-fill`. That is deliberate:
     `--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`, so
     an axis-filled button would have no plate at all on two of five values, and a
     price-adjacent control must never become invisible. `--color-brand-primary`
     is re-pointed onto the `--jp-*` ladder by `.journey-palette--page`, so it is
     still brand-derived and still auto-contrasted (contract A11). */
  .feel-play {
    flex: none;
    position: relative;
    /* WCAG 2.5.5: the floor cannot be a value a brand setting can lower, which is
       why `--tap-target-min` is `max(2.75rem, var(--space-11))`. The clamp still
       governs the resting size wherever it already clears the floor. */
    width: clamp(var(--tap-target-min), 8cqw, var(--space-16));
    height: clamp(var(--tap-target-min), 8cqw, var(--space-16));
    min-width: var(--tap-target-min);
    min-height: var(--tap-target-min);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    box-shadow: var(--jp-accent-glow);
    transition:
      transform var(--duration-fast) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out);
  }

  /* `:global` because the class lands on an `IconBase` `<svg>` in a child
     component, which Svelte's scoping cannot reach. Sized in percent so the glyph
     tracks the button's own clamp rather than needing a second scale. */
  .feel-play :global(.feel-play__glyph) {
    display: block;
    width: 42%;
    height: 42%;
  }

  .feel-play:hover {
    background: var(--color-brand-primary-hover);
  }

  .feel-play:active {
    transform: translateY(calc(var(--space-0-5) / 2));
  }

  /* `edge: none` and `edge: soft` remove borders, but a focus ring is never
     optional (research §5.1). */
  .feel-play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    /* A18: was a raw `2px`. `--border-width-thick` IS 2px and is not
       density-scaled, so this is the same pixel and not a new value —
       `--space-0-5` would have been `2px * --space-unit-density`, which a brand
       can shrink under the ring it is offsetting. */
    outline-offset: var(--border-width-thick);
  }

  /* Pulse ring while playing. `--jp-accent-mark`, never `--jp-accent-fill`: the
     latter is `transparent` at `accent: text` and `accent: edge`, so the ring
     would vanish on two of five values (pilot lesson 4). */
  .feel-play::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--jp-accent-mark);
    opacity: 0;
    pointer-events: none;
  }

  .feel-play.is-playing::after {
    animation: feel-pulse calc(var(--jp-reveal-duration) * 2.5) var(--ease-out)
      infinite;
  }

  @keyframes feel-pulse {
    0% {
      opacity: 0.55;
      transform: scale(1);
    }
    70%,
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }

  /*
    MUTE — the secondary control, so a quiet ghost button rather than a second
    brand plate. Two filled circles side by side would read as two equal choices,
    and play is the one that matters.

    It still clears `--tap-target-min` (WCAG 2.5.5) even though it looks small:
    the floor is on the BOX, and the glyph is what shrinks. `--color-text-secondary`
    on the card's own surface, never `--jp-faint` — `faint` is reserved for
    non-essential text and a control's glyph is not that.
  */
  .feel-mute {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--tap-target-min);
    height: var(--tap-target-min);
    padding: 0;
    border: var(--border-width) solid var(--jp-edge-color);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      color var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out);
  }

  .feel-mute:hover {
    color: var(--color-heading);
    border-color: var(--jp-accent-mark);
  }

  /* `edge: none` and `edge: soft` remove borders, but a focus ring is never
     optional (research §5.1). */
  .feel-mute:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    /* A18, same reasoning as `.feel-play:focus-visible`. */
    outline-offset: var(--border-width-thick);
  }

  /* `:global` because the class lands on an `IconBase` `<svg>` in a child
     component, which Svelte's scoping cannot reach. */
  .feel-mute :global(.feel-mute__glyph) {
    display: block;
    width: 45%;
    height: 45%;
  }

  .feel-taste__meta {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* CARD-SCALE TEXT reads `--jp-body-size` — the `type` axis's third rung,
     declared once in `journey-design.css` (contract A44, `Codex-8oznv`), with
     `--text-lg` as the floor it shipped. */
  .feel-taste__title {
    font-family: var(--font-heading);
    color: var(--color-heading);
    font-size: max(var(--text-lg), var(--jp-body-size));
    line-height: var(--leading-snug);
  }

  /* `--color-text-secondary`, not the `--color-text-tertiary` this shipped:
     tertiary aliases `--jp-faint`, which is reserved for NON-ESSENTIAL text, and
     a preview's own sub-line at `--text-sm` gets no large-text exemption. */
  .feel-taste__sub {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-block-start: var(--space-1);
  }

  .feel-taste__time {
    flex: none;
    align-self: flex-start;
    /* `--text-xs` is METADATA ONLY per the accessibility floors, and a duration
       readout is exactly that. */
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
  }

  .feel-taste__time .feel-cur {
    color: var(--jp-accent-text);
  }

  .feel-taste__time .feel-sep {
    margin-inline: var(--space-1);
  }

  /* waveform — decoration, drawn at rest in the baseline */
  .feel-wave {
    margin-block-start: calc(var(--jp-sec-gap) * 1.1);
    height: clamp(var(--space-14), 9cqw, var(--space-16));
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
  }

  .feel-wave i {
    flex: 1 1 0;
    min-width: 0;
    height: var(--h, 40%);
    border-radius: var(--radius-xs);
    transform-origin: center;
    background: color-mix(in oklab, var(--color-text) 22%, transparent);
    transition: background var(--duration-slow) var(--ease-out);
  }

  /* The played bars are a small decorative brand mark, so `--jp-accent-mark`
     (a real colour on all five accent values), never `--jp-accent-fill`. */
  .feel-wave i.is-on {
    background: var(--jp-accent-mark);
  }

  /* Equaliser dance — enhancement only (the class is gated on motion in the
     markup, and `--jp-reveal-duration` is 0ms at `motion: none`). */
  .feel-wave.is-playing i {
    animation: feel-eq var(--d, 1.1s) var(--ease-out) infinite;
    animation-delay: var(--delay, 0s);
  }

  @keyframes feel-eq {
    0%,
    100% {
      transform: scaleY(0.56);
    }
    50% {
      transform: scaleY(1);
    }
  }

  /* playhead */
  .feel-wave__head {
    position: absolute;
    top: 6%;
    bottom: 6%;
    width: var(--border-width-thick);
    background: var(--jp-accent-mark);
    transform: translateX(-50%);
    transition: left var(--duration-fast) linear;
    pointer-events: none;
  }

  .feel-wave__head::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    transform: translate(-50%, -50%);
    background: var(--jp-accent-mark);
    box-shadow: 0 0 0 var(--space-1)
      color-mix(in oklab, var(--color-background) 70%, transparent);
  }

  /* ═══ RIGHT · what is inside ═══════════════════════════════════════════════
     ONE list, six arrangements, selected by `data-list`. */
  .feel__col--inside {
    align-items: stretch;
  }

  .feel-list {
    list-style: none;
    position: relative;
    margin: 0;
    padding: 0;
    width: 100%;
    text-align: start;
    /* The counter root for the two looks that number their rows (`syllabus`
       mono numerals, `full-send` big numerals). Declared UNCONDITIONALLY and
       here rather than inside either look's block, because a `counter-increment`
       with no reset in scope silently attaches to the document root and keeps
       counting across sibling sections. A `counter-reset` alone paints nothing,
       so this is invisible on the six looks that never print it — candlelit
       included. */
    counter-reset: feel-item;
  }

  .feel-list__row {
    position: relative;
    z-index: 1;
  }

  .feel-list__lead {
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    color: var(--color-text);
    font-size: max(var(--text-lg), var(--jp-body-size));
    line-height: var(--leading-snug);
  }

  /* A DENSER step, derived FROM the `--jp-body-size` rung rather than from
     `--jp-heading-size`, with `--text-sm` as the body-copy floor. Was
     `--color-text-tertiary`, i.e. `--jp-faint` — the rung reserved for
     non-essential text. An inclusion's detail line is the thing a buyer reads to
     decide, so it takes `--color-text-secondary`. */
  .feel-list__sub {
    display: block;
    color: var(--color-text-secondary);
    font-size: max(var(--text-sm), calc(var(--jp-body-size) / 1.2));
    line-height: var(--leading-normal);
    margin-block-start: var(--space-1);
  }

  /* ── `timeline` (paired · column) — the ember spine ── */
  .feel-list[data-list='timeline'] {
    display: flex;
    flex-direction: column;
  }

  .feel-list[data-list='timeline'] .feel-list__row {
    display: grid;
    grid-template-columns: clamp(var(--space-8), 3.5cqw, var(--space-10)) 1fr;
    gap: var(--space-4);
    align-items: center;
    padding-block: calc(var(--space-4) * var(--jp-rhythm));
  }

  /* The spine, and the same measured trap as `turn`'s rail. The original carried
     `color-mix(--color-brand-primary 40%, transparent)`, which A37 forbids
     re-spelling onto an axis token — but reading `--jp-accent-edge` directly still
     measured **2.05:1** on the golden org's dark pole at `accent: glow`, against a
     3:1 graphic floor, because that value is already a 45% ember mix (contract
     A39). `--jp-accent-mark` is the role A38 made AA-safe for a decorative brand
     mark on all five accent values: 6.04 dark / 14.62 light on the same page. */
  .feel-list[data-list='timeline']::before {
    content: '';
    position: absolute;
    z-index: 0;
    left: calc(clamp(var(--space-8), 3.5cqw, var(--space-10)) / 2);
    top: var(--space-4);
    bottom: var(--space-4);
    width: var(--border-width);
    transform: translateX(-50%);
    background: var(--jp-accent-mark);
  }

  .feel-list__m {
    width: clamp(var(--space-8), 3.5cqw, var(--space-10));
    height: clamp(var(--space-8), 3.5cqw, var(--space-10));
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    background: var(--color-surface-secondary);
    border: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  /* The marker's own dot. This replaced a hardcoded `&#10022;` (✦) text glyph:
     a geometric codepoint is not automatically safe typography — U+25B6 carries
     emoji presentation on Apple platforms, and the same class of surprise applies
     to any decorative dingbat, so the mark is drawn rather than typed. */
  .feel-list__m::after {
    content: '';
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--jp-accent-mark);
  }

  .feel-list[data-list='timeline'] .feel-list__lead,
  .feel-list[data-list='timeline'] .feel-list__sub {
    grid-column: 2;
  }

  /* ── `runon` (statement) — a quiet inline list ── */
  .feel-list[data-list='runon'] {
    display: flex;
    flex-wrap: wrap;
    justify-content: var(--jp-align);
    gap: var(--space-2) var(--space-4);
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    text-align: var(--jp-text-align);
  }

  .feel-list[data-list='runon'] .feel-list__row {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .feel-list[data-list='runon'] .feel-list__row + .feel-list__row::before {
    content: '';
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--jp-accent-mark);
    translate: 0 calc(var(--space-1) * -1);
  }

  .feel-list[data-list='runon'] .feel-list__lead {
    font-size: max(var(--text-base), calc(var(--jp-body-size) / 1.1));
  }

  .feel-list[data-list='runon'] .feel-list__sub {
    display: inline;
    margin-block-start: 0;
  }

  /* ── `grid` — an even card grid ──
     A FLEXIBLE max. `minmax(min(100%, 16rem), 24rem)` collapses to a SINGLE track
     at 768px, because a fixed max makes the repetition count resolve to 1 —
     measured, and it looks like a design choice rather than a bug (contract
     A48). */
  .feel-list[data-list='grid'] {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: var(--jp-sec-gap);
  }

  .feel-list[data-list='grid'] .feel-list__row {
    padding: calc(var(--space-5) * var(--jp-rhythm));
    border: var(--border-width) solid var(--jp-edge-color);
    border-radius: var(--radius-card);
    background: color-mix(in oklab, var(--color-heading) 4%, transparent);
  }

  /* ── `ledger` — hairline-ruled label / detail rows ── */
  .feel-list[data-list='ledger'] {
    display: flex;
    flex-direction: column;
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  .feel-list[data-list='ledger'] .feel-list__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: baseline;
    padding-block: calc(var(--space-4) * var(--jp-rhythm));
    /* WIDTH is a token, COLOUR is the axis: a ledger without its rules is not a
       ledger, so `edge: none` may tint the rule but never delete it. */
    border-block-end: var(--border-width) solid var(--jp-edge-color);
  }

  .feel-list[data-list='ledger'] .feel-list__sub {
    margin-block-start: 0;
    text-align: end;
  }

  /* ── `stack` — alternating full-width bands ── */
  .feel-list[data-list='stack'] {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .feel-list[data-list='stack'] .feel-list__row {
    padding: calc(var(--space-5) * var(--jp-rhythm))
      calc(var(--space-6) * var(--jp-rhythm));
    border-radius: var(--radius-md);
  }

  /* The alternation is a surface tint, not an opacity: any alpha faint enough to
     read as faint fails 3:1 at the dark pole (contract A39), and a band is a
     surface a reader's own text sits on. */
  .feel-list[data-list='stack'] .feel-list__row:nth-child(odd) {
    background: color-mix(in oklab, var(--color-heading) 5%, transparent);
  }

  .feel-list[data-list='stack'] .feel-list__row:nth-child(even) {
    border: var(--border-width) solid var(--jp-edge-color);
  }

  /* ── narrow container ──
     CONTAINER queries, not viewport media queries (contract A14): `.jp-sec` is
     the container, and the builder canvas renders these sections inside a device
     frame narrower than the window, where a viewport query reads the wrong
     number. The lengths have to be literals — a container-query condition cannot
     read a custom property. */
  @container (max-width: 32rem) {
    .feel-list[data-list='ledger'] .feel-list__row {
      grid-template-columns: 1fr;
    }

    .feel-list[data-list='ledger'] .feel-list__sub {
      text-align: start;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     THE SEVEN OTHER DESIGN LANGUAGES

     Everything above this line is composition and axis plumbing, and it is what
     the section had. It produced a cinematic look on candlelit and a generic one
     on the other seven, because reading the axis tokens gets you the PERMUTATION
     and not the LANGUAGE. Each block below closes that gap for one preset, by
     delivering the falsifiable tell research §1 gives its family.

     HOW EACH BLOCK IS KEYED, AND WHY THAT IS THE SAFETY ARGUMENT:
     candlelit is `surface: media` · `edge: none` · `accent: glow` · `media: bleed`,
     and its other five values are shared with other presets. So a selector is
     candlelit-safe if and only if it REQUIRES a value candlelit does not have.
     Every rule below requires one of nine such values —
       surface: bare | tint | panel | invert
       edge:    hairline | soft | heavy | offset
       accent:  none | text | fill | edge
       type:    balanced | restrained
       motion:  none | stagger
     — so no rule in this section can match candlelit. That is arithmetic on the
     selectors, not a promise.

     The attributes are the local mirrors declared in the script: `SectionFrame`
     puts `data-jp-*` on `.jp-sec`, an ANCESTOR, and Svelte's scoping cannot reach
     it.
     ═══════════════════════════════════════════════════════════════════════════ */

  /* ── plain-facts · BRUTALIST / UTILITARIAN (research §1.2) ─────────────────
     Tell: "2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere."

     KEYED ON `edge: offset`, which no other preset uses — so this whole block is
     one look and needs no compounding.

     WHAT WAS ALREADY TRUE: the section box gets its 2px `--jp-line-strong` border
     and its hard un-blurred offset shadow from `--jp-edge-width` /
     `--jp-edge-shadow`, and `.feel-taste` inherits the same shadow. So half the
     tell was arriving.

     WHAT WAS FALSE: "radius 0 everywhere". Eleven rounded corners resolve inside
     this section at `edge: offset` — the taste card (`--radius-xl`), the play and
     mute discs and the pulse ring (`--radius-full`), the timeline badge and its
     dot (`--radius-full`), the waveform bars (`--radius-xs`), the playhead knob
     (`--radius-full`), the runon separator (`--radius-full`), the grid card
     (`--radius-card`) and the stack band (`--radius-md`). A brutalist look with a
     pill button in it is not a brutalist look; it is a product look wearing a
     thick border. */
  .feel[data-edge='offset'] .feel-taste,
  .feel[data-edge='offset'] .feel-play,
  .feel[data-edge='offset'] .feel-play::after,
  .feel[data-edge='offset'] .feel-mute,
  .feel[data-edge='offset'] .feel-list__m,
  .feel[data-edge='offset'] .feel-list__m::after,
  .feel[data-edge='offset'] .feel-wave i,
  .feel[data-edge='offset'] .feel-wave__head::before,
  .feel[data-edge='offset']
    .feel-list[data-list='runon']
    .feel-list__row
    + .feel-list__row::before,
  .feel[data-edge='offset'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-edge='offset'] .feel-list[data-list='stack'] .feel-list__row {
    border-radius: var(--radius-none);
  }

  /* 2px, and the COLOUR is read straight off `--jp-edge-color` — which
     `edge: offset` has already pointed at `--jp-line-strong`. Only the width is
     restated, because these six boundaries spell their own `--border-width`
     rather than the axis's. Re-spelling the strength instead of reading it is
     exactly what contract A37 forbids. */
  .feel[data-edge='offset'] .feel-taste,
  .feel[data-edge='offset'] .feel-mute,
  .feel[data-edge='offset'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-edge='offset']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even),
  .feel[data-edge='offset'] .feel-list[data-list='ledger'],
  .feel[data-edge='offset'] .feel-list[data-list='ledger'] .feel-list__row {
    border-width: var(--border-width-thick);
  }

  /* The hard offset shadow, repeated on every inner plate so the section reads as
     one material rather than as a brutalist frame around product cards.

     `var(--jp-edge-shadow)` is the WHOLE value of the property and is never one
     item of a comma list: at four of the eight presets it resolves to the keyword
     `none`, which `box-shadow`'s grammar cannot accept as a list item, and the
     entire declaration then evaporates silently (contract A54). */
  .feel[data-edge='offset'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-edge='offset']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd),
  .feel[data-edge='offset']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    box-shadow: var(--jp-edge-shadow);
  }

  /* BOTH PARITIES, and this was measured wrong first. `stack` alternates a 5%
     tint on odd rows against a bordered row on even ones, which is two KINDS of
     row — and a brutalist stack is one kind repeated. Scoping the plate to
     `:nth-child(even)` gave a section where every other row had a 2px box and a
     hard shadow and the rest had a whisper of fill: measured `box-shadow: none`
     and `border-bottom-width: 0px` on row 1. Every row is now the same plate. */
  .feel[data-edge='offset']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd),
  .feel[data-edge='offset']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    background: transparent;
    border: var(--border-width-thick) solid var(--jp-edge-color);
  }

  /* MONO LABELS — the eyebrow, the preview's own meta line and the clock. NOT the
     inclusion detail: that is the sentence a buyer reads to decide, and mono at
     `--text-sm` costs it real legibility for nothing the tell asks for.

     `--jp-eyebrow-tracking` is the hook `journey-sections-shared.css` declares for
     precisely this case — a section that changes the eyebrow's FACE usually has to
     change its tracking too, because `--tracking-wider` on a monospace face reads
     as letter-spaced code rather than as a label. */
  .feel[data-edge='offset'] {
    --jp-eyebrow-tracking: var(--tracking-wide);
  }

  .feel[data-edge='offset'] .feel__eyebrow,
  .feel[data-edge='offset'] .feel-taste__sub,
  .feel[data-edge='offset'] .feel-taste__time {
    font-family: var(--font-mono);
  }

  /* THE TYPE STEP, not just the sizes. `type: monumental` already gives the
     heading `--text-4xl`; this family earns its hierarchy by making everything
     BELOW the heading small, flat and un-softened rather than by growing the
     heading further. So the body drops a rung and takes full ink — grey prose is a
     comfort brutalism does not offer — and the inclusion label leaves the display
     face for the body face, which is what makes the heading read as the only
     display gesture on the page. */
  .feel[data-edge='offset'] .feel__body {
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--color-text);
  }

  .feel[data-edge='offset'] .feel-list__lead {
    font-family: var(--font-sans);
    font-weight: var(--font-semibold);
    font-size: var(--text-base);
  }

  /* AND THE DETAIL LINE HAS TO COME WITH IT. `.feel-list__sub` is
     `max(--text-sm, calc(--jp-body-size / 1.2))`, and `--jp-body-size` is derived
     from `--jp-heading-size` — which `type: monumental` puts at `--text-4xl`. So
     dropping the LABEL to `--text-base` without dropping the detail inverted the
     pair: measured 17px label over a 20px detail, i.e. the subordinate line
     rendering LARGER than the thing it is subordinate to. This is the axis rung
     doing exactly what it should and the local override forgetting to bring its
     sibling; the two sizes are one decision. */
  .feel[data-edge='offset'] .feel-list__sub {
    font-size: var(--text-sm);
  }

  /* ── THE TAP-TARGET FLOOR, FOR THE TWO LOOKS THAT THICKEN A CONTROL'S BORDER ──
     `.feel-mute` is sized `width/height: var(--tap-target-min)` under a global
     `box-sizing: border-box`, so its BORDER eats the floor from the inside. That
     is exactly the trap research §5.1 records against the brutalist family:
     "radius 0 plus 2px borders shrinks the usable tap area inside controls;
     `--tap-target-min` measured on the content box, inside the border."

     MEASURED, all 8 presets × both controls: every border box clears 44px (0
     failures), so WCAG 2.5.5's own normative measurement is satisfied everywhere
     — but the content box is 42px at the inherited 1px border and would have been
     40px on the two presets this pass takes to 2px. Switching just those two to
     `content-box` puts the 44px floor back on the content and lets the thicker
     border grow the control outward instead of inward. Contract A2: the floor is
     not a value a design choice may lower.

     Scoped to `offset` and `heavy` and NOT written on the base rule, because the
     base rule is what candlelit renders and this would grow its mute button by
     2px. The pre-existing 42px on the five hairline looks is a shared question,
     not mine to decide here. */
  .feel[data-edge='offset'] .feel-mute,
  .feel[data-edge='heavy'] .feel-mute {
    box-sizing: content-box;
  }

  /* ── syllabus · TECHNICAL / DENSE-DASHBOARD (research §1.5) ────────────────
     Tell: "hairline grid, mono numerals, and a left-border accent stripe rather
     than a filled badge."

     KEYED ON `accent: edge` (the stripe, the numerals, the grid) and
     `type: restrained` (the type step). Both values are UNIQUE to this preset, so
     either handle addresses the whole look and neither can reach another. */

  /* THE FILLED BADGE BECOMES THE STRIPE — literally the element the tell names.
     `.feel-list__m` stays in the MARKUP, because it is the timeline's only marker
     and the arrangement tests count it; it is the TREATMENT that changes, from a
     bordered disc with a dot inside it to a 2px vertical rule spanning the row.
     The ember spine goes with it: a spine plus a per-row stripe is two verticals
     doing one job. */
  .feel[data-accent='edge'] .feel-list__m {
    width: var(--border-width-thick);
    height: auto;
    align-self: stretch;
    justify-self: start;
    border: none;
    border-radius: var(--radius-none);
    background: var(--jp-accent-mark);
  }

  .feel[data-accent='edge'] .feel-list__m::after {
    display: none;
  }

  .feel[data-accent='edge'] .feel-list[data-list='timeline']::before {
    display: none;
  }

  /* The badge's column was sized for a 40px disc. A 2px rule needs a gutter, not
     a cell. */
  .feel[data-accent='edge'] .feel-list[data-list='timeline'] .feel-list__row {
    grid-template-columns: var(--space-3) minmax(0, 1fr);
    gap: var(--space-3);
  }

  /* The same stripe, plus the numeral, for every arrangement with no marker
     element of its own. `runon` is excluded because its rows are inline words in a
     sentence and a stripe through a sentence is nonsense; `timeline` is excluded
     because the rules above already gave it one.

     THE NUMERAL IS A REAL GRID COLUMN, not an absolutely-positioned overlay. The
     four arrangements resolve four different block paddings, so an overlay would
     have to re-spell each of them and would drift the moment one changed — and it
     would overlap the label the moment a detail line wrapped. */
  .feel[data-accent='edge']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__row {
    counter-increment: feel-item;
    display: grid;
    grid-template-columns: min-content minmax(0, 1fr);
    column-gap: var(--space-4);
    align-items: baseline;
    padding-inline-start: var(--space-4);
    /* `--jp-accent-mark`, never `--jp-accent-edge`: at `accent: edge` the latter
       is `--jp-ember`, which measures 2.04:1 at the dark pole against a 3:1
       graphic floor (contract A38). `--jp-accent-mark` is the role that was made
       AA-safe on all five accent values — 6.04 dark / 14.62 light. */
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  /* MONO NUMERALS. `decimal-leading-zero` because a gutter that does not reflow
     between item 9 and item 10 is the entire reason a dashboard sets its numerals
     in mono, and `tabular-nums` finishes the job. Digits are not a user-visible
     English string, so this needs no message key (contract A20). */
  .feel[data-accent='edge']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__row::before {
    content: counter(feel-item, decimal-leading-zero);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-snug);
    color: var(--jp-accent-text);
  }

  .feel[data-accent='edge']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__lead,
  .feel[data-accent='edge']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__sub {
    grid-column: 2;
    text-align: start;
  }

  /* HAIRLINE GRID. `ledger` (this preset's own variant) and `grid` already rule
     themselves. `stack` did not: it alternated a 5% tint against a bordered row,
     which reads as two different kinds of row rather than as a grid. Here every
     stack row takes the same hairline and no fill.

     `border-inline-start` is deliberately NOT touched, so this rule and the stripe
     rule above are order-independent. */
  .feel[data-accent='edge'] .feel-list[data-list='stack'] {
    gap: 0;
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  .feel[data-accent='edge']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd),
  .feel[data-accent='edge']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    background: transparent;
    border-block-start: none;
    border-inline-end: none;
    border-block-end: var(--border-width) solid var(--jp-edge-color);
    border-radius: var(--radius-none);
  }

  /* `type: restrained` — ONE dense step and no display gesture anywhere below the
     heading. The axis already puts the heading on `--text-xl`; a restrained look
     also wants its rows in the body face at body size, because a technical list is
     read as DATA and not as a run of little headings. */
  .feel[data-type='restrained'] .feel__body {
    font-size: var(--text-base);
    line-height: var(--leading-normal);
  }

  .feel[data-type='restrained'] .feel-list__lead {
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    font-size: var(--text-base);
  }

  /* The clock is the one number this section prints on every look that has a
     preview clip, and mono tabular numerals are the other half of the tell. */
  .feel[data-type='restrained'] .feel-taste__time {
    font-family: var(--font-mono);
  }

  /* ── quiet-studio · LUXURY-MINIMAL (research §1.4) ─────────────────────────
     Tell: "three type sizes, one hairline, no accent colour, and more empty space
     than content."

     KEYED ON `accent: none` and `density: vast`, both UNIQUE to this preset.

     THIS BLOCK IS MOSTLY SUBTRACTION, and that is the correct edit for this
     family — anything ADDED makes it worse. */

  /* ONE HAIRLINE: the section's own, from `edge: hairline`. Everything inside
     loses its boundary. The taste card stops being a card, the timeline badge
     stops being a bordered disc, the spine goes, and the two ledger rules drop to
     `--jp-line-subtle`. Before this the section resolved seven concurrent
     boundaries on the look whose signature is having one. */
  .feel[data-accent='none'] .feel-taste {
    background: transparent;
    border: none;
    box-shadow: none;
    padding-inline: 0;
  }

  .feel[data-accent='none'] .feel-list__m {
    background: transparent;
    border: none;
  }

  .feel[data-accent='none'] .feel-list[data-list='timeline']::before {
    display: none;
  }

  .feel[data-accent='none'] .feel-list[data-list='ledger'],
  .feel[data-accent='none'] .feel-list[data-list='ledger'] .feel-list__row {
    border-color: var(--jp-line-subtle);
  }

  .feel[data-accent='none'] .feel-list[data-list='grid'] .feel-list__row {
    background: transparent;
    border: none;
  }

  .feel[data-accent='none']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd) {
    background: transparent;
  }

  .feel[data-accent='none']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    border: none;
  }

  /* NO ACCENT COLOUR, INCLUDING THE ONE FUNCTIONAL CONTROL.

     `.feel-play` is deliberately on `--color-brand-primary` rather than
     `--jp-accent-fill`, and the stated reason is sound: `--jp-accent-fill` is
     `transparent` at two of five accent values and a price-adjacent control must
     never become invisible. But at `accent: none` a saturated brand disc is the
     only chromatic object on the page, and it breaks this tell outright.

     So it becomes a hairline disc in heading ink: still a disc, still
     `--tap-target-min`, still focus-ringed, still unmistakably the play control —
     and now the amount of accent colour in the section is none. */
  .feel[data-accent='none'] .feel-play {
    background: transparent;
    color: var(--color-heading);
    border: var(--border-width) solid var(--jp-line);
    box-shadow: none;
  }

  .feel[data-accent='none'] .feel-play:hover {
    background: transparent;
    border-color: var(--color-heading);
  }

  /* The pulse ring does NOT vanish at `accent: none` — `--jp-accent-mark` resolves
     to `--jp-heading` there, a real colour — so it pulses in ink instead. A
     luxury-minimal page does not pulse. */
  .feel[data-accent='none'] .feel-play.is-playing::after {
    animation: none;
  }

  /* THREE TYPE SIZES, countable. This section resolved six on this look: the
     heading, the body at `--text-lg`, the taste title and the inclusion label both
     at `max(--text-lg, --jp-body-size)`, the taste sub and inclusion detail at
     `--text-sm`, and the clock at `--text-xs`. Collapsed to three — the heading
     (`--jp-heading-size`), the body rung (`--text-lg`) and the meta rung
     (`--text-sm`, which the eyebrow already sits on). The hierarchy given up in
     size is carried by the whitespace below, which is this family's own trade. */
  .feel[data-accent='none'] .feel-taste__title,
  .feel[data-accent='none'] .feel-list__lead {
    font-size: var(--text-lg);
  }

  .feel[data-accent='none'] .feel-taste__sub,
  .feel[data-accent='none'] .feel-list__sub,
  .feel[data-accent='none'] .feel-taste__time {
    font-size: var(--text-sm);
  }

  /* MORE EMPTY SPACE THAN CONTENT, and conspicuously so. `density: vast` already
     multiplies every padding by `--jp-rhythm: 1.6`, but a uniform 1.6x is not
     something a reader NOTICES — and being noticed is what the tell asks for.
     These five multiply only the gaps the eye actually reads as emptiness: around
     the section, between the two columns, between the copy blocks, above the
     player and around each row. The type is left alone. */
  .feel[data-density='vast'] {
    padding-block: calc(var(--jp-sec-pad-block) * 1.5);
  }

  .feel[data-density='vast'] .feel__grid {
    gap: calc(var(--jp-sec-gap) * 3.5);
  }

  .feel[data-density='vast'] .feel__copy {
    gap: calc(var(--space-6) * var(--jp-rhythm));
  }

  .feel[data-density='vast'] .feel__player {
    padding-block-start: calc(var(--jp-sec-gap) * 2.4);
  }

  .feel[data-density='vast'] .feel-list[data-list='ledger'] .feel-list__row,
  .feel[data-density='vast'] .feel-list[data-list='timeline'] .feel-list__row {
    padding-block: calc(var(--space-8) * var(--jp-rhythm));
  }

  /* ── long-read · EDITORIAL / MAGAZINE (research §1.1) ──────────────────────
     Tell: "the eyebrow and the body share a left edge, and there is a hairline
     under every section head."

     KEYED ON `surface: bare` + `type: balanced`. THE COMPOUND IS REQUIRED: the
     only other `bare` preset is quiet-studio and the only other `balanced` preset
     is signal, so a bare rule on either half alone restyles a look this block is
     not about.

     THE LEFT EDGE WAS ALREADY SHARED — `align: start` zeroes
     `--jp-measure-margin`, so the eyebrow, heading and body all begin at the same
     inline offset. That is the half the audit measured as present.

     THE HAIRLINE UNDER THE HEAD WAS ABSENT: no `border-block-end` existed on any
     heading in this file, on any look. It is the whole of what this block adds. */
  .feel[data-surface='bare'][data-type='balanced'] .feel__heading {
    align-self: stretch;
    max-width: var(--jp-measure);
    padding-block-end: calc(var(--space-3) * var(--jp-rhythm));
    border-block-end: var(--border-width) solid var(--jp-edge-color);
  }

  /* "under EVERY section head" — the free taste's own title is the second head in
     this section, and an editorial page rules it the same way it rules the first. */
  .feel[data-surface='bare'][data-type='balanced'] .feel-taste__title {
    padding-block-end: calc(var(--space-2) * var(--jp-rhythm));
    border-block-end: var(--border-width) solid var(--jp-edge-color);
  }

  /* A BARE SURFACE MEANS THE PAGE SHOWS THROUGH, and this is the SUBTRACTION half
     of an editorial pass. The taste card was a filled, rounded, shadowed plate on
     a look whose surface axis says "paint nothing": an essay does not float a
     widget over its own column. Flattened to a ruled block that starts on the same
     left edge as the prose, which is the tell again rather than a new decoration. */
  .feel[data-surface='bare'][data-type='balanced'] .feel-taste {
    background: transparent;
    border: none;
    border-radius: var(--radius-none);
    box-shadow: none;
    padding-inline: 0;
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  /* ── open-air · SOFT-ORGANIC / WELLNESS (research §1.3) ────────────────────
     Tell: "no border anywhere, pill controls, and a shadow you have to look for."

     KEYED ON `edge: soft` and `surface: tint`, each UNIQUE to this preset.

     THE MOST DANGEROUS LOOK IN THE SET, and the reason is arithmetic: open-air
     shares FOUR axes with candlelit — `align: center`, `density: airy`,
     `width: text` and `motion: drift`. Nothing in this block reads any of them.
     `edge: soft` and `surface: tint` are values candlelit does not have.

     "NO BORDER ANYWHERE" WAS FALSE, and measurably. `edge: soft` sets
     `--jp-edge-width: 0px`, which correctly removes the SECTION's border — but six
     inner boundaries in this file spell their own `var(--border-width)` instead of
     reading the axis, so the taste card, the mute button, the timeline badge, the
     grid card, both ledger rules and the stack's even rows all kept a 1px line on
     the one look whose signature is not having one. */
  .feel[data-edge='soft'] .feel-taste,
  .feel[data-edge='soft'] .feel-mute,
  .feel[data-edge='soft'] .feel-list__m,
  .feel[data-edge='soft'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-edge='soft']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    border: none;
  }

  .feel[data-edge='soft'] .feel-list[data-list='ledger'],
  .feel[data-edge='soft'] .feel-list[data-list='ledger'] .feel-list__row {
    border-block-start: none;
    border-block-end: none;
  }

  /* …which leaves a ledger with no rules, so its rhythm has to move from the line
     to the SURFACE: a gap, a tint and inline padding turn each row into its own
     soft object. This is the family's own answer to "how do you separate rows
     without drawing anything". */
  .feel[data-edge='soft'] .feel-list[data-list='ledger'] {
    gap: var(--space-2);
  }

  .feel[data-edge='soft'] .feel-list[data-list='ledger'] .feel-list__row {
    background: color-mix(in oklab, var(--color-heading) 4%, transparent);
    padding-inline: calc(var(--space-6) * var(--jp-rhythm));
  }

  /* PILL CONTROLS — and on this look every row is a control-shaped surface, which
     is what stops the pill discs reading as two odd exceptions in a rectangular
     list. `--radius-full` and not a fixed radius: it resolves to a true stadium on
     a one-line row and clamps to half the height on a two-line one, which no fixed
     value can do. */
  .feel[data-surface='tint'] .feel-list[data-list='stack'] .feel-list__row,
  .feel[data-surface='tint'] .feel-list[data-list='ledger'] .feel-list__row {
    border-radius: var(--radius-full);
  }

  .feel[data-surface='tint'] .feel-list[data-list='stack'] .feel-list__row {
    padding-inline: calc(var(--space-8) * var(--jp-rhythm));
  }

  .feel[data-surface='tint'] .feel-taste,
  .feel[data-surface='tint'] .feel-list[data-list='grid'] .feel-list__row {
    border-radius: var(--radius-xl);
  }

  /* A SHADOW YOU HAVE TO LOOK FOR. `edge: soft` hands the SECTION `--shadow-lg`;
     inside it every surface takes `--shadow-xs` — one step, diffuse, and doing the
     entire job of the six borders removed above. The taste card in particular was
     carrying `--shadow-lg` itself through `--jp-edge-shadow`, which is a shadow you
     cannot help noticing. */
  .feel[data-surface='tint'] .feel-taste,
  .feel[data-surface='tint'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-surface='tint'] .feel-list[data-list='stack'] .feel-list__row,
  .feel[data-surface='tint'] .feel-play {
    box-shadow: var(--shadow-xs);
  }

  /* MOTION WITH A REASON, without touching the axis. `motion: drift` is shared
     with candlelit, so the reveal tokens are left exactly alone; what is scoped to
     `surface: tint` is the equaliser's CHARACTER — nearly twice the period and
     `--ease-smooth` instead of `--ease-out`, so the bars breathe rather than
     bounce. Candlelit is `surface: media` and keeps the faster motion it has. */
  .feel[data-surface='tint'] .feel-wave.is-playing i {
    animation-duration: calc(var(--d, 1.1s) * 1.9);
    animation-timing-function: var(--ease-smooth);
  }

  /* ── full-send · PLAYFUL / HIGH-ENERGY (research §1.8) ─────────────────────
     Tell: "whole inverted bands, pill CTAs at `--radius-full`, spring easing, big
     numerals."

     KEYED ON `surface: invert`, `edge: heavy` and `motion: stagger` — all three
     UNIQUE to this preset.

     WHOLE BANDS, AND THE TOKENS ARE THE HARD PART. `surface: invert` re-points
     `--jp-ink` at the opposite pole and the ENTIRE text ladder re-derives from it,
     so a band painted with a raw ink rung would sit under text that was contrasted
     against the section's ink and not the band's — the "any axis introducing a new
     surface must re-derive, never hardcode" failure research §5.1 names, which
     `surface: panel` documents costing `--jp-faint` 4.43:1 at a 12% lift.

     The one pair in this system contrast-designed for each other is
     `--jp-accent-fill` / `--jp-accent-on-fill`, and `accent: fill` guarantees both
     resolve to a real colour here. So the alternation is BAND / OUTLINED BAND: odd
     rows are the filled accent with its paired ink, even rows are the section's own
     surface behind the heavy accent border `edge: heavy` already chose. Two
     full-width bands, no invented mix percentage (contract A37), no ladder to
     re-derive. */
  .feel[data-surface='invert'] .feel-list[data-list='stack'] {
    gap: var(--space-2);
  }

  .feel[data-surface='invert']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd) {
    background: var(--jp-accent-fill);
  }

  .feel[data-surface='invert']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    background: transparent;
  }

  /* `edge: heavy` — the width, read off the axis for the colour. Same shape as the
     `edge: offset` block: these boundaries hardcode `--border-width` rather than
     reading `--jp-edge-width`, so a "heavy" look was drawing hairlines inside a
     heavy frame. */
  .feel[data-edge='heavy'] .feel-taste,
  .feel[data-edge='heavy'] .feel-mute,
  .feel[data-edge='heavy'] .feel-list[data-list='grid'] .feel-list__row,
  .feel[data-edge='heavy']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    border-width: var(--border-width-thick);
  }

  /* PILL CTAs AT `--radius-full`, and the bands take the CTA's own shape so the
     look reads as one language rather than as a rounded button on a square list.
     `grid` stops at `--radius-xl`: a tall card at `--radius-full` is not a pill,
     it is a lozenge with corners cut off its content. */
  .feel[data-surface='invert'] .feel-list[data-list='stack'] .feel-list__row {
    border-radius: var(--radius-full);
    padding-inline: calc(var(--space-8) * var(--jp-rhythm));
  }

  .feel[data-surface='invert'] .feel-list[data-list='grid'] .feel-list__row {
    border-radius: var(--radius-xl);
  }

  /* BIG NUMERALS. The row's own index, set at the section-heading rung in the
     heading face — the tell's "big", not a decorative glyph. A real grid column
     again, so it cannot collide with the label once a detail line wraps, and
     spanning both text rows so it optically centres on the pair. Digits are not a
     user-visible English string (contract A20). */
  .feel[data-surface='invert']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__row {
    counter-increment: feel-item;
    display: grid;
    grid-template-columns: min-content minmax(0, 1fr);
    column-gap: var(--space-4);
    align-items: center;
  }

  .feel[data-surface='invert']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__row::before {
    content: counter(feel-item);
    grid-row: 1 / span 2;
    align-self: center;
    font-family: var(--font-heading);
    font-weight: var(--font-bold);
    font-size: var(--jp-heading-size);
    line-height: var(--leading-none);
    font-variant-numeric: tabular-nums;
    color: var(--jp-accent-text);
  }

  .feel[data-surface='invert']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__lead,
  .feel[data-surface='invert']
    .feel-list:not([data-list='runon']):not([data-list='timeline'])
    .feel-list__sub {
    grid-column: 2;
    text-align: start;
  }

  /* THE BAND'S PAIRED INK, and it has to be declared HERE — after the numeral —
     not up with the band's background where it reads more naturally.

     MEASURED: both selectors are (0,6,0), so source order decides, and the
     numeral rule above sets `color: var(--jp-accent-text)`. Written in the
     obvious place this lost, and the big numeral rendered in ember-text ON an
     ember band — `oklab(0.737 0.078 0.050)` where the paired ink is white. The
     label and detail were unaffected, which is what makes it the kind of bug that
     ships: two of three elements on the band were correct.

     NOT a faded version of the paired ink either: no alpha low enough to read as
     faint survives the dark pole (contract A39), so the detail line is separated
     from the label by size and weight rather than by opacity. */
  .feel[data-surface='invert']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd)
    .feel-list__lead,
  .feel[data-surface='invert']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd)
    .feel-list__sub,
  .feel[data-surface='invert']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd)::before {
    color: var(--jp-accent-on-fill);
  }

  /* SPRING EASING. `motion: stagger` already puts `--ease-spring` on
     `--jp-reveal-ease`, so the reveal cascade springs. The CONTROLS did not: every
     transition and both keyframe animations in this file name `--ease-out`
     directly. Here they spring too, which is the difference between a page that
     arrives playfully and a page that IS playful. */
  .feel[data-motion='stagger'] .feel-play,
  .feel[data-motion='stagger'] .feel-mute,
  .feel[data-motion='stagger'] .feel-wave i {
    transition-timing-function: var(--ease-spring);
  }

  .feel[data-motion='stagger'] .feel-play.is-playing::after,
  .feel[data-motion='stagger'] .feel-wave.is-playing i {
    animation-timing-function: var(--ease-spring);
  }

  /* ── signal · CONTEMPORARY / PRODUCT (research §1.9) ───────────────────────
     Tell: "rounded cards with hairlines and a small neutral shadow; one filled
     accent button per section."

     KEYED ON `surface: panel` + `type: balanced`. THE COMPOUND IS REQUIRED: the
     other two `panel` presets are plain-facts (`monumental`) and syllabus
     (`restrained`), and the other `balanced` preset is long-read (`bare`).

     The taste card already IS this tell — rounded, hairlined, and `--shadow-xs`
     via `--jp-edge-shadow` at `edge: hairline`. What was missing is that the LIST
     rows were not cards at all: `grid` had a border and a radius but no shadow,
     and `stack` alternated a 5% tint against a bordered row, which is two kinds of
     row rather than one repeated card. Both become the same card, so the section
     reads as a system.

     The surface stays the 4% mix `grid` already shipped rather than
     `--color-surface-elevated`: on a `panel` section `--jp-ink` is ALREADY lifted
     12%, and `--color-surface-elevated` is `--jp-ink-3`, so the obvious spelling
     stacks a second 12% under text that was contrasted against the first. */
  .feel[data-surface='panel'][data-type='balanced']
    .feel-list[data-list='grid']
    .feel-list__row,
  .feel[data-surface='panel'][data-type='balanced']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(odd),
  .feel[data-surface='panel'][data-type='balanced']
    .feel-list[data-list='stack']
    .feel-list__row:nth-child(even) {
    background: color-mix(in oklab, var(--color-heading) 4%, transparent);
    border: var(--border-width) solid var(--jp-edge-color);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-xs);
  }

  .feel[data-surface='panel'][data-type='balanced'] .feel-list[data-list='stack'] {
    gap: var(--space-3);
  }

  /* ONE RADIUS FOR THE WHOLE CARD FAMILY. The taste card sits at `--radius-xl`
     (16px measured) and the list cards at `--radius-card` (12px), which is two
     card systems in one section — the exact thing "rounded cards" as a LANGUAGE
     rules out. `--radius-card` is the platform's card rung, so the card follows
     the cards. */
  .feel[data-surface='panel'][data-type='balanced'] .feel-taste {
    border-radius: var(--radius-card);
  }

  .feel[data-surface='panel'][data-type='balanced']
    .feel-list[data-list='stack']
    .feel-list__row {
    padding: calc(var(--space-5) * var(--jp-rhythm));
  }

  /* ONE FILLED ACCENT BUTTON PER SECTION, and this is it.

     `.feel-play` is deliberately on `--color-brand-primary` rather than
     `--jp-accent-fill`, and the stated objection is exactly right:
     `--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`, so an
     axis-filled button would have no plate at all on two of five values and a
     price-adjacent control must never become invisible.

     Scoping to `[data-accent='fill']` ANSWERS that objection rather than ignoring
     it — it is the one value where `--jp-accent-fill` and its paired
     `--jp-accent-on-fill` are both guaranteed to resolve to a real colour. So on
     the three presets whose tell names a filled accent (plain-facts, full-send,
     signal) the button is the accent the creator chose; on the other five it is
     untouched, candlelit included.

     The hover ring is a `box-shadow` written as a WHOLE value and composes no
     `--jp-edge-*` token (contract A54), and it is deliberately not an `outline`:
     an outline here would outrank `:focus-visible`'s own ring on a
     hovered-and-focused button. */
  .feel[data-accent='fill'] .feel-play {
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
  }

  .feel[data-accent='fill'] .feel-play:hover {
    background: var(--jp-accent-fill);
    box-shadow: 0 0 0 var(--border-width-thick) var(--jp-accent-mark);
  }

  /* ── `motion: none` — TRULY none (plain-facts · syllabus) ──────────────────
     `--jp-reveal-*` all collapse to zero at this value, so the reveal ladder is
     already still, and the pulse ring's duration derives from
     `--jp-reveal-duration` so it too was already still. FOUR things were not: the
     equaliser's keyframes run on a LOCAL `--d` (fixed in markup — see `motionOk`)
     and three transitions here name `--duration-*` directly.

     A creator who CHOSE `motion: none` now gets no movement from this section at
     all. That is contract A40's "the static layout is the baseline" applied to a
     stated preference, which the OS-level `prefers-reduced-motion` block below
     cannot see. */
  .feel[data-motion='none'] .feel-wave__head,
  .feel[data-motion='none'] .feel-wave i,
  .feel[data-motion='none'] .feel-play,
  .feel[data-motion='none'] .feel-mute {
    transition: none;
  }

  /* ── REDUCED MOTION ──
     `journey-sections-shared.css` already kills every keyframe animation inside
     `.jp-sec` with `animation: none !important`, so the equaliser and the pulse
     ring stop rather than merely speeding up. What it cannot reach is a
     TRANSITION, so the two here are neutralised explicitly. */
  @media (prefers-reduced-motion: reduce) {
    .feel-wave__head,
    .feel-wave i,
    .feel-play {
      transition: none;
    }
  }
</style>
