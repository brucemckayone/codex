<!--
  @component HeroSection

  Opening headline, kicker and primary CTA (SPEC §4.1 `hero`). Falls back to the
  awaited course fields when a copy prop is absent, so an unconfigured hero still
  renders a coherent first paint (SEO-critical).

  ── THE NINE AXES ──────────────────────────────────────────────────────────
  Every layout / rhythm / type / edge / surface / motion / media decision in this
  file reads a `--jp-*` property that `render/SectionRenderer.svelte` resolves onto
  the `.jp-sec` wrapper as a `data-jp-*` attribute
  (`docs/design/journey-sections/02-axis-contract.md` A9). COLOUR STAYS `--color-*`
  (A11) — the palette re-points those onto the `--jp-*` ladder already. The one
  colour exception is the `--jp-accent-*` family, which exists so `accent: none`
  removes the brand from the atmosphere in five declarations instead of a repo-wide
  replace.

  Three axes are read in MARKUP rather than CSS, because a Svelte-scoped `<style>`
  cannot reach an ancestor attribute and these change what is RENDERED, not merely
  how it paints: `media: none` (no plate at all), `motion: none` (no continuous
  decoration, no scroll cue) and the composition itself.

  Six more are MIRRORED onto this section's own root as `data-hero-*` attributes
  (`surface`, `edge`, `align`, `type`, `accent`, `motion`) so the stylesheet can
  SELECT on them and not merely substitute their values. That is what the EIGHT
  LOOKS block at the bottom of the stylesheet needs: a design language is a set of
  shapes, faces and drawn marks, and no amount of value substitution turns a
  square corner into a pill or a grey label into a mono one. See that block's
  header for the selector-by-selector proof that none of it reaches Candlelit.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `stage` (default) · `split-media` · `full-bleed` · `oversized` · `banner` ·
  `poster`. `stage` absorbs the retired `centered`/`left` (they were the `align`
  axis) and `minimal` (which was a preset: `density: compact` + `accent: none` +
  `motion: none`); `LEGACY_SECTION_VARIANTS` carries the stored ids forward.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED (mirrors AcheSection) ────────────
  • BASELINE (SSR, no-JS, reduced-motion): a clean, fully-legible column — every
    word visible, glow static, motes/scroll-cue hidden. This is what the server
    emits, so the section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the cinematic opening — a breathing warm core,
    slow rising motes, an edge vignette, a word-by-word kinetic headline, staggered
    entrances on the `motion` axis's own timing, a heart-beating trust dot and a
    descending scroll-cue spark.

  Enhancement is gated on `mounted && !reduced` (`.hero--enhanced`) so the
  accessible baseline always ships first; a `matchMedia` listener re-wires if the
  preference flips mid-session. All atmosphere is decorative and never load-bearing
  for legibility — `.hero__atmos` multiplies its whole opacity by the
  `--jp-sec-atmos` 0/1 gate, so the markup stays mounted and simply resolves to
  zero outside `surface: media`.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronDownIcon, PlayIcon } from '$lib/components/ui/Icon';
  import IntroVideoModal from '$lib/components/ui/IntroVideoModal/IntroVideoModal.svelte';
  import * as m from '$paraglide/messages';
  import CtaLink from '../CtaLink.svelte';
  import { aliasKeys, asString, asStringFrom } from '../coerce';
  import { HeroLoopVideo } from '$lib/components/ui/HeroLoopVideo';
  import { editFieldAttrs } from '../editable';
  import type {
    HeroSectionProps,
    JourneySalesContext,
    SellPreview,
  } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * The three keys the builder writes that the canonical `HeroSectionProps` does
   * not name yet — `hero.accent` / `felt` / `bg`, the `OWED_READS` entry for this
   * worktree. They are declared here rather than in `render/types.ts` because that
   * file is shared across the seven component worktrees; consolidation should
   * absorb them into `HeroSectionProps` itself.
   */
  interface HeroCopy extends HeroSectionProps {
    /** An italic accent phrase closing the headline. */
    accent?: string;
    /** A short emphasis line under the sub-line. */
    felt?: string;
    /** Atmosphere treatment: `ember` (default) · `blood` · `still`. */
    bg?: string;
    /**
     * What the hero does with its media: `none` · `image` · `loop` · `click`.
     *
     * NOT named `heroMedia`: that key is already taken by the media PICKER field,
     * whose `key` is only an `{#each}` key because a `control: 'media'` writes the
     * `courses.heroMediaId` column rather than section props. Two field defs
     * sharing a key would collide in the editor's loop.
     *
     * A CONTENT choice, not a design axis — it selects which asset appears, while
     * the `media` axis (`bleed`/`frame`/`mask`/`inset`/`none`) still decides how
     * that asset is shaped. Absent on every page authored before this field, and
     * `resolveMediaMode` deliberately resolves absence to today's appearance.
     */
    mediaMode?: string;
    /**
     * Label for the play affordance on the three compositions that have no plate.
     *
     * Authorable because the hero's clip and the `introVideo` section's film are
     * separate slots pointing wherever the creator aimed them — so a hardcoded
     * "Watch intro" would be a claim about content this section does not own.
     */
    mediaLabel?: string;
  }

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
    /**
     * The course title, when the PAGE has let this section claim it as its heading
     * fallback (`SectionComponentProps.titleFallback`). See `headline` below for why
     * the hero — alone among the five fallback-capable sections — also keeps an
     * unconditional last resort.
     */
    titleFallback?: string;
    /**
     * `1` for the page's first hero, `2` for any later duplicate
     * (`SectionComponentProps.headingLevel`). A page may hold more than one hero
     * (`duplicateSection()`), and two `<h1>`s is a correctness defect rather than a
     * taste one.
     */
    headingLevel?: 1 | 2;
  }

  const {
    config,
    context,
    variant,
    design,
    editable = false,
    onEdit,
    titleFallback,
    headingLevel = 1,
  }: Props = $props();

  const p: HeroCopy = $derived({
    eyebrow: asString(config, 'eyebrow'),
    headline: asString(config, 'headline'),
    accent: asString(config, 'accent'),
    subheadline: asStringFrom(config, aliasKeys('hero', 'subheadline')),
    felt: asString(config, 'felt'),
    ctaLabel: asStringFrom(config, aliasKeys('hero', 'ctaLabel')),
    secondaryLabel: asStringFrom(config, aliasKeys('hero', 'secondaryLabel')),
    secondaryHref: asString(config, 'secondaryHref'),
    trust: asString(config, 'trust'),
    bg: asString(config, 'bg'),
    mediaMode: asString(config, 'mediaMode'),
    mediaLabel: asString(config, 'mediaLabel'),
  });

  const eyebrow = $derived(p.eyebrow ?? context.course.kicker ?? undefined);
  /**
   * THE ONE UNCONDITIONAL COURSE-TITLE FALLBACK LEFT ON THE PAGE, and it is here
   * on purpose.
   *
   * Five sections each fell back to `context.course.title` independently, so an
   * under-authored page served `<h1>Bone Deep</h1>` followed by four
   * `<h2>Bone Deep</h2>`. Four of the five now read a `titleFallback` the page
   * hands to exactly one of them and SELF-HIDE their heading otherwise. The hero
   * cannot: its `<h1>` is the only one on the page, it is not optional, and
   * `words` below splits the headline — an absent one is not renderable at all.
   *
   * What stops it duplicating is at the other end: `claimTitleFallback` gives a
   * heading-less hero the claim WHEREVER it sits on the page, so whenever this
   * fallback fires no other section is printing the title. `titleFallback` is read
   * first anyway, so the two agree by construction rather than by coincidence, and
   * a host that passes nothing still gets a headline rather than a blank stage.
   */
  const headline = $derived(
    p.headline ?? titleFallback ?? context.course.title
  );
  const subheadline = $derived(p.subheadline ?? context.course.lede ?? undefined);

  // ── COMPOSITION ──────────────────────────────────────────────────────────
  // `resolveVariant` has already mapped every retired id forward, so an unknown
  // value here can only come from a client older than the catalogue. Falling back
  // to `stage` keeps such a page rendering its copy rather than nothing.
  const COMPOSITIONS = [
    'stage',
    'split-media',
    'full-bleed',
    'oversized',
    'banner',
    'poster',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'stage'
  );

  // ── AXES READ IN MARKUP ──────────────────────────────────────────────────
  // String discriminants, not booleans: `apps/web` has `strictNullChecks` OFF, so
  // a boolean-literal discriminant does not narrow.
  const motionOff = $derived(design?.motion === 'none');
  const mediaOff = $derived(design?.media === 'none');

  // ── MEDIA: WHERE IT GOES, vs WHETHER THERE IS ANY ────────────────────────
  // Two questions, and conflating them is what confined the hero's media to three
  // of its six compositions. WHERE: `split-media`, `full-bleed` and `poster` have
  // a plate in their layout; `stage`, `oversized` and `banner` do not, so on those
  // the media becomes an invitation in the actions row rather than a backdrop.
  // WHETHER: the authored `heroMedia` mode, gated by the axis.
  //
  // `media: none` stays AUTHORITATIVE over the mode. The axis governs treatment,
  // the field governs content, and a design axis must not be silently overturned
  // by a content choice — so the builder greys the mode control while the axis is
  // `none` and says why, rather than quietly lifting it.
  const plateLed = $derived(
    composition === 'split-media' ||
      composition === 'full-bleed' ||
      composition === 'poster'
  );

  /**
   * `media: bleed` ON A COMPOSITION THAT HAS NO PLATE (contract B5).
   *
   * The axis's own name promises a backdrop, and on `stage` / `oversized` /
   * `banner` it delivered nothing at all: `showPlate` is `plateLed && !mediaOff`,
   * so three of the six compositions could not show media in any treatment. That
   * made `media: bleed` INERT on the catalogue's default composition — and
   * `bleed` is one of only FOUR axes that uniquely identify Candlelit, the one
   * look the page-builder is judged on.
   *
   * WHY THIS AND NOT "THE AXIS PICKS THE COMPOSITION". Making `media` select the
   * layout was the first plan and it is unsafe: the variant is the AUTHOR'S
   * composition, and a page-level look preset would then silently re-lay-out
   * every section it touched. Measured against the real data — three published
   * pages carry a `stage` hero at `media: bleed` (`ancestral-threads`,
   * `return-to-the-shoreline`, `tending-the-grief`) and NONE of them has any hero
   * media, so composition-rewriting would have changed all three pages' layout
   * with no media to justify it. That is exactly the shape change the comment
   * above forbids. Treatment stays the axis's business, composition stays the
   * author's — which is the separation this file already documents.
   *
   * SAFE ON THOSE THREE PAGES BY CONSTRUCTION: the backdrop renders NOTHING
   * unless a still actually resolves, so a page with no hero media is untouched.
   */
  const bleedsBehind = $derived(
    !plateLed && !mediaOff && design?.media === 'bleed'
  );

  const MEDIA_MODES = ['none', 'image', 'loop', 'click'];

  /**
   * The media mode for a resolved preview.
   *
   * The fallback is deliberately "what this page looks like today", not a nicer
   * default. A page authored before this field carries no stored intent, and A33's
   * lesson is that absent or ignored data is not evidence of one — seven live
   * journey pages resolve through this branch and none of them may change shape on
   * deploy.
   */
  const resolveMediaMode = (preview: SellPreview | null | undefined) => {
    if (mediaOff) return 'none';
    if (MEDIA_MODES.includes(p.mediaMode)) return p.mediaMode;
    return preview?.heroImageUrl ? 'image' : 'none';
  };

  /**
   * Whether a resolved preview has footage that can actually play. `heroClip` is
   * OPTIONAL-additive, so an older worker deployment answers `false` here and
   * every playing mode degrades to its still. Callers check the CLIP rather than
   * trusting the mode, because the mode is authored and the clip is a fact.
   */
  const canPlay = (preview: SellPreview | null | undefined) =>
    Boolean(preview?.heroClip?.playlistUrl);

  /** Whether this composition draws a plate at all. `media: none` removes it. */
  const showPlate = $derived(plateLed && !mediaOff);

  /**
   * The resolved sell preview, mirrored into state.
   *
   * The plate consumes `context.sellPreview` directly through `{#await}`, so it
   * streams and costs no layout shift. Three things OUTSIDE that block need the
   * same resolved value: the modal's `src`, the play affordance, and whether the
   * atmosphere should recede. Awaiting again would wrap three pieces of non-media
   * markup in their own `{#await}` blocks, so it is mirrored here once.
   *
   * Null on the server, deliberately. That keeps the SSR baseline identical to
   * today's — full atmosphere, no affordance — and a button whose only job is to
   * open a JS modal is worth nothing without JS, so rendering it only once the
   * client has resolved is the honest behaviour rather than a limitation.
   */
  let resolvedPreview = $state<SellPreview | null>(null);

  $effect(() => {
    let alive = true;
    context.sellPreview
      .then((v) => {
        if (alive) resolvedPreview = v ?? null;
      })
      .catch(() => {
        if (alive) resolvedPreview = null;
      });
    return () => {
      alive = false;
    };
  });

  let introOpen = $state(false);

  const mediaMode = $derived(resolveMediaMode(resolvedPreview));
  const clipUrl = $derived(resolvedPreview?.heroClip?.playlistUrl ?? '');

  /**
   * Real media is on screen, so the synthetic atmosphere yields to it.
   *
   * Only true for the modes that actually PAINT something (`image`, `loop`), and
   * only where there is somewhere for them to paint — which since B5 is a plate
   * OR a `media: bleed` backdrop. A `click` affordance still leaves the ember
   * doing all the work, because an invitation in the actions row paints no
   * footage.
   *
   * `bleedsBehind` BELONGS HERE, and leaving it out was the first version's bug:
   * the backdrop would have put a photograph behind the copy while the ember
   * bloom stayed at full strength on top of it, which is precisely the
   * competition the `.hero--media-present` dimming exists to prevent. The
   * comment this replaces said a plate-less hero "leaves the ember doing all the
   * work" — true when a plate-less hero could not show media at all, and no
   * longer true now that one can.
   */
  const mediaPresent = $derived(
    (showPlate || bleedsBehind) &&
      (mediaMode === 'image' || mediaMode === 'loop') &&
      Boolean(resolvedPreview?.heroImageUrl || clipUrl)
  );

  /**
   * The plate-less compositions OFFER the film instead of showing it.
   *
   * `loop` lands here too, and that is the point: a plate-less composition has
   * nowhere to loop footage, so the author's intent to feature a video becomes
   * an invitation rather than being silently dropped.
   *
   * EXCEPT AT `media: bleed` SINCE B5, where it now does have somewhere — the
   * backdrop. A looping backdrop plus an "watch the film" invitation is the same
   * film offered twice, so the invitation stands down for `loop` specifically.
   * `click` keeps it: there the backdrop is a still and the invitation is the
   * only way to reach the film.
   */
  const showWatch = $derived(
    !mediaOff &&
      !plateLed &&
      Boolean(clipUrl) &&
      (mediaMode === 'loop' || mediaMode === 'click') &&
      !(bleedsBehind && mediaMode === 'loop')
  );

  /** Authored, because this section does not own what the creator pointed it at. */
  const watchLabel = $derived(p.mediaLabel ?? m.journey_hero_media_play());

  // The scroll cue points BELOW the fold, so it is meaningless on the two
  // compositions that do not fill the viewport, and it is continuous decoration,
  // so `motion: none` removes it (this is half of what the retired `minimal`
  // variant did).
  const showCue = $derived(
    !motionOff && (composition === 'stage' || composition === 'full-bleed')
  );

  // `oversized` and `banner` deliberately drop the sub-line into a compact meta
  // row instead of giving it its own block — the headline is the whole pitch.
  const compactCopy = $derived(
    composition === 'oversized' || composition === 'banner'
  );

  // Split the (dynamic) headline into words so each can animate in on a stagger —
  // the kinetic signature. Pure + SSR-safe; the baseline renders the words inline
  // with no motion. Skipped when `editable`, because a contenteditable node cannot
  // be a bag of spans.
  const words = $derived(headline.split(/\s+/).filter((w) => w.length > 0));

  // CTA branches on the viewer's enrolment (the sales page is otherwise fully
  // public): an enrolled member goes to their dashboard; everyone else is sent
  // to the offer/checkout surface to join.
  const ctaHref = $derived(
    context.enrolled ? context.dashboardUrl : context.checkoutUrl
  );
  const ctaLabel = $derived(
    context.enrolled
      ? m.journey_hero_cta_enrolled()
      : (p.ctaLabel ?? m.journey_hero_cta_default())
  );

  /**
   * NO BUY BUTTON WHERE THERE IS NOTHING TO BUY.
   *
   * The hero's CTA is the first and largest thing a visitor sees, and it pointed
   * at `/journeys/<slug>/checkout` whatever the course's offer said — so on a
   * course with no purchasable path it sold a full-viewport promise into
   * "<Course> isn't open for enrolment just now. Back to the journey →". Measured
   * in the dev database: five of the seven published journey pages are in exactly
   * that state (`price_cents IS NULL`, no subscription plan, no tier grant).
   *
   * `!== false`, NOT `!context.purchasable` — see the field's contract in
   * `../types.ts`: absent means "unknown", and unknown keeps the sell state, so a
   * `.catch()`-ed offer read or a host that cannot know never blanks the CTA.
   * An enrolled member always keeps it: their target is the dashboard, which does
   * not depend on the offer at all.
   */
  const showPrimaryCta = $derived(
    context.enrolled || context.purchasable !== false
  );

  /**
   * Whether the actions row has anything left to hold. `.hero__actions` is a
   * flex row inside a gapped column, so an empty one would still consume a gap
   * and a staggered entrance animation — a visible hole where the CTA was.
   *
   * The secondary link and the watch affordance survive the suppression on
   * purpose: neither is transactional, so a page with nothing to sell can still
   * offer its film and its authored side-door.
   */
  const hasActions = $derived(
    showPrimaryCta ||
      Boolean(p.secondaryLabel && p.secondaryHref) ||
      showWatch
  );

  // Decorative motes — count only; per-mote geometry lives in CSS (nth-child).
  const MOTE_COUNT = 12;
  const motes = Array.from({ length: MOTE_COUNT });

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
    editFieldAttrs('hero', key, editable, onEdit);

  let mounted = $state(false);
  let reduced = $state(false);

  // Motion is layered only once JS confirms it is welcome; otherwise the static
  // composed baseline above is what the viewer keeps.
  const enhanced = $derived(mounted && !reduced);

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
</script>

