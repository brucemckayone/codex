<!--
  @component FeelSection

  What a practice FEELS like, and what is inside it (SPEC §4.1 `feel`).

  ── THE AXES THIS SECTION CONSUMES: EIGHT ──────────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion`. Every
  layout / rhythm / type-scale / edge / surface / motion decision reads a `--jp-*`
  property that `render/SectionRenderer.svelte` resolves onto the `.jp-sec`
  wrapper as a `data-jp-*` attribute. COLOUR STAYS `--color-*` (contract A11);
  the one exception is the `--jp-accent-*` family.

  `media` is DELIBERATELY unconsumed. Research §2.2 names the five types where it
  is meaningful — `hero`, `introVideo`, `reel`, `guide`, `proof` — and says the
  rest "ignore it, exactly as they ignore a variant they do not offer." The
  free-taste player looks like media but is not: it is a synthetic waveform drawn
  from a deterministic function, and `context.sellPreview.reel`'s real manifest is
  still unwired (`Codex-scab9`). There is no image, no video and no aspect ratio
  for `--jp-media-*` to shape, so claiming nine would have meant inventing a
  consumer (contract A50). If `Codex-scab9` ever wires real playback, `media`
  becomes this section's ninth axis.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `paired` (default) · `column` · `statement` · `grid` · `ledger` · `stack`.
  `paired` is the arrangement this component has always drawn (the retired prose
  `twocol`); `column` absorbs the retired `centered` + `wide` (they were `align` +
  `width`); both are ported from the canvas partial
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
  • ENHANCED (browser + motion OK): blocks arrive on the `motion` axis's timing,
    and the free-taste player animates as a breathing equaliser with a live
    playhead.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { PauseIcon, PlayIcon } from '$lib/components/ui/Icon';
  import { aliasKeys, asObjectArray, asString, asStringFrom, fieldString } from '../coerce';
  import { reveal } from '../reveal';
  import type { FeelSectionProps, FeelInclusion, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
    variant?: string;
    /**
     * Present for the uniform contract and NOT destructured: all eight axes this
     * section consumes land in CSS, because none of them changes what is
     * RENDERED.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, variant, editable = false, onEdit }: Props = $props();

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

  // ── The optional free-taste player. `previewTitle` is the switch; absent ⇒ the
  //    whole player self-hides. `previewDuration` stays a DEFENSIVE numeric read
  //    because its `number` control has no editor UI yet (contract A29) and the
  //    text fallthrough writes a string like "480", which must not be trusted.
  const previewTitle = $derived(asString(config, 'previewTitle'));
  const previewSub = $derived(asString(config, 'previewSub'));
  const previewDuration = $derived.by(() => {
    const raw = config['previewDuration'];
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 480;
  });
  const hasPlayer = $derived(previewTitle ? 'yes' : 'no');

  const inclusions = $derived(p.inclusions ?? []);
  const hasContent = $derived(
    !!(p.eyebrow || p.heading || p.body || inclusions.length > 0) ||
      hasPlayer === 'yes'
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

  // ── Mock free-taste transport (a visual "taste", no real audio — `Codex-scab9`
  //    tracks wiring it to `context.sellPreview.reel`). `elapsed` advances via rAF
  //    only when motion is welcome.
  let playing = $state(false);
  let elapsed = $state(0);

  const enhanced = $derived(mounted && !reduced);
  const progress = $derived(previewDuration > 0 ? elapsed / previewDuration : 0);
  const playedBars = $derived(Math.round(progress * BAR_COUNT));
  const headPct = $derived(Math.min(Math.max(progress * 100, 0), 100));

  const fmt = (secs: number): string => {
    const s = Math.max(0, Math.min(previewDuration, Math.round(secs)));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const curLabel = $derived(fmt(elapsed));
  const totLabel = $derived(fmt(previewDuration));

  onMount(() => {
    mounted = true;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Advance the playhead while playing (motion path only). Tears down on pause /
  // reduced-motion / unmount so no rAF leaks across the section's lifetime.
  //
  // `svelte-autofixer` flags the `elapsed` / `playing` assignments inside this
  // `$effect` as malpractice and suggests `$derived`. DELIBERATELY NOT CHANGED:
  // this is a wall-clock ticker, and `$derived` has no expression for "the time
  // now" — the value comes from `performance.now()` deltas, not from any reactive
  // input. A rAF loop that writes its own accumulator IS the correct shape here,
  // and the effect is the only thing that can own its teardown. Every other
  // derived value in this file (`progress`, `playedBars`, `headPct`, the labels)
  // IS a `$derived` off `elapsed`, which is the part the rule is really about.
  $effect(() => {
    if (!playing || !enhanced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed += (now - last) / 1000;
      last = now;
      if (elapsed >= previewDuration) {
        elapsed = 0;
        playing = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function togglePlay() {
    playing = !playing;
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
   * The inline-edit seam for the studio canvas, as a spreadable attribute bag.
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having
   * no seam at all.
   *
   * DELIBERATELY NOT `render-edit/EditableText.svelte`: it renders an EMPTY
   * element and fills `textContent` from a Svelte action, and actions do not run
   * during SSR — so the public page would serve `<h2></h2>` and paint the text in
   * only after hydration. Here the text is a real child node.
   */
  const editAttrs = (key: string): HTMLAttributes<HTMLElement> =>
    editable
      ? {
          contenteditable: 'true',
          spellcheck: 'false',
          'data-field': key,
          oninput: (e) =>
            onEdit?.(key, (e.currentTarget as HTMLElement).textContent ?? ''),
        }
      : {};
</script>

{#if hasContent}
  <div class="feel" data-feel={composition} data-split={split}>
    <!-- ONE observer for the whole section, on the container: the shared atom is
         `.reveal--armed .jp-reveal` (a DESCENDANT selector) and the action adds
         `.reveal--armed` to the node it is used on. -->
    <div class="feel__inner" use:reveal>
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

          {#if hasPlayer === 'yes'}
            <div class="feel__player jp-reveal" data-jp-step="3">
              <div
                class="feel-taste"
                role="group"
                aria-label="Free taste — {previewTitle} preview"
              >
                <div class="feel-taste__aura" aria-hidden="true"></div>
                <div class="feel-taste__head">
                  <button
                    class="feel-play"
                    class:is-playing={playing}
                    type="button"
                    aria-pressed={playing}
                    aria-label={playing ? 'Pause preview' : 'Play preview'}
                    onclick={togglePlay}
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
                  <div class="feel-taste__meta">
                    <div class="feel-taste__title">{previewTitle}</div>
                    {#if previewSub}
                      <div class="feel-taste__sub">{previewSub}</div>
                    {/if}
                  </div>
                  <div class="feel-taste__time" aria-hidden="true">
                    <span class="feel-cur">{curLabel}</span>
                    <span class="feel-sep">/</span>
                    <span>{totLabel}</span>
                  </div>
                </div>

                <!--
                  THE WAVEFORM IS DECORATION, AND IT NO LONGER PRETENDS OTHERWISE.
                  It used to carry `role="presentation"`, `aria-hidden="true"` AND
                  an `onclick` seek handler: a control with no keyboard path, no
                  role, no name and no route into the accessibility tree. The seek
                  is removed rather than made accessible because there is nothing
                  to seek — the transport is a visual taste with no audio behind it
                  (`Codex-scab9`). Wiring real playback is what should bring a real
                  scrubber, with a real `<input type="range">`.
                -->
                <div
                  class="feel-wave"
                  class:is-playing={playing && enhanced}
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
          {/if}
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
    outline-offset: 2px;
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