<!--
  The media plate. Renders the creator's hero still once the STREAMED sell-preview
  resolves, and the synthetic gradient plate before that and instead of it.

  The plate doubles as the pending state deliberately: it occupies exactly the same
  box as the image, so a slow media resolution costs no layout shift and needs no
  separate skeleton. `heroImageUrl` is null for a course with no hero media picked,
  which is the common case — see contract A32 for why picking one currently means
  uploading a VIDEO and accepting its poster frame.
-->
{#snippet plate()}
  <div class="hero__media">
    {#await context.sellPreview}
      <span class="hero__plate" aria-hidden="true"></span>
    {:then preview}
      {@const mode = resolveMediaMode(preview)}
      {@const clip = preview?.heroClip ?? null}
      {@const still = preview?.heroImageUrl ?? clip?.posterUrl ?? null}
      {#if mode === 'none'}
        <span class="hero__plate" aria-hidden="true"></span>
      {:else if mode === 'loop' && canPlay(preview)}
        <HeroLoopVideo src={clip.playlistUrl} posterUrl={still} />
      {:else if still}
        <!--
          THE LCP ELEMENT on `full-bleed`, `split-media` and `poster`.
          `fetchpriority="high"` is the half of the fix that lives in this file: the
          still otherwise competes with the 12 decorative motes, the Google Fonts
          stylesheet and every below-the-fold asset for bandwidth.

          The OTHER half is not fixable here — the URL arrives on the STREAMED
          `sellPreview` promise, so its discovery is gated on a second worker
          round-trip that only begins after the shell flushes, and `<svelte:head>`
          cannot preload a URL it does not have yet. That needs `heroImageUrl` on
          the AWAITED `JourneyCourseView` (the org-landing page preloads its own
          hero exactly that way), which crosses into `journey-queries.ts`,
          `@codex/shared-types`, `CourseJourneyService` and the public route's head
          — all outside this tree. Handed off, not silently skipped.

          `aspect-ratio: var(--jp-media-aspect)` on `.hero__media` already reserves
          the box, so this is an LCP problem and never was a CLS one.
        -->
        <img
          class="hero__img"
          src={still}
          alt=""
          decoding="async"
          fetchpriority="high"
        />
      {:else}
        <span class="hero__plate" aria-hidden="true"></span>
      {/if}
      {#if mode === 'click' && canPlay(preview)}
        <!-- On a plate-led composition the invitation sits ON the media, over
             the scrim, rather than in the actions row. -->
        <button
          class="hero__play"
          type="button"
          aria-label={m.journey_hero_media_play_aria()}
          onclick={() => (introOpen = true)}
        >
          <PlayIcon size="1.5rem" />
        </button>
      {/if}
    {:catch}
      <span class="hero__plate" aria-hidden="true"></span>
    {/await}
    <span class="hero__scrim" aria-hidden="true"></span>
  </div>
{/snippet}

<!--
  The `media: bleed` backdrop for the three plate-less compositions (B5).

  DELIBERATELY NOT the `plate()` snippet: that one always renders something — the
  synthetic `.hero__plate` — on every branch, which is right for an in-flow plate
  reserving its box and wrong for a decorative backdrop. Behind the copy, an empty
  plate is a painted grey rectangle nobody asked for, and it would have appeared
  on three published pages. So this renders only when a still RESOLVES.

  No pending branch for the same reason: `aspect-ratio` reserves the box for an
  in-flow plate, but an absolutely-positioned backdrop takes no layout, so there
  is no CLS to guard and a skeleton would only flash.

  `--jp-media-scrim` is real at `bleed` — `linear-gradient(to top, var(--jp-ink),
  transparent 62%)` — so the copy keeps a contrast floor over any frame. It is
  `none` on the other four media values, which is why only `bleed` reads text
  over media.
-->
{#snippet backdrop()}
  {#await context.sellPreview then preview}
    {@const mode = resolveMediaMode(preview)}
    {@const clip = preview?.heroClip ?? null}
    {@const still = preview?.heroImageUrl ?? clip?.posterUrl ?? null}
    {#if mode === 'loop' && canPlay(preview)}
      <!-- `loop` LOOPS here. Rendering the poster instead would silently demote
           the author's video to a still, which is the exact failure the
           plate-less watch-invitation was built to avoid — and a caught one: the
           first version of this snippet rendered `still` for every mode, and
           `HeroSection.svelte.test.ts` failed on `loop`. -->
      <div class="hero__media hero__media--backdrop">
        <HeroLoopVideo src={clip.playlistUrl} posterUrl={still} />
        <span class="hero__scrim" aria-hidden="true"></span>
      </div>
    {:else if mode !== 'none' && still}
      <div class="hero__media hero__media--backdrop">
        <img class="hero__img" src={still} alt="" decoding="async" />
        <span class="hero__scrim" aria-hidden="true"></span>
      </div>
    {/if}
  {/await}
{/snippet}

<!--
  ONE `<h1>` PER PAGE, EVEN WHEN A PAGE HOLDS TWO HEROES.

  `duplicateSection()` clones a section with the same type, and the seeded golden
  page proved that is not theoretical — it served two `id="ache"` (`Codex-yxkj7`).
  Two heroes therefore served two `<h1>`s, and `hero` is the only one of the eleven
  sections that emits one. `headingLevel` arrives as `2` for any section that is not
  the first of its type, so a duplicate demotes to `<h2>`. The class list and the
  kinetic word split are untouched — this is the OUTLINE only, not the type scale,
  which is the `type` axis's job.

  A DEMOTION, NOT A DROP: an author who duplicated a hero must still be able to see
  and delete it. The publish-time answer to "you have two heroes" is
  `validatePageShape`'s `multiple-hero` error, which the builder's publish action
  now blocks on. The demotion is still what keeps the outline valid on pages
  ALREADY published with two heroes, and on any page written straight through the
  API — nothing server-side reads that validator.
-->
{#snippet headlineNode()}
  <svelte:element
    this={headingLevel === 2 ? 'h2' : 'h1'}
    class="jp-sec__heading hero__headline"
  >
    <!-- The kinetic word split is skipped when editable: a contenteditable node
         cannot be a bag of spans without the caret fighting the re-render. -->
    {#if editable}
      <span {...editAttrs('headline')}>{headline}</span>
    {:else}
      {#each words as word, i (i)}
        <span class="hero__word" style="--word-i: {i}">{`${word} `}</span>
      {/each}
    {/if}{#if p.accent}&nbsp;<span
        class="hero__accent"
        {...editAttrs('accent')}>{p.accent}</span
      >{/if}
  </svelte:element>
{/snippet}

{#snippet actions()}
  {#if hasActions}
    <div class="hero__actions">
      {#if showPrimaryCta}
        <CtaLink href={ctaHref} variant="primary" size="lg">
          {ctaLabel}
        </CtaLink>
      {/if}
      {#if p.secondaryLabel && p.secondaryHref}
        <CtaLink href={p.secondaryHref} variant="secondary" size="lg">
          {p.secondaryLabel}
        </CtaLink>
      {/if}
      {#if showWatch}
        <button
          class="hero__watch"
          type="button"
          onclick={() => (introOpen = true)}
        >
          <PlayIcon size="1rem" />
          <span>{watchLabel}</span>
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet trustNode()}
  {#if p.trust}
    <p class="hero__trust">
      <span class="hero__trust-dot" aria-hidden="true"></span>
      <span {...editAttrs('trust')}>{p.trust}</span>
    </p>
  {/if}
{/snippet}

{#snippet lead()}
  {#if eyebrow}
    <p class="jp-sec__eyebrow hero__eyebrow" {...editAttrs('eyebrow')}>
      {eyebrow}
    </p>
  {/if}

  {@render headlineNode()}
{/snippet}

{#snippet copy()}
  {#if !compactCopy}
    {@render lead()}
    {#if subheadline}
      <p class="jp-sec__measure hero__sub">
        <span {...editAttrs('sub')}>{subheadline}</span>{#if p.felt}<span
            class="hero__felt"
            {...editAttrs('felt')}>{p.felt}</span
          >{/if}
      </p>
    {/if}

    {@render actions()}
    {@render trustNode()}
  {:else}
    <!-- `banner` lays `.hero__inner` out as a two-column grid, so the lead copy has
         to be ONE grid item. Emitting eyebrow / headline / meta as three siblings
         put the headline in column two and the meta on a second row. -->
    <div class="hero__col">{@render lead()}</div>
    <div class="hero__meta">
      {#if subheadline}
        <p class="hero__sub hero__sub--meta">
          <span {...editAttrs('sub')}>{subheadline}</span>
        </p>
      {/if}
      {@render actions()}
      {@render trustNode()}
    </div>
  {/if}
{/snippet}

<!--
  THE SIX MIRRORED AXES, and why they are attributes on THIS element rather than
  reads of the ancestor's.

  Six of the nine axes have to be SELECTED ON, not merely read: an axis value can
  change which shapes exist (a pill versus a square corner), which face a label is
  set in, whether a rule is drawn — none of which is expressible as a value
  substituted into one declaration. A Svelte-scoped stylesheet cannot reach
  `.jp-sec[data-jp-*]` on the ancestor, so the resolved `design` prop is mirrored
  onto the section's own root under a `data-hero-*` namespace and selected there.
  `IntroVideoSection`'s `data-iv-overlay` is the same move.

  A SEPARATE NAMESPACE, deliberately. Re-using `data-jp-*` here would make every
  bare `[data-jp-surface='panel']` rule in `journey-design.css` match this element
  too and re-declare `--jp-ink` one level further down — idempotent today and a
  silent trap the first time one of those rules stops being idempotent.

  Absent when a host passes no `design`: Svelte omits an `undefined` attribute, so
  every look rule below simply does not match and the section renders its base.
-->
<header
  class="hero"
  class:hero--enhanced={enhanced}
  class:hero--still={motionOff}
  class:hero--media-present={mediaPresent}
  data-hero={composition}
  data-hero-bg={p.bg || 'ember'}
  data-hero-surface={design?.surface}
  data-hero-edge={design?.edge}
  data-hero-align={design?.align}
  data-hero-type={design?.type}
  data-hero-accent={design?.accent}
  data-hero-motion={design?.motion}
>
  <div class="hero__atmos" aria-hidden="true">
    <div class="hero__glow"></div>
    <div class="hero__motes">
      {#each motes as _, i (i)}
        <span class="hero__mote"></span>
      {/each}
    </div>
    <div class="hero__vignette"></div>
  </div>

  {#if bleedsBehind}
    {@render backdrop()}
  {/if}

  {#if composition === 'full-bleed' && showPlate}
    {@render plate()}
  {/if}

  {#if composition === 'split-media' && showPlate}
    <div class="hero__inner">
      <div class="hero__col">{@render copy()}</div>
      {@render plate()}
    </div>
  {:else if composition === 'poster' && showPlate}
    <div class="hero__inner">
      {@render plate()}
      <div class="hero__col">{@render copy()}</div>
    </div>
  {:else}
    <div class="hero__inner">{@render copy()}</div>
  {/if}

  {#if clipUrl}
    <IntroVideoModal
      open={introOpen}
      src={clipUrl}
      title={headline}
      onclose={() => (introOpen = false)}
    />
  {/if}

  {#if showCue}
    <!-- Scroll cue: a light descending a hairline. Enhancement-only + decorative. -->
    <div class="hero__cue" aria-hidden="true">
      <span class="hero__cue-line"><span class="hero__cue-spark"></span></span>
      <ChevronDownIcon class="hero__cue-chevron" size="1rem" />
    </div>
  {/if}
</header>

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX

     Every value here is an axis read. `--jp-sec-pad-block` / `--jp-sec-pad-inline`
     / `--jp-sec-gap` are the shared role aliases declared once in
     `journey-design.css`; they contain `cqw`, so they MUST be consumed on a
     descendant of `.jp-sec` (an element is not its own query container). `.hero`
     is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    justify-content: center;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    overflow: hidden;
    text-align: var(--jp-text-align);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
  }

  /* THE STAGE HEIGHT, on the `density` axis.

     `min(100svh, 80svh × rhythm)` rather than a bare multiplication, and both
     halves are deliberate. The multiplication is what makes `density` mean
     something on a viewport-tall section — `compact` gives 60svh, which is the
     shorter stage the retired `minimal` variant had. The cap is what stops
     `vast` (1.6) asking for 128svh: a hero taller than the viewport hides its own
     CTA, so the axis may make the stage shorter but never taller than the screen.

     80svh is solved backwards from Candlelit, whose `density: airy` (1.25) must
     land on exactly the 100svh this section shipped before the axes existed.

     `--jp-stage-vh` RATHER THAN A BARE `svh`, which is the handoff
     `journey-design.css` names this file for by line number. `svh` resolves
     against the browser viewport and cannot be told not to, so inside the
     builder's fixed-width device frame a `100svh` hero was as tall as the STUDIO
     WINDOW — measured 373 × 900, aspect 0.414, where a real phone gives 0.462.
     The canvas could not preview the aspect of four of this section's six
     compositions. `--jp-stage-vh` is `var(--jp-device-vh, 1svh)`, and nothing
     sets `--jp-device-vh` on a published page, so PUBLIC OUTPUT IS UNCHANGED:
     `calc(100 * 1svh)` is `100svh` and `calc(80 * 1svh * 1.25)` is the same
     `100svh` Candlelit shipped.

     The `vh` line is the fallback for engines without `svh` — it must stay a
     literal `vh`, because a browser that cannot parse `svh` invalidates the whole
     `--jp-stage-vh` chain at computed-value time and would fall through to no
     min-height at all. `banner` and `poster` are content-height by design. */
  .hero[data-hero='stage'],
  .hero[data-hero='split-media'],
  .hero[data-hero='full-bleed'],
  .hero[data-hero='oversized'] {
    min-height: min(100vh, calc(80vh * var(--jp-rhythm)));
    min-height: min(
      calc(100 * var(--jp-stage-vh)),
      calc(80 * var(--jp-stage-vh) * var(--jp-rhythm))
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ATMOSPHERE — all decorative, behind content.

     ONE `--jp-sec-atmos` GATE, ON THE WRAPPER. Research §2.3 specifies the gate
     as a multiplier on each layer's own opacity; applying it to the shared parent
     instead is both smaller and more correct, because `.hero__glow`'s opacity is
     ANIMATED (`hero-breathe`) and a keyframe would win over any `calc()` on the
     element itself. On the parent the two compose multiplicatively, so the glow
     keeps breathing inside `surface: media` and resolves to zero everywhere else
     with the markup left mounted.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
  }

  /* Real footage carries the mood, so the synthetic ember yields rather than
     competing with it.

     Composed as a MULTIPLIER on `--jp-sec-atmos` rather than replacing it, so the
     `surface` axis keeps the final say: a section that gates its atmosphere to
     zero stays at zero here too. The markup stays mounted either way, which is
     the same reason the gate is an opacity and not an `{#if}` — a late-resolving
     streamed preview must cost no layout shift. */
  .hero--media-present .hero__atmos {
    opacity: calc(var(--jp-sec-atmos, 1) * 0.4);
  }

  /* The invitation ON the media — plate-led compositions in `click` mode. Sits
     above the scrim so it stays legible over any frame.

     `--tap-target-min`, NOT `--space-8`, and this is a measured defect rather
     than a taste change: `--space-8` is `calc(--space-unit * 8)` = 32px at
     density 1 and SMALLER under an org density below 1, so the only pointer
     target in the media plate shipped at 32 × 32 against WCAG 2.5.5's 44px.
     `--tap-target-min` is `max(2.75rem, var(--space-11))` (contract A2), so a
     brand density may only ever make it larger. This is the one change in the
     file that is not keyed on an axis, so it reaches Candlelit too — a 32 → 44px
     play button on a `click`-mode plate, reported rather than hidden. */
  .hero__play {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    z-index: 2;
    display: grid;
    place-items: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    border: 0;
    border-radius: var(--hero-control-radius, var(--radius-full));
    background: var(--color-surface);
    color: var(--color-heading);
    cursor: pointer;
    transform: translate(-50%, -50%);
    transition: var(--transition-transform);
  }

  .hero__play:hover {
    transform: translate(-50%, -50%) scale(1.06);
  }

  .hero__play:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  /* The invitation IN the actions row — the three plate-less compositions.
     Deliberately third-tier: it sits beside the CTAs without competing, because
     the conversion path is the CTA and watching a film is a detour from it.

     `min-height: var(--tap-target-min)` for the same WCAG 2.5.5 reason as
     `.hero__play` above: `--space-2` padding either side of `--text-sm` is a
     ~34px target, and this one sits in the actions row NEXT TO a CtaLink that
     already declares the floor, so it was also visibly the odd one out. */
  .hero__watch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-target-min);
    padding: var(--space-2) var(--space-3);
    border: var(--hero-control-border, 0);
    border-radius: var(--hero-control-radius, var(--radius-sm));
    background: none;
    font-family: var(--hero-label-font, var(--font-body));
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
    box-shadow: var(--hero-control-shadow, none);
    transition: var(--transition-colors);
  }

  .hero__watch:hover {
    color: var(--color-heading);
  }

  .hero__watch:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Reduced motion: the hover growth is decoration, and the loop backdrop has
     already declined to construct itself (see HeroLoopVideo). */
  @media (prefers-reduced-motion: reduce) {
    .hero__play:hover {
      transform: translate(-50%, -50%);
    }
  }

  /* Breathing warm core — the "living light" behind the headline.

     Colour comes from `--jp-accent-fill`, the `accent` axis's indirection over the
     ember. On a journey page `--jp-ember` IS `--color-brand-primary`, so at
     `accent: glow`/`fill` this paints the identical colour the section painted
     before the axes; at `accent: none` it resolves to `--jp-ink-4`, a near-ink
     neutral, and the glow disappears without a second rule. That is what makes
     the retired `minimal` variant's glow-less stage reachable as an axis value.

     `--jp-accent-glow` is the axis's own bloom (a box-shadow, `none` on every
     value except `glow`), which restores a second brand hue that the axis owns
     rather than one read straight off `--color-brand-accent`. */
  .hero__glow {
    position: absolute;
    left: 50%;
    top: 40%;
    width: min(92cqw, 48.75rem);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    opacity: var(--hero-glow-rest, 0.55);
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--jp-accent-fill) 24%, transparent),
      color-mix(in oklab, var(--jp-accent-fill) 14%, transparent) 46%,
      transparent 70%
    );
    box-shadow: var(--jp-accent-glow);
  }

  /* Slow rising embers — hidden in the baseline (they only read while moving). */
  .hero__motes {
    position: absolute;
    inset: 0;
    overflow: hidden;
    display: none;
  }

  .hero__mote {
    position: absolute;
    bottom: calc(var(--space-3) * -1);
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    opacity: 0;
    /* Brightened toward `--color-heading`, not toward white. `--color-heading` is
       the palette's CONTRAST pole, so the mote lifts away from the page on a dark
       ink and darkens away from it on a light one; a literal `white` only worked
       on the dark pole.

       `--jp-accent-mark`, the role that now EXISTS — this file's older comment
       asking for it is stale (`journey-design.css:149`). It is the same value as
       `--jp-accent-text` on four of the five accent values, and differs only at
       `accent: edge`, where `--jp-accent-text` is the plain `--jp-text` and a
       brand-coloured mark is what the syllabus look wants. At `accent: glow`
       both resolve to `--jp-ember-text`, so Candlelit's motes are the same
       pixels. */
    background: radial-gradient(
      circle,
      color-mix(in oklab, var(--jp-accent-mark) 92%, var(--color-heading)),
      color-mix(in oklab, var(--jp-accent-mark) 20%, transparent) 70%
    );
    box-shadow: 0 0 var(--blur-sm)
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
  }

  /* Edge vignette to focus the centre and blend into the next section.
     Theme-aware: darkens toward the page background (subtle on light themes). */
  .hero__vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      125% 95% at 50% 42%,
      transparent 55%,
      color-mix(in oklab, var(--color-background) 58%, transparent) 100%
    );
  }

  /* `bg` — the authored atmosphere treatment (`hero.bg`), composed WITH the axes
     rather than competing with them: it only ever sets the glow's own recipe, and
     `--jp-sec-atmos` still gates whether any of it is visible.

     `still` is frankly an axis in disguise — it is `motion: none` plus a dimmer
     accent — and is reported as a collapse candidate. It is honoured here because
     the field exists and pages store it. */
  .hero[data-hero-bg='blood'] .hero__glow {
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--jp-accent-fill) 40%, transparent),
      color-mix(in oklab, var(--jp-accent-fill) 22%, var(--color-background)) 48%,
      transparent 72%
    );
  }

  .hero[data-hero-bg='still'] .hero__glow {
    --hero-glow-rest: 0.32;
    --hero-glow-lo: 0.32;
    --hero-glow-hi: 0.32;
    filter: blur(var(--blur-2xl));
    animation: none;
  }

  .hero[data-hero-bg='still'] .hero__motes {
    display: none;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONTENT
     ═══════════════════════════════════════════════════════════════════════ */
  /* `--hero-block-gap` defaults to the shared `--jp-sec-gap` alias, so density
     still governs the rhythm here; a look that needs conspicuously more or less
     air than its density value alone gives it MULTIPLIES onto that alias rather
     than replacing it, which keeps the org's own `--brand-density-scale` in the
     chain (`--jp-sec-gap` → `--space-6` → `--space-unit`). */
  .hero__inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: var(--hero-block-gap, var(--jp-sec-gap));
    width: 100%;
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* `width: 100%` matters in the FLEX compositions. As a flex item in a column
     flex container with `align-items: center` the column shrinks to its content, so
     `oversized`'s headline was capped at the text's own width rather than the 24ch
     its composition grants it. A no-op in the grid compositions, where the cell
     already sizes it. */
  .hero__col {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: var(--hero-block-gap, var(--jp-sec-gap));
    width: 100%;
    min-width: 0;
  }

  /* The eyebrow, display heading and measure recipes come from the shared atoms
     in `journey-sections-shared.css` (`.jp-sec__eyebrow`, `.jp-sec__heading`,
     `.jp-sec__measure`), which is where the `type`, `align` and `width` axes
     actually land. What is left here is only what is specific to this section. */
  /* THE HEADLINE CAP IS A PROPERTY, NOT A LITERAL, and the indirection is what
     keeps composition and look from fighting over specificity. A composition
     declares `--hero-headline-max` ON THIS ELEMENT (`oversized`, `banner`); a
     look declares it on `.hero` and it arrives by inheritance. A declaration on
     the element itself always beats an inherited one whatever the selectors
     weigh, so the precedence is composition > look by construction rather than
     by counting attribute selectors — which is the trap a look rule at (0,3,0)
     would otherwise set for `banner`'s (0,2,0) `max-width: none`.

     16ch is Candlelit's cap, and it stays the fallback so a section with no look
     rule and no composition rule is byte-identical to before. */
  .hero__headline {
    max-width: var(--hero-headline-max, 16ch);
    margin-inline: var(--jp-measure-margin);
  }

  /* Baseline: plain inline words. Enhancement upgrades to inline-block + stagger. */
  .hero__word {
    white-space: pre;
  }

  /* The authored italic accent closing the headline. `--jp-accent-text` — never
     `--jp-ember`, which measures 2.04:1 as text in dark (research §5.1). */
  .hero__accent {
    font-style: italic;
    color: var(--jp-accent-text);
  }

  /* THE SUB-LINE IS THE `type` AXIS'S BODY RUNG, and it is a property for a
     narrower reason than the headline above: the axis's own `--jp-body-size`
     resolves to 24px at `type: monumental`, a 33% jump on the `--text-lg` every
     published page ships, so wiring it directly would resize Candlelit's
     sub-line. The looks that want a different body rung set it explicitly
     instead, and `--text-lg` stays the value for anything that does not. */
  .hero__sub {
    margin: 0;
    font-size: var(--hero-sub-size, var(--text-lg));
    line-height: var(--hero-sub-leading, var(--leading-relaxed));
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  /* The authored emphasis line under the sub-line: same block, lifted colour. */
  .hero__felt {
    display: block;
    margin-top: calc(var(--space-2) * var(--jp-rhythm));
    color: var(--color-heading);
  }

  .hero__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: var(--jp-align);
    gap: var(--space-3);
  }

  .hero__trust {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  /* `--jp-accent-mark`, NOT `--jp-accent-fill`, and the same for the mote and the
     cue spark. `--jp-accent-fill` resolves to `transparent` on `accent: text` and
     `accent: edge` — correct for a CTA fill, fatal for a small decorative MARK,
     which simply disappears on two of the five values. The WT-3 pilot reported
     that gap and `journey-design.css` now ships `--jp-accent-mark` to close it:
     always a real colour, tracking the AA-safe `--jp-ember-text` where the value
     tints anything and neutralising to `--jp-heading` at `accent: none`. The
     shape is a property so a look whose tell forbids a round corner can square
     it (plain-facts) without a second declaration of the colour. */
  .hero__trust-dot {
    flex: none;
    width: var(--hero-dot-size, var(--space-2));
    height: var(--hero-dot-size, var(--space-2));
    border-radius: var(--hero-dot-radius, var(--radius-full));
    background: var(--jp-accent-mark);
    box-shadow: 0 0 0 var(--space-1)
      color-mix(in oklab, var(--jp-accent-mark) 22%, transparent);
  }

  /* The one compact row `oversized` and `banner` put beneath the headline. */
  .hero__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: var(--jp-align);
    gap: var(--space-3) var(--jp-sec-gap);
  }

  .hero__sub--meta {
    max-width: var(--jp-measure);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MEDIA — every dimension from the `media` axis.

     The plate is the resting state AND the pending state: a course with no hero
     media picked (the common case — A32) keeps the synthetic gradient, and so does
     a slow or failed stream, with no layout shift between them.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero__media {
    position: relative;
    display: var(--jp-media-display);
    overflow: hidden;
    aspect-ratio: var(--jp-media-aspect);
    padding: var(--jp-media-inset);
    border-radius: var(--jp-media-radius);
    clip-path: var(--jp-media-mask);
  }

  .hero__img,
  .hero__plate {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  /* The synthetic plate, ported from the canvas `.jp-hero--split .jp-hero__media`.
     Its border and elevation are what give it presence as an OBJECT rather than a
     faint rectangle — without them a course with no hero media (the common case)
     reads as a rendering fault. The border is accent-owned so `accent: none`
     neutralises it; the elevation is the design system's own token, because the
     canvas spelled it `0 24px 60px -28px black`, and a literal black shadow is
     invisible on a dark page and too heavy on a cream one. */
  .hero__plate {
    border: var(--hero-plate-border-width, var(--border-width)) solid
      var(
        --hero-plate-border-color,
        color-mix(in oklab, var(--jp-accent-edge) 45%, transparent)
      );
    box-shadow: var(--hero-plate-shadow, var(--shadow-xl));
    background: var(
      --hero-plate-bg,
      radial-gradient(
        120% 120% at 40% 15%,
        color-mix(in oklab, var(--jp-accent-fill) 44%, var(--color-surface)),
        var(--color-background)
      )
    );
  }

  /* The scrim layer, which is `none` on four of the five `media` values. The
     compositions that put TEXT over the media add their own mandatory floor on
     top of it — see `full-bleed`. */
  .hero__scrim {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: var(--jp-media-scrim);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION · split-media — copy column beside a media panel.
     Ported from the canvas `.jp-hero--split` (contract A12) and generalised:
     the 1.05fr/0.95fr split and the 420px collapse are the canvas's, the panel's
     shape is now the `media` axis's.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero[data-hero='split-media'] .hero__inner {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    align-items: center;
    gap: calc(var(--jp-sec-gap) * 2);
    max-width: max(var(--jp-content-max), 64rem);
  }

  /* THE PANEL FILLS ITS CELL, and both declarations are load-bearing.

     `align-self: stretch` overrides the grid's `align-items: center` for this one
     item, so the row height (set by the copy column) gives the panel a DEFINITE
     height — at which point `aspect-ratio` is ignored, which is what we want here.
     Without it `media: bleed`'s 21/9 makes a 200px letterbox sliver beside a 700px
     column.

     `width: 100%` is the guard rail. `aspect-ratio` resolves in whichever direction
     has a definite size, so a panel given only a height computes its WIDTH from the
     ratio — measured at 1658px inside a 458px grid column, clipped by the section's
     `overflow: hidden` and therefore invisible rather than obviously broken.

     Consequence, stated plainly: in `split-media` the `media` axis governs radius,
     mask, inset and scrim but NOT aspect — the column height does. The aspect
     governs again below, where the panel stacks. */
  .hero[data-hero='split-media'] .hero__media {
    width: 100%;
    align-self: stretch;
  }

  @container (max-width: 48rem) {
    .hero[data-hero='split-media'] .hero__inner {
      grid-template-columns: 1fr;
    }
    /* Stacked: media first, and the axis aspect governs again — capped squarer
       than a 21/9 letterbox, which is unreadable as a full-width band on a phone.
       `align-self: auto` hands the height back to `aspect-ratio`. */
    .hero[data-hero='split-media'] .hero__media {
      order: -1;
      align-self: auto;
      aspect-ratio: min(var(--jp-media-aspect), 16 / 10);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION · full-bleed — media fills the section, copy sits over a scrim.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero[data-hero='full-bleed'] .hero__media {
    position: absolute;
    inset: 0;
    z-index: 0;
    aspect-ratio: auto;
    border-radius: 0;
    clip-path: none;
  }

  /* THE MANDATORY SCRIM (research §5.1: "Text over media — scrim mandatory").

     `--jp-media-scrim` is `none` on four of the five `media` values, so a creator
     who sets `media: frame` on a composition that puts text over an image would
     otherwise get white-on-photo. The axis scrim composes ON TOP of a floor the
     composition owns: `none` is a valid `background-image` layer, so when the axis
     ships no scrim the floor is still there, and when it ships `bleed`'s the two
     stack. This is a gap in the axis model, reported rather than worked around. */
  /* `media: bleed` behind a plate-less composition (B5). The same backdrop
     geometry `full-bleed` gives its plate, applied to a layer that only exists
     when a still resolved. `padding` and `clip-path` are zeroed explicitly
     rather than relying on `bleed`'s own `--jp-media-inset: 0px` /
     `--jp-media-mask: none`, so this stays a backdrop even if a section ever
     re-points those tokens. */
  .hero__media--backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    aspect-ratio: auto;
    border-radius: 0;
    padding: 0;
    clip-path: none;
  }
  .hero[data-hero='full-bleed'] .hero__scrim,
  .hero__media--backdrop .hero__scrim {
    background-image: var(--jp-media-scrim),
      linear-gradient(
        to top,
        color-mix(in oklab, var(--color-background) 92%, transparent),
        color-mix(in oklab, var(--color-background) 64%, transparent) 58%,
        color-mix(in oklab, var(--color-background) 40%, transparent)
      );
  }

  .hero[data-hero='full-bleed'] .hero__inner {
    z-index: 1;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION · oversized — the headline IS the hero.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero[data-hero='oversized'] .hero__headline {
    /* Wider than the default 16ch cap so the display size is the constraint. */
    --hero-headline-max: 24ch;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION · banner — one short row, no stage height.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero[data-hero='banner'] .hero__inner {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--jp-sec-gap) calc(var(--jp-sec-gap) * 2);
    max-width: max(var(--jp-content-max), 64rem);
  }

  .hero[data-hero='banner'] .hero__meta {
    justify-content: end;
  }

  .hero[data-hero='banner'] .hero__headline {
    --hero-headline-max: none;
  }

  @container (max-width: 48rem) {
    .hero[data-hero='banner'] .hero__inner {
      grid-template-columns: 1fr;
    }
    .hero[data-hero='banner'] .hero__meta {
      justify-content: var(--jp-align);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION · poster — a framed plate with the copy set beneath it.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero[data-hero='poster'] .hero__inner {
    gap: calc(var(--jp-sec-gap) * 1.5);
  }

  .hero[data-hero='poster'] .hero__media {
    width: 100%;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FOCUS — rule R14, and the floor `edge: none` / `edge: soft` may not remove.
     `:global` because the CTA anchors come from `CtaLink`, whose own ring uses
     this same recipe; stating it here means any interactive node a future
     composition adds inherits the floor rather than relying on its component.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero :global(a:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE EIGHT LOOKS — WHERE EACH PRESET'S TELL IS DELIVERED

     The nine axes give this section 8 named looks, and until now seven of them
     were permutations rather than design languages: the axes changed sizes,
     colours and spacings, but nothing changed SHAPE, FACE or what got DRAWN.
     Candlelit was the exception, and that is the whole reason it is the only
     look anyone likes — its tell (ember bloom, motes, vignette) is drawn, not
     merely parameterised. Each block below draws the other seven tells.

     ── HOW THESE SELECTORS AVOID CANDLELIT ────────────────────────────────
     Candlelit is `surface:media edge:none media:bleed type:monumental
     align:center density:airy width:text motion:drift accent:glow`, and only
     FOUR of those are unique to it — surface:media, edge:none, media:bleed,
     accent:glow. Its other five are shared, so a bare rule on `type:monumental`,
     `align:center`, `density:airy`, `width:text` or `motion:drift` would restyle
     the one look that already works. Every key below is checked against that:

       quiet-studio  [accent='none']                    accent:none is UNIQUE
       long-read     [surface='bare'][align='start']    Candlelit is surface:media
       open-air      [edge='soft']                      edge:soft is UNIQUE
       plain-facts   [edge='offset']                    edge:offset is UNIQUE
       syllabus      [accent='edge'] / [type='restrained']  both UNIQUE
       full-send     [edge='heavy'] / [motion='stagger']    both UNIQUE
       signal        [accent='fill'][edge='hairline']    Candlelit is accent:glow
       (shared rung) [type='expressive']                Candlelit is monumental

     `surface='bare'` alone would also hit quiet-studio and `accent='fill'` alone
     would hit plain-facts and full-send, which is why those two are compounds.
     No selector in this block matches the Candlelit bundle; the two changes in
     this file that DO reach it are the `--tap-target-min` floors, which are a
     WCAG obligation rather than a look.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── quiet-studio · 1.4 luxury-minimal ─────────────────────────────────
     TELL: three type sizes, one hairline, no accent colour, and more empty
     space than content.

     THIS BLOCK IS MOSTLY SUBTRACTION, which is the correct instinct for the
     family — every mechanic in research §1.4 is an absence (no accent, no
     elevation, no transform, three sizes). What it ADDS is air: `density: vast`
     already multiplies the rhythm by 1.6, and this multiplies the block gap
     again on top of it and narrows the headline to 13ch, so the emptiness is
     conspicuous rather than merely generous. The section's own hairline frame
     (from `edge: hairline`) is the family's "single hairline" — no second rule
     is drawn, deliberately. */
  .hero[data-hero-accent='none'] {
    --hero-headline-max: 13ch;
    --hero-block-gap: calc(var(--jp-sec-gap) * 1.75);
    /* "Shadow / elevation: None" — the plate keeps its hairline and loses the
       `--shadow-xl` lift, which is the one thing in the composition that reads
       as expensive-by-effect rather than expensive-by-restraint. */
    --hero-plate-border-color: var(--color-border-subtle);
    --hero-plate-shadow: none;
  }

  /* THREE TYPE SIZES, READABLE AS A SYSTEM. The sizes were already three —
     `--text-sm`, `--text-lg`, `--jp-display` — but the trust line and the
     eyebrow shared a size without sharing a recipe, so the page read as four
     registers. Matching the case and tracking makes the count legible. */
  .hero[data-hero-accent='none'] .hero__trust {
    letter-spacing: var(--jp-eyebrow-tracking, var(--tracking-wider));
    text-transform: uppercase;
  }

  /* THE LAST BRAND COLOUR IN THE LOOK — DIAGNOSED HERE, DELIBERATELY NOT FIXED HERE.
     `CtaLink` paints `--color-brand-primary` directly rather than the `accent`
     axis's `--jp-accent-fill`, so quiet-studio — the one look whose entire tell
     is "no accent colour" — still serves a saturated brand button in the middle
     of a monochrome hero. The axis already holds the right answer: `accent:
     none` resolves `--jp-accent-fill` to `--jp-ink-4` ON PURPOSE, because a
     price-bearing CTA must stay dominant even in a monochrome family. So the
     defect is in the CONSUMER, `render/CtaLink.svelte`, and fixing it there
     fixes all eleven sections at once.

     A per-section repaint was written here and REVERTED, because
     `journey-design.test.ts` ("is the only styler of .cta in the section tree",
     Codex-kdsuo) forbids a section painting the CTA's own colours — and it is
     right to: the pay button's contrast is guaranteed in exactly one place, and
     a second painter makes that guarantee unverifiable while the pin still
     passes.

     Re-routing `CtaLink` onto the accent ladder is a real design decision about
     the contrast of the one element a visitor must read to pay (kdsuo measured
     4.70:1), and the same test deliberately tripwires it so it cannot land
     silently. It needs a measured contrast sweep at `accent: none` across the
     seeded brands plus an owner's sign-off — not a section-local override. */

  /* ── long-read · 1.1 editorial / magazine ──────────────────────────────
     TELL: the eyebrow and the body share a left edge, and a hairline under every
     section head. The measurement found the shared edge twice in the tree and
     the head hairline NOWHERE, so the hairline is the missing half.

     THE SHARED LEFT EDGE IS ALREADY TRUE and worth stating so nobody "fixes" it:
     `align: start` resolves `--jp-measure-margin` to `0px`, which is what
     `.hero__headline` and `.jp-sec__measure` both read, and `--jp-align` to
     `start`, which `.hero__inner` and `.hero__actions` read. Eyebrow, headline,
     sub-line and CTA row therefore all begin on one edge with no extra rule.

     "NO BOX BORDERS ANYWHERE. Hairline horizontal rules only" (§1.1) is the half
     the axis cannot express: `edge: hairline` draws a four-sided box. Collapsing
     it to its bottom edge turns the section frame into an editorial rule between
     sections and keeps the family's promise, without touching quiet-studio,
     which shares `surface: bare` but is centred. */
  .hero[data-hero-surface='bare'][data-hero-align='start'] {
    --hero-headline-max: 26ch;
    /* Reset then re-draw ONE edge, rather than zeroing three widths. Logical and
       physical longhands both resolve onto the same used value and the cascade
       decides between them, so `border-inline-width: 0` against `.hero`'s
       `border` shorthand is a question about mixed-vocabulary cascade order that
       nobody should have to answer while reading a section. `border: 0` clears
       every physical longhand and the style with it; the logical edge that
       follows in the same block then wins on order alone. */
    border: 0;
    border-block-end: var(--jp-edge-width) solid var(--jp-edge-color);
    /* "Shadow / elevation: None." */
    box-shadow: none;
  }

  .hero[data-hero-surface='bare'][data-hero-align='start'] .hero__headline {
    padding-bottom: calc(var(--space-4) * var(--jp-rhythm));
    border-bottom: var(--border-width) solid var(--color-border-subtle);
  }

  /* ── open-air · 1.3 soft-organic / wellness ────────────────────────────
     TELL: no border anywhere, pill controls, and a shadow you have to look for.

     THE MOST DANGEROUS LOOK TO WORK ON: it shares four axes with Candlelit
     (align, density, width, motion), so every rule here is keyed on `edge: soft`,
     which is unique to it. `edge: soft` already zeroes the SECTION border and
     lifts it on `--shadow-lg`; what it could not reach was the media plate's own
     accent hairline and the square-ish controls, which is what "no border
     anywhere" and "pill controls" actually name. */
  .hero[data-hero-edge='soft'] {
    /* `--radius-full` on every control, per "pill controls". */
    --hero-control-radius: var(--radius-full);
    /* "Edge treatment: None. No borders at all. Separation comes from space and
       soft elevation." `--shadow-lg` is large, diffuse and at 5–9% alpha in
       light — the shadow you have to look for. */
    --hero-plate-border-width: 0px;
    --hero-plate-shadow: var(--shadow-lg);
    --hero-dot-size: var(--space-2-5);
  }

  .hero[data-hero-edge='soft'] .hero__actions :global(.cta) {
    border-radius: var(--radius-full);
  }

  /* An exhale does not shout. The shared eyebrow atom is uppercase and tracked
     out, which is a luxury/editorial label; this family's own §1.3 mechanic is
     "humanist … light-to-normal weight", so the kicker drops the caps and the
     tracking here and nowhere else. */
  .hero[data-hero-edge='soft'] .hero__eyebrow {
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-normal);
    text-transform: none;
  }

  /* ── plain-facts · 1.2 brutalist / utilitarian ─────────────────────────
     TELL: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere. Measured across the tree: 2px borders x23, offset
     shadow NONE FOUND, radius-0 NONE FOUND.

     The offset shadow was in fact reachable — `edge: offset` emits
     `--jp-edge-shadow: var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)`
     and `.hero` reads it — so the SECTION had one. Nothing else did, and
     `surface: panel` handed the section `--radius-card`, so the brutalist look
     shipped a rounded box. Radius 0 is asserted on every corner this section
     owns, and the offset is carried onto the controls that sit inside it. */
  .hero[data-hero-edge='offset'] {
    /* Radius 0 EVERYWHERE, starting with the section itself, which `panel`
       rounds to `--radius-card`. */
    border-radius: 0;
    --hero-control-radius: 0px;
    --hero-dot-radius: 0px;
    --hero-control-border: var(--border-width-thick) solid
      var(--color-border-strong);
    --hero-control-shadow: var(--space-1) var(--space-1) 0 0
      var(--color-border-strong);
    --hero-label-font: var(--font-mono);
    --hero-plate-border-width: var(--border-width-thick);
    --hero-plate-border-color: var(--color-border-strong);
    --hero-plate-shadow: var(--space-1) var(--space-1) 0 0
      var(--color-border-strong);
    /* "Type scale ratio 1.5+ — few steps, enormous gaps between them." The
       headline is already `--text-display`; the body drops a step so the gap is
       enormous rather than merely large, at the family's own tight measure. */
    --hero-sub-size: var(--text-base);
    --hero-sub-leading: var(--leading-normal);
    --hero-headline-max: 22ch;
  }

  .hero[data-hero-edge='offset'] .hero__media,
  .hero[data-hero-edge='offset'] .hero__plate {
    border-radius: 0;
  }

  /* "Mono labels" — the eyebrow and the trust row, which are this section's two
     labels. `font-variant-numeric` matters on the trust row specifically: it is
     where the counts live. */
  .hero[data-hero-edge='offset'] .hero__eyebrow,
  .hero[data-hero-edge='offset'] .hero__trust {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .hero[data-hero-edge='offset'] .hero__actions :global(.cta) {
    border-radius: 0;
    box-shadow: var(--space-1) var(--space-1) 0 0 var(--color-border-strong);
  }

  /* ── syllabus · 1.5 technical / dense-dashboard ────────────────────────
     TELL: hairline grid, mono numerals, and a left-border accent stripe rather
     than a filled badge.

     `accent: edge` is the axis value that exists for exactly this and, before
     this change, the hero spent it on nothing — `--jp-accent-edge` was read only
     by the plate's border, and `media: frame` plus a stripe-less eyebrow left
     the look indistinguishable from `signal`. The stripe is the tell, so it is
     drawn on the label the family would otherwise have put a filled badge on. */
  .hero[data-hero-accent='edge'] .hero__eyebrow {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
    padding-inline-start: var(--space-3);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* THE HAIRLINE GRID, one rule where this section has one boundary that carries
     meaning: between the copy and the controls. `journey-design.css` warns that
     `--jp-line` measures 1.79:1 light / 1.49:1 dark and so may not be the ONLY
     signal for such a boundary — it is paired with the rhythm's own gap here,
     which is what that note asks for. */
  /* The CHILD combinator, and only from the two copy-stack parents: `banner` and
     `oversized` put the actions inside `.hero__meta`, a wrapping flex row that
     also holds the sub-line, where a full-width item would push that line onto a
     row of its own. The grid rule belongs to the vertical stack, not to the
     compact row. */
  .hero[data-hero-accent='edge'] .hero__inner > .hero__actions,
  .hero[data-hero-accent='edge'] .hero__col > .hero__actions {
    width: 100%;
    padding-top: calc(var(--space-4) * var(--jp-rhythm));
    border-top: var(--border-width) solid var(--color-border-subtle);
  }

  .hero[data-hero-accent='edge'] .hero__trust {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* `type: restrained` is unique to this look, and it is the axis's only
     fine-grained rung: "many small steps, fine-grained hierarchy", radius
     `--radius-sm`, measure 70–80ch. The section radius is asserted because
     `surface: panel` would otherwise hand it `--radius-card`. */
  .hero[data-hero-type='restrained'] {
    border-radius: var(--radius-sm);
    --hero-sub-size: var(--text-base);
    --hero-sub-leading: var(--leading-normal);
    --hero-headline-max: 30ch;
  }

  /* ── full-send · 1.8 playful / high-energy ─────────────────────────────
     TELL: whole inverted bands, pill CTAs at `--radius-full`, spring easing, and
     big numerals. Measured: inverted bands x1, spring easing x1, big numerals
     NONE FOUND.

     The band and the easing were already reachable — `surface: invert` re-points
     `--jp-ink` and `.hero` paints `--jp-sec-bg`, and every entrance animation in
     this file already reads `--jp-reveal-ease`, which `motion: stagger` sets to
     `--ease-spring`. What was missing is that a spring you cannot see overshoot
     is not spring easing: `hero-word-in` animates opacity, translate and blur,
     none of which reads as bounce. `hero-word-pop` adds the scale that does. */
  .hero[data-hero-edge='heavy'] {
    /* "Corner radius: `--radius-full` on every control." */
    --hero-control-radius: var(--radius-full);
    --hero-dot-size: var(--space-2-5);
    /* "Shadow: Medium, slightly hard, tinted", "border-width-thick in the accent
       colour" — the section already has the 2px accent border from
       `edge: heavy`; the plate matches it rather than staying hairline. */
    --hero-plate-border-width: var(--border-width-thick);
    --hero-plate-border-color: var(--jp-accent-edge);
    --hero-plate-shadow: var(--shadow-md);
  }

  /* "Accent as fill, everywhere, at full strength" — the eyebrow stops being a
     grey label and becomes the filled badge this family puts on everything.
     `--jp-accent-fill` / `--jp-accent-on-fill` are a matched pair (the palette
     derives `--jp-on-ember` against `--jp-ember`), so this cannot go
     illegible when the accent axis or the brand changes. */
  .hero[data-hero-edge='heavy'] .hero__eyebrow {
    padding: var(--space-1-5) var(--space-4);
    border-radius: var(--radius-full);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
    font-weight: var(--font-bold);
  }

  /* BIG NUMERALS. The hero's only numerals are in the trust row ("1,240 people
     have taken this"), so that is where they get the size, the weight, the
     heading ink and the lining/tabular figures the family asks for. */
  .hero[data-hero-edge='heavy'] .hero__trust {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    font-variant-numeric: lining-nums tabular-nums;
    color: var(--color-heading);
  }

  .hero[data-hero-edge='heavy'] .hero__actions :global(.cta) {
    border-radius: var(--radius-full);
  }

  /* ── signal · 1.9 contemporary / product (the platform default) ─────────
     TELL: rounded cards with hairlines and a small neutral shadow; ONE filled
     accent button per section.

     The second clause is the one this section was breaking. The plate paints
     `color-mix(--jp-accent-fill 44%, --color-surface)` behind an accent-tinted
     border and a `--shadow-xl` lift, so a `signal` hero showed TWO saturated
     accent elements — the plate and the CTA — and the CTA stopped being the one
     filled thing on the page. Neutralising the plate to a surface card with a
     hairline and `--shadow-sm` is what makes the tell true, and it is also
     §1.9's own edge/shadow spec. */
  .hero[data-hero-accent='fill'][data-hero-edge='hairline'] {
    --hero-plate-border-color: var(--color-border-subtle);
    --hero-plate-shadow: var(--shadow-sm);
    --hero-plate-bg: linear-gradient(
      to bottom,
      var(--color-surface-secondary),
      var(--color-surface)
    );
    /* "Shadow / elevation: `--shadow-sm` / `--shadow-md`, neutral" (§1.9).
       `edge: hairline` ships `--shadow-xs`, which is the right floor for the
       three looks that share that value and one step under what this family
       asks for; the compound is what lets this one step up without moving
       quiet-studio, long-read or syllabus with it. */
    box-shadow: var(--shadow-sm);
    /* Rounded to match the card language rather than the `--radius-sm` a bare
       control default gives, and a punchier headline cap than the 16ch a
       centred cinematic column wants, since this look is `width: wide`. */
    --hero-control-radius: var(--radius-md);
    --hero-headline-max: 20ch;
  }

  /* ── the shared `type` rung ─────────────────────────────────────────────
     THE `type` AXIS HAS TO CHANGE A RELATIONSHIP, NOT ONE FONT-SIZE. Before
     this, only the headline moved with `type` — the eyebrow was pinned at
     `--text-sm` and the sub-line at `--text-lg` on all four values, so
     `restrained` and `expressive` differed by the headline alone.

     `expressive` is open-air + full-send only (Candlelit is `monumental`), so
     this pair of rules is safe; `restrained` and the two `monumental` looks that
     are not Candlelit get theirs inside their own blocks above, because
     `monumental` is SHARED WITH CANDLELIT and a bare rule on it would resize the
     one look that already works. */
  .hero[data-hero-type='expressive'] {
    --hero-sub-size: var(--text-xl);
  }

  .hero[data-hero-type='expressive'] .hero__eyebrow {
    font-size: var(--text-base);
  }

  /* ── `motion: none` MEANS NONE ──────────────────────────────────────────
     plain-facts and syllabus both set it, and both families say so explicitly:
     "None. Instant state changes" / "None. Interactions are instant". The axis
     zeroes `--jp-reveal-distance` and `--jp-reveal-duration`, and `.hero--still`
     stops the continuous decoration — but the two hover transitions in this file
     are hardcoded `--transition-*` shorthands the axis cannot reach, so a
     "motionless" look still grew its play button by 6% on hover. */
  .hero[data-hero-motion='none'] .hero__watch,
  .hero[data-hero-motion='none'] .hero__play {
    transition: none;
  }

  .hero[data-hero-motion='none'] .hero__play:hover {
    transform: translate(-50%, -50%);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ENHANCED — layered on top of the legible baseline once JS confirms motion is
     welcome (`.hero--enhanced`). Nothing here is required for legibility.

     Every duration, delay and distance comes from the `motion` axis.
     `--hero-beat` is the axis's own stagger; `--hero-word-step` is a THIRD of it,
     because `--jp-reveal-stagger` is calibrated for the four or five block-level
     beats of a section reveal and a headline has ten-plus words — at the raw beat
     a sentence takes three seconds to assemble. Reported as an axis finding.
     ═══════════════════════════════════════════════════════════════════════ */
  .hero--enhanced {
    --hero-beat: var(--jp-reveal-stagger);
    --hero-word-step: calc(var(--jp-reveal-stagger) / 3);
  }

  .hero--enhanced .hero__glow {
    animation: hero-breathe 11s ease-in-out infinite;
  }

  .hero--enhanced .hero__motes {
    display: block;
  }

  .hero--enhanced .hero__mote {
    animation: hero-rise linear infinite;
  }

  /* Per-mote geometry — left position, size, drift (--dx), peak opacity (--o),
     duration + delay. Sizes/offsets in rem + container units (no raw px). */
  .hero--enhanced .hero__mote:nth-child(1)  { left: 7%;  width: 0.125rem;  height: 0.125rem;  --dx: 1.125rem;  --o: 0.40; animation-duration: 20s; animation-delay: 0s; }
  .hero--enhanced .hero__mote:nth-child(2)  { left: 15%; width: 0.1875rem; height: 0.1875rem; --dx: -0.9375rem; --o: 0.34; animation-duration: 25s; animation-delay: 3s; }
  .hero--enhanced .hero__mote:nth-child(3)  { left: 24%; width: 0.125rem;  height: 0.125rem;  --dx: 1.375rem;  --o: 0.48; animation-duration: 16s; animation-delay: 6s; }
  .hero--enhanced .hero__mote:nth-child(4)  { left: 33%; width: 0.25rem;   height: 0.25rem;   --dx: -0.625rem; --o: 0.30; animation-duration: 28s; animation-delay: 1s; }
  .hero--enhanced .hero__mote:nth-child(5)  { left: 42%; width: 0.125rem;  height: 0.125rem;  --dx: 0.8125rem; --o: 0.52; animation-duration: 21s; animation-delay: 9s; }
  .hero--enhanced .hero__mote:nth-child(6)  { left: 50%; width: 0.1875rem; height: 0.1875rem; --dx: -1.3125rem; --o: 0.38; animation-duration: 26s; animation-delay: 4s; }
  .hero--enhanced .hero__mote:nth-child(7)  { left: 59%; width: 0.125rem;  height: 0.125rem;  --dx: 1rem;      --o: 0.46; animation-duration: 18s; animation-delay: 11s; }
  .hero--enhanced .hero__mote:nth-child(8)  { left: 67%; width: 0.1875rem; height: 0.1875rem; --dx: -0.75rem;  --o: 0.34; animation-duration: 23s; animation-delay: 2s; }
  .hero--enhanced .hero__mote:nth-child(9)  { left: 76%; width: 0.125rem;  height: 0.125rem;  --dx: 1.25rem;   --o: 0.50; animation-duration: 17s; animation-delay: 7s; }
  .hero--enhanced .hero__mote:nth-child(10) { left: 84%; width: 0.25rem;   height: 0.25rem;   --dx: -1rem;     --o: 0.28; animation-duration: 27s; animation-delay: 5s; }
  .hero--enhanced .hero__mote:nth-child(11) { left: 91%; width: 0.125rem;  height: 0.125rem;  --dx: 0.6875rem; --o: 0.44; animation-duration: 20s; animation-delay: 10s; }
  .hero--enhanced .hero__mote:nth-child(12) { left: 96%; width: 0.1875rem; height: 0.1875rem; --dx: -1.125rem; --o: 0.36; animation-duration: 22s; animation-delay: 13s; }

  /* Kinetic headline — each word rises + de-blurs on its own beat. */
  .hero--enhanced .hero__word {
    display: inline-block;
    animation: hero-word-in var(--jp-reveal-duration) var(--jp-reveal-ease) both;
    animation-delay: calc(
      var(--word-i, 0) * var(--hero-word-step) + var(--hero-beat)
    );
  }

  /* full-send's PLAYFUL CASCADE. `motion: stagger` is unique to it (Candlelit is
     `drift`), and it is the one motion value whose character is the cascade
     itself rather than the arrival — so the word step goes from a third of the
     beat to a half, which is a visibly sequential ripple instead of a
     near-simultaneous settle, and the words scale up into place so
     `--ease-spring`'s overshoot is actually visible. A spring you cannot see
     overshoot is not spring easing; opacity and blur cannot show one.

     `animation-name` as a longhand, deliberately: the shorthand above still
     supplies the duration, easing and fill from the axis, and only the keyframe
     set is swapped. (0,3,0) against the shorthand's (0,2,0), so it wins on that
     one property. */
  .hero--enhanced[data-hero-motion='stagger'] {
    --hero-word-step: calc(var(--jp-reveal-stagger) / 2);
  }

  .hero--enhanced[data-hero-motion='stagger'] .hero__word {
    animation-name: hero-word-pop;
  }

  /* Staggered entrances for the surrounding copy, on the axis's own beat. */
  .hero--enhanced .hero__eyebrow {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease) 0s
      both;
  }
  .hero--enhanced .hero__sub:not(.hero__sub--meta) {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 3) both;
  }
  .hero--enhanced .hero__actions {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 4) both;
  }
  .hero--enhanced .hero__trust {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 5) both;
  }
  .hero--enhanced .hero__meta {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 3) both;
  }
  .hero--enhanced .hero__media {
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 2) both;
  }
  .hero--enhanced .hero__trust-dot {
    animation: hero-heartbeat 4.5s ease-in-out infinite;
  }

  .hero--enhanced .hero__cue {
    display: flex;
    animation: hero-fade-up var(--jp-reveal-duration) var(--jp-reveal-ease)
      calc(var(--hero-beat) * 6) both;
  }
  .hero--enhanced .hero__cue-spark {
    animation: hero-spark 2.8s var(--ease-out) infinite;
  }
  .hero--enhanced :global(.hero__cue-chevron) {
    animation: hero-cue-bob 2.8s ease-in-out infinite;
  }

  /* `motion: none` — the axis value, not the OS preference. Continuous decoration
     stops and the motes go; the scroll cue is already unrendered in markup. This
     is the other half of what the retired `minimal` variant did. */
  .hero--still .hero__glow,
  .hero--still .hero__mote,
  .hero--still .hero__trust-dot,
  .hero--still .hero__cue-spark {
    animation: none;
  }

  /* The chevron lives on `ChevronDownIcon`'s own `<svg>`, so it needs `:global` to
     be reached — which is exactly why it was the one animation that survived
     `motion: none` when measured. The cue is not rendered at all under
     `motion: none`, so this is defence in depth rather than a live path. */
  .hero--still :global(.hero__cue-chevron) {
    animation: none;
  }

  .hero--still .hero__motes {
    display: none;
  }

  /* ── scroll cue: hidden in the baseline, revealed only when enhanced ── */
  .hero__cue {
    position: absolute;
    bottom: clamp(var(--space-3), 3vh, var(--space-8));
    left: 0;
    right: 0;
    z-index: 1;
    margin-inline: auto;
    width: max-content;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
  }

  .hero__cue-line {
    position: relative;
    width: var(--border-width);
    height: 2.875rem;
    overflow: hidden;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in oklab, var(--color-heading) 22%, transparent) 45%,
      transparent
    );
  }

  .hero__cue-spark {
    position: absolute;
    left: 50%;
    top: 0;
    width: 0.1875rem;
    height: 0.6875rem;
    margin-left: -0.09375rem;
    border-radius: var(--radius-sm);
    background: linear-gradient(var(--jp-accent-mark), transparent);
    box-shadow: 0 0 var(--blur-md)
      color-mix(in oklab, var(--jp-accent-mark) 80%, transparent);
  }

  @keyframes hero-word-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--jp-reveal-distance) * 0.5));
      filter: blur(var(--blur-md));
    }
    to {
      opacity: 1;
      transform: none;
      filter: blur(0);
    }
  }

  /* The `stagger` twin of `hero-word-in`. No blur — a spring and a de-blur read
     as two different intentions at once — and a scale rather than a translate,
     because the scale is what makes `--ease-spring`'s overshoot legible. The
     translate is kept on the axis's own distance so `motion: stagger`'s
     `--space-6` still governs how far the word travels. */
  @keyframes hero-word-pop {
    from {
      opacity: 0;
      transform: translateY(var(--jp-reveal-distance)) scale(0.88);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes hero-fade-up {
    from {
      opacity: 0;
      transform: translateY(var(--jp-reveal-distance));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* The glow's breath reads its endpoints from custom properties so the `bg`
     treatment can flatten it (`still`) without needing a second keyframe set. */
  @keyframes hero-breathe {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: var(--hero-glow-lo, 0.5);
    }
    50% {
      transform: translate(-50%, -50%) scale(1.09);
      opacity: var(--hero-glow-hi, 0.78);
    }
  }

  @keyframes hero-rise {
    0% {
      transform: translate3d(0, 0, 0);
      opacity: 0;
    }
    12% {
      opacity: var(--o, 0.42);
    }
    50% {
      transform: translate3d(calc(var(--dx, 0.75rem) * 0.5), -48vh, 0);
    }
    88% {
      opacity: var(--o, 0.42);
    }
    100% {
      transform: translate3d(var(--dx, 0.75rem), -94vh, 0);
      opacity: 0;
    }
  }

  @keyframes hero-heartbeat {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.9;
    }
    50% {
      transform: scale(1.35);
      opacity: 0.5;
    }
  }

  @keyframes hero-spark {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    22% {
      opacity: 1;
    }
    78% {
      opacity: 1;
    }
    100% {
      transform: translateY(2.3125rem);
      opacity: 0;
    }
  }

  @keyframes hero-cue-bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(0.1875rem);
    }
  }

  /* A CONTAINER query, not a viewport one (contract A14): `.jp-sec` is the
     container, and the builder canvas renders this section inside a device frame
     narrower than the window, where a viewport query reads the wrong number. */
  @container (max-width: 35rem) {
    .hero__actions {
      flex-direction: column;
      align-items: stretch;
    }
  }

  /* REDUCED MOTION is handled by the shared kill switch in
     `journey-sections-shared.css` (`.jp-sec * { animation: none !important }`)
     plus `journey-design.css` zeroing `--jp-reveal-distance` — a 0.01ms animation
     to a translated end state still MOVES the element, so the distance has to go
     too. The eleven per-component copies of that block collapse into those two;
     what remains here is only the part neither covers, which is that the motes
     must not merely stop but disappear (a frozen ember mid-air reads as a
     rendering fault). */
  @media (prefers-reduced-motion: reduce) {
    .hero__motes {
      display: none;
    }
  }
</style>
