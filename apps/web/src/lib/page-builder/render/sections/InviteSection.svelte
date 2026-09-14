<!--
  @component InviteSection

  The offer and pricing (SPEC §4.1 `invite`) — the primary conversion moment.

  ══════════════════════════════════════════════════════════════════════════
   THE PRICING INVARIANT — the most important constraint in this file
  ══════════════════════════════════════════════════════════════════════════
  Every path and every price comes from `context.offer` — the AUTHORITATIVE
  `getCourseOffer` read (Codex-2pryk.2.4.3). Authored `offers` copy may DECORATE
  a real path (name / who / blurb / bullets / which is recommended) and can
  neither invent a path nor state a price: this section used to render the
  authored `priceLabel` directly, which is how a dev page came to advertise
  "Included with membership · £12 a month" against a real £15 tier and a real
  £27 course subscription.

  The authored `price` field is DELETED, not bridged (`section-fields.ts` no
  longer declares it, `coerce.ts`'s alias table deliberately omits it). Seven
  published pages STILL STORE a `price` string — verified in the database, the
  golden page's is literally the £12 lie above. Nothing here reads it, and no
  composition may reintroduce an authored price string. `tiers` and `table` are
  exactly where that temptation lives.

  When `context.offer` is null — or the course has no purchasable path, which is
  the live state on FOUR of the seven pages that carry this section — the
  section shows the CTA with NO price rather than falling back to authored
  numbers. A price-less invitation is honest; a wrong one is not. EVERY
  composition below degrades to that price-less CTA. Each card deep-links into
  the checkout with its own path pre-selected (`?offer=`). Currency is GBP (£).

  ══════════════════════════════════════════════════════════════════════════
   THE DESIGN AXES — eight of nine apply
  ══════════════════════════════════════════════════════════════════════════
  Every layout / rhythm / type-scale / edge / surface / motion decision below
  reads a `--jp-*` property that `render/SectionRenderer.svelte` resolves onto
  the `.jp-sec` wrapper as a `data-jp-*` attribute (contract A9). COLOUR STAYS
  `--color-*` (A11) — `.journey-palette--page` already re-points those onto the
  `--jp-*` ladder, so they are brand-derived and auto-contrasted. The one colour
  exception is the `--jp-accent-*` family, which exists so `accent: none` drops
  the brand out of the decoration in a handful of declarations.

  `media` IS DELIBERATELY UNCONSUMED (contract A50). Research §2.2 names the
  five types where `media` is meaningful — `hero`, `introVideo`, `reel`, `guide`
  and `proof` — and states that the rest "ignore it, exactly as they ignore a
  variant they do not offer". `invite` is not among the five and has no media
  field anywhere in its read model: `InviteSectionProps` declares none,
  `JourneySalesContext` projects none for it, and `OfferPath` is copy plus
  prices. Rendering a media frame here would be a control that changes nothing —
  the mistake `SectionFieldDef.mediaSlot`'s own JSDoc exists to prevent. Eight
  consumed axes is the correct count for this type, not a shortfall.

  SEVEN AXES ARE ALSO READ IN MARKUP, because a component's scoped styles cannot
  reach an ancestor attribute. Two are read as PREDICATES — `accent` (whether
  `--jp-accent-fill` is a real colour at all, see the badge note) and `motion`
  (whether `sticky`'s bar pins) — and `surface` `edge` `align` `type` `accent`
  `density` `motion` are re-emitted UNMODIFIED as local `data-*` attributes for
  the PER-LOOK COMMITMENTS block at the foot of the stylesheet. See `look` in the
  script for the full reasoning, including why `media` is deliberately not among
  them.

  ══════════════════════════════════════════════════════════════════════════
   EIGHT DESIGN LANGUAGES, NOT 38 PERMUTATIONS
  ══════════════════════════════════════════════════════════════════════════
  The nine axes reach every MAGNITUDE in this file, and that is not enough on its
  own to make a look recognisable. A design language is also which elements are
  boxes, which corner is square, which label is monospaced, which numeral is
  tabular and which rule is drawn at all — selector-level decisions a
  properties-only axis file deliberately cannot carry.

  So the foot of the stylesheet spends the mirrored attributes on each family's
  documented tell (`00-design-language-research.md` §1). Read that block's own
  header before adding a rule to it: it carries the selector discipline that
  keeps `candlelit` — the one preset the product owner says already works — out
  of the blast radius, which is arithmetic rather than convention.

  ══════════════════════════════════════════════════════════════════════════
   SIX COMPOSITIONS
  ══════════════════════════════════════════════════════════════════════════
  `pool` (default) · `banner` · `card` · `tiers` · `table` · `sticky`.
  `pool`/`banner`/`card` are ported from the since-deleted canvas partial
  (`render-edit/journey-sections/_invite.css`, contract A12 — `.jp-invite`,
  `.jp-invite--banner` :40-42, `.jp-invite--card` :43-47). `tiers`, `table` and
  `sticky` are new (research §3).

  `pool` is the composition every published page RENDERS today, because the
  renderer ignored `variant` entirely until this programme. See the stored-value
  note on `COMPOSITIONS` below — it is contract A33 repeating itself.

  ══════════════════════════════════════════════════════════════════════════
   TWO RENDERINGS, PROGRESSIVELY ENHANCED
  ══════════════════════════════════════════════════════════════════════════
  • BASELINE (SSR, no-JS, reduced-motion): a fully-legible close — eyebrow,
    heading, sub, and the offer(s), all visible immediately, every CTA in the
    normal flow. This is what the server emits, so the section is never blank
    and never depends on JS.
  • ENHANCED (browser + motion OK): the breathing "warm ground" rises from
    below, the descent hairline drops a travelling spark onto a glowing seed, a
    centred vignette focuses the frame, blocks rise into view on the `motion`
    axis's own timing, and `sticky`'s bar pins to the bottom of the section.

  `sticky` ships its static fallback BY BEING STATIC BY DEFAULT (contract A40):
  the in-flow bar is the baseline and the pinning only exists inside
  `@media (prefers-reduced-motion: no-preference)` with `motion` not `none`.
  Written the usual way round — pin, then override — a fallback has to remember
  every property the pinned state set, and the forgotten one is the one that
  makes the CTA reachable. On a conversion surface an unreachable CTA is a
  revenue bug and an accessibility failure at once, so there is nothing to
  forget instead.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import {
    checkoutUrlForPath,
    deriveOfferPaths,
    type OfferPath,
  } from '$lib/page-builder/offer-paths';
  import CtaLink from '../CtaLink.svelte';
  import { aliasKeys, asString, asStringFrom } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type { JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
    /**
     * The course title, and ONLY when this section is the one the page has let
     * claim it (`SectionComponentProps.titleFallback`). Five sections fell back to
     * `context.course.title` independently, so an under-authored page printed the
     * same sentence as its `<h1>` four more times.
     *
     * This section was the LAST of the five still reading the context directly,
     * which made the mechanism unsound rather than merely incomplete: with the
     * claim spent on (say) `map`, a blank invite printed the title as well — the
     * exact duplication `claimTitleFallback` exists to prevent, on the conversion
     * section.
     */
    titleFallback?: string;
  }

  const {
    config,
    context,
    variant,
    design,
    editable = false,
    onEdit,
    titleFallback,
  }: Props = $props();

  const eyebrow = $derived(asString(config, 'eyebrow'));
  const sub = $derived(asString(config, 'sub'));

  /**
   * The italic second line closing the heading — `OWED_READS.invite` (contract
   * A28), now wired. All seven published pages store `accent: "is waiting."`
   * and nothing read it, so the heading rendered as "The ground" where the
   * creator authored "The ground is waiting." Same key, same treatment and same
   * `--jp-accent-text` colour as `HeroSection`'s accent, so the two display
   * moments on a page match.
   *
   * `section-fields.test.ts`'s second assertion — "every OWED_READS entry is a
   * real field that is still genuinely unread" — goes RED on this line. That is
   * A28 working as designed: the entry is a work list, not an exemption, and the
   * worktree that wires the read deletes it. `section-fields.test.ts` is SHARED
   * and CLOSED, so the deletion of `invite: ['accent']` is reported, not made
   * here.
   */
  const accent = $derived(asString(config, 'accent'));

  /**
   * The risk-reversal line under the CTA — bridged through the alias table
   * (`Codex-tqr51`), which is where the builder's stored `risk` key reaches the
   * renderer's `priceNote` prop.
   *
   * NOT A PRICE, despite the prop name: it is the "Cancel anytime" reassurance,
   * and it is the reason this read is safe. `invite.price` is the key that must
   * never be read, and it is absent from `SECTION_PROP_ALIASES` for exactly
   * that reason.
   *
   * It also now renders in BOTH branches. All seven pages store a `risk`
   * ("Start free · cancel anytime" on the golden page, "Cancel anytime" on the
   * other six) and it rendered on ZERO of them, because the only element that
   * consumed `priceNote` lived in the no-paths fallback. Bridging the key
   * without moving the element would have fixed nothing measurable.
   */
  const priceNote = $derived(
    asStringFrom(config, aliasKeys('invite', 'priceNote'))
  );

  /**
   * NO HARDCODED EDITORIAL FALLBACK (`Codex-i9pzs`). This read used to be
   * `asString(config, 'heading') ?? 'Begin the work.'` — copy in one org's
   * voice, compiled into a component that every other org's sell page renders. A
   * brutalist developer course with an unset heading published "Begin the work."
   *
   * Fixed by falling back to DATA: the course's own title is always the
   * creator's own words, which is the pattern `HeroSection` already uses for its
   * headline (`p.headline ?? context.course.title`). Deliberately NOT an i18n
   * key — a key holding one brand's voice has moved the problem, not fixed it
   * (`05-bridge-table.md`, class A).
   *
   * Latent rather than live today: all seven pages store a heading, so the old
   * fallback was reachable but unreached. It would have fired on the first page
   * a creator left the field empty on.
   *
   * THE FALLBACK IS NOW BORROWED, NOT ASSUMED. It reads `titleFallback` — the
   * course title, handed to whichever single section the PAGE granted it
   * (`claimTitleFallback`) — and never `context.course.title`. Four sections were
   * converted when the claim landed and this one was missed, so the claim could go
   * to `map` while a blank invite ALSO printed the title. The course title is
   * still in the context and is still read below for accessible names; the
   * discipline is at the heading read and nowhere else.
   *
   * Read through `aliasKeys` rather than a bare `'heading'` so this read and
   * `hasAuthoredHeading`'s claim test consult ONE preference list. `invite`
   * declares no heading alias today, so the two are identical — but a hand-copied
   * key list is exactly how a claim comes to disagree with a render, and the
   * disagreement degrades to a self-hidden heading rather than failing.
   */
  const heading = $derived(
    asStringFrom(config, aliasKeys('invite', 'heading')) ?? titleFallback
  );

  /**
   * The real ways in, decorated by this section's authored copy. EMPTY when the
   * offer read was unavailable, or when the course has no purchasable path —
   * which is not a theoretical state: four of the seven pages carrying an
   * `invite` have `price_cents IS NULL`, no subscription plan and no tier grant,
   * so they render the price-less branch today.
   */
  const paths = $derived(deriveOfferPaths(context.offer, context.course, config));

  /**
   * THE TOP-LEVEL COLLAPSE — the guard the other ten sections already had, and
   * the last hole the dead-end-checkout fix left behind.
   *
   * Nine of the eleven sections self-hide on empty data (`AcheSection`'s
   * `hasContent` is the pattern; `introVideo` and `reel` gained theirs when the
   * hollow media shell was removed). `invite` did not, so whenever it had neither
   * copy nor an offer it still rendered its root `<div>`, its four-layer
   * atmosphere and an EMPTY `<header>` — a glowing band with nothing in it, and
   * it is the LAST section of the default page template, so it is the note a
   * visitor leaves on.
   *
   * WHY THAT STATE EXISTS AT ALL, and why closing it belongs here: withholding
   * the transactional affordance from a non-purchasable course (the branch far
   * below) was correct — the checkout it pointed at answers "isn't open for
   * enrolment just now" — but it left the frame standing. A section with nothing
   * to say and nothing to sell must not be a frame.
   *
   * `purchasable !== false`, never `!purchasable`, for the reason the CTA branch
   * states at length: `purchasable` is a CONFIDENT NEGATIVE, and a FAILED offer
   * read leaves it `true` while also emptying `paths`. Testing truthiness would
   * collapse the entire section on a transient pricing hiccup — the same defect
   * as stripping the buy button, one level up.
   *
   * MEASURED BEFORE THE GUARD, all six compositions, `props: {}` + `paths: []` +
   * `purchasable: false` + no claimed title fallback: `.invite` +
   * `.invite__atmos` + `.invite__inner` + an empty `.invite__head`, and ZERO
   * characters of text. Not live on the seven seeded pages — every one authors
   * `heading` and `accent` — but one cleared field away on the five whose course
   * has `price_cents IS NULL`.
   */
  const hasCopy = $derived(!!(eyebrow || heading || accent || sub));
  const hasDoorway = $derived(
    context.enrolled || paths.length > 0 || context.purchasable !== false
  );

  /**
   * CTA branches on enrolment: an enrolled member is sent to their dashboard;
   * everyone else funnels to checkout to join.
   *
   * `asStringFrom` + `aliasKeys` is the `Codex-tqr51` fix, and this was the
   * CONFIRMED LIVE LOSS on this section. The builder writes `button`; this read
   * asked only for `ctaLabel`, so every one of the seven pages published the
   * hardcoded fallback instead of the creator's own label. Measured on the
   * served golden page before the fix: `Join now` × 4 in the real DOM (one per
   * offer card) and × 0 in the hydration payload, while the stored
   * `button: "Get started"` appeared × 4 in the payload and × 0 anywhere inside
   * `<section id="invite">`. The single `Get started` in the real DOM was the
   * HERO's, in its own `data-section-type="hero"` element — the pilot had
   * already fixed that one.
   *
   * The fallbacks are the two genuinely generic chrome strings (`05-bridge-table.md`
   * class B), and both keys already exist rather than being requested.
   */
  const ctaLabel = $derived(
    context.enrolled
      ? m.journey_hero_cta_enrolled()
      : (asStringFrom(config, aliasKeys('invite', 'ctaLabel')) ??
        m.journey_invite_cta_default())
  );

  /**
   * Where one card's CTA goes. An enrolled viewer has nothing to buy, so every
   * card points at their dashboard; everyone else lands on the checkout with
   * THAT path pre-selected, so the choice made here survives the navigation.
   */
  function hrefFor(pathId: string | null): string {
    if (context.enrolled) return context.dashboardUrl;
    return pathId
      ? checkoutUrlForPath(context.checkoutUrl, pathId)
      : context.checkoutUrl;
  }

  /**
   * FOUR IDENTICAL LINK NAMES IS A WCAG 2.4.4 FAILURE, and the golden page ships
   * exactly that today: four anchors reading "Join now", distinguishable only by
   * the card they sit in. The path name disambiguates them, and because the
   * visible label is the accessible name's PREFIX, WCAG 2.5.3 (label in name) is
   * satisfied rather than broken by the override.
   *
   * It also closes the audit's other finding: the "Recommended" badge is visible
   * text but was not programmatically associated with the offer it labels. The
   * name it prefixes here is the plan's own `<h3>`, so a screen-reader user
   * navigating by heading meets the badge and the name together.
   */
  function ctaName(path: OfferPath): string {
    return `${ctaLabel} — ${path.name}`;
  }

  /**
   * THE DECLARED COMPOSITIONS, and a warning about what the pages STORE.
   *
   * Contract A33, repeating itself on this type: `seed-portals.ts:499` writes
   * `variant: 'card'` on every `invite` it creates, and the renderer discarded
   * `variant` entirely (`Codex-qcgo3`), so ALL SEVEN published pages **store
   * `card` while rendering the cinematic `pool` close**. Verified in the
   * database and in the served HTML — the golden page's wrapper already carries
   * `data-jp-variant="card"` while the DOM inside it is the descent-and-pool
   * markup this file has only ever had one of.
   *
   * So the moment this component honours `variant`, all seven flip to a quiet
   * card with NO atmosphere at all — `.jp-invite--card` (:44-46) hides the
   * bloom, the vignette and the descent hairline outright. That is precisely the
   * seed artifact A33 describes: the value came from a script rather than a
   * person, it was never expressed, and Candlelit's own variant map says
   * `invite: pool` (research §4.1). The data is the artifact.
   *
   * The fix is a stored-value migration plus a one-line seeder change, and both
   * live outside this worktree's file set — REPORTED, not made here. `pool` is
   * the fallback for an unknown id, which does NOT cover this case, because
   * `card` is a declared composition and honouring it is correct behaviour.
   */
  const COMPOSITIONS = ['pool', 'banner', 'card', 'tiers', 'table', 'sticky'];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'pool'
  );

  /**
   * `tiers` and `table` arrange the FULL plan detail — `who`, the bullets and
   * the blurb. The three ported compositions keep the terse card they ship
   * today (name, price, cadence, blurb) so no published page grows content it
   * has never displayed.
   *
   * Every field they add is already published one click later: the checkout
   * (`checkout/+page.svelte:204,212`) renders `offer.who` and `offer.bullets`
   * from this same derivation, so the sell page and the pay page finally state
   * the same thing. String discriminant, not a boolean — `apps/web` has
   * `strictNullChecks` OFF and a boolean-literal discriminant does not narrow.
   */
  const detail = $derived(
    composition === 'tiers' || composition === 'table' ? 'full' : 'terse'
  );

  /**
   * `accent: text` and `accent: edge` resolve `--jp-accent-fill` to
   * `transparent`, so a filled plate has nothing to paint and its paired ink
   * (`--jp-accent-on-fill`) would sit on the section background instead — which
   * is how a white badge letter lands on a cream page. On those two values the
   * "Recommended" badge becomes an OUTLINED pill with ladder ink; on the other
   * three it stays the filled pill it is today (pilot lesson 4).
   */
  const plated = $derived(
    design?.accent !== 'text' && design?.accent !== 'edge' ? 'yes' : 'no'
  );

  /**
   * ── THE AXES, MIRRORED ONTO THIS SECTION'S OWN ROOT ────────────────────────
   * `journey-design.css` turns the nine `data-jp-*` attributes on `.jp-sec` into
   * custom properties, and a section can only ever READ those. That stays the
   * default for everything with a magnitude: every size, rhythm, edge, colour
   * and duration below is still a `--jp-*` read.
   *
   * It is NOT sufficient, because a design language is not only a set of
   * magnitudes — it is which elements are boxes, which corner is square, which
   * label is monospaced, which numeral is tabular, which rule gets drawn at all.
   * Those are SELECTOR-level decisions, and a Svelte-scoped style block cannot
   * reach an ancestor's attribute, so the axis value is re-emitted here
   * UNMODIFIED as a local `data-*` attribute. `GuideSection`'s `look` is the
   * same mechanism, for the same reason.
   *
   * `media` IS DELIBERATELY ABSENT, and that is contract A50 holding rather than
   * an omission. The header above states why this type consumes no media axis at
   * all (no media field exists anywhere in its read model), and `media: none`
   * would have been a convenient key for `plain-facts` — so mirroring it would
   * have re-introduced a control that changes nothing, through the back door.
   * `edge: offset` identifies `plain-facts` just as uniquely and is a value this
   * section really does spend. `width` is absent for the ordinary reason: nothing
   * here needs to select on it, because `--jp-content-max` / `--jp-measure`
   * already carry it.
   *
   * `undefined` when no `design` arrives, so Svelte omits the attribute and every
   * per-look rule no-ops — the honest degradation. `SectionFrame` always passes a
   * TOTAL `ResolvedSectionDesign`, so both real render paths have all nine.
   */
  const look = $derived({
    surface: design?.surface,
    edge: design?.edge,
    align: design?.align,
    type: design?.type,
    accent: design?.accent,
    density: design?.density,
    motion: design?.motion,
  });

  /**
   * `sticky`'s pinning is an ENHANCEMENT over an in-flow bar, and a creator who
   * asks for no motion should not get a bar that follows them down the section.
   *
   * This used to be a separate `data-motion="on|none"` attribute, which is why
   * `FeelSection`'s own note cites this file as the precedent for the on/off
   * form. It is now the AXIS VALUE, matching `GuideSection` and `FeelSection`
   * (both of which key per-look rules on `data-motion='stagger'` / `'none'`), and
   * the pinning predicate becomes `:not([data-motion='none'])` — exactly the same
   * set, including the no-`design` case where the attribute is absent entirely.
   * One attribute cannot mean two things, and the per-look block below needs the
   * value.
   */
  const motionOn = $derived(design?.motion !== 'none');

  /**
   * `--jp-reveal-stagger` is calibrated for ~5 block beats and the shared
   * `.jp-reveal[data-jp-step]` ladder in `journey-sections-shared.css` stops at
   * 5, so a six-tier grid clamps rather than taking a second and a half to
   * assemble (pilot lesson 5). `maxItems: 6` on the `offers` repeater is the
   * ceiling, so one extra beat past the ladder is the worst case.
   */
  const step = (i: number): string => String(Math.min(i + 2, 5));

  /**
   * GENERIC CHROME, now keyed. Every string here is a neutral noun or a column
   * label rather than editorial voice, so it is the class `05-bridge-table.md`
   * calls "legitimate UI labels" — the same class as `journey_invite_cta_default`
   * above, and the opposite of `'Begin the work.'`, which is voice and therefore
   * falls back to the creator's own `course.title` instead of to a key.
   *
   * Kept as one object rather than inlined at each call site because that is how
   * it stayed reviewable while the keys were pending: the worktree could not add
   * them (contract A7/A20 — i18n is single-owner, and two worktrees regenerating
   * paraglide strips keys and produces runtime 500s), so it collected them here
   * and reported them. The orchestrator added all five to `messages/en.json` on
   * the round-3 report; this is the same object with the literals swapped out.
   *
   * `recommended` is the only one of the five that renders outside `table`.
   */
  const CHROME = {
    recommended: m.journey_invite_badge_recommended(),
    compareCaption: m.journey_invite_compare_caption(),
    rowPrice: m.journey_invite_row_price(),
    rowWho: m.journey_invite_row_who(),
    rowIncludes: m.journey_invite_row_includes(),
  };

  /**
   * One stable, SSR-consistent id so `table`'s scroll region can be NAMED by the
   * table's own caption instead of repeating the string. `$props.id()` (Svelte
   * 5.20+, and this repo is on 5.55) is generated identically on the server and
   * the client, so it survives hydration — a hand-rolled counter does not.
   *
   * TWO LINES, DELIBERATELY. `$props.id()` may only be a variable
   * declaration's DIRECT initializer at the top level of the component:
   * `const x = \`${$props.id()}-y\`` is a compile ERROR
   * ("`$props.id()` can only be used at the top level of components as a
   * variable declaration initializer"), and it fails at SSR with a 500 rather
   * than at typecheck.
   */
  const uid = $props.id();
  const captionId = `${uid}-invite-compare`;

  let mounted = $state(false);
  let reduced = $state(false);

  // Ambient loops (breathe / descent / pulse) only after JS confirms motion is
  // welcome; the static baseline stays the SSR / no-JS / reduced-motion render.
  const enhanced = $derived(mounted && !reduced && motionOn);

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
    editFieldAttrs('invite', key, editable, onEdit);
</script>

{#snippet badge()}
  <span class="invite__badge">{CHROME.recommended}</span>
{/snippet}

{#snippet priceBlock(path: OfferPath)}
  <!-- The amount and its cadence, both from `offer`. The cadence is NOT
       decorative metadata — a "£15" with no "per month" beside it is a
       different offer — so it reads the ladder's own secondary ink and never
       `--jp-faint` (contract A39). -->
  <p class="invite__price">
    <span class="invite__price-amount">{path.priceLabel}</span>
    <span class="invite__price-cadence">{path.cadenceLabel}</span>
  </p>
{/snippet}

{#snippet bullets(path: OfferPath)}
  {#if path.bullets.length > 0}
    <ul class="invite__bullets">
      {#each path.bullets as bullet (bullet)}
        <li>{bullet}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#if hasCopy || hasDoorway}
  <!-- NOTHING WHEN THERE IS NOTHING — see `hasCopy` / `hasDoorway` above. The
       atmosphere, the inner column and the `<header>` all live inside this
       guard, because it was the FRAME that was the defect: an empty
       `.invite__head` inside a lit `.invite__atmos` is a band of nothing at the
       foot of the page, and the ten sibling sections already collapse instead. -->
  <div
    class="invite"
    class:invite--enhanced={enhanced}
    data-invite={composition}
    data-detail={detail}
    data-plated={plated}
    data-surface={look.surface}
    data-edge={look.edge}
    data-align={look.align}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
    data-motion={look.motion}
  >
    <!-- THE ATMOSPHERE, gated ONCE on the shared parent (pilot lesson 3, a
         correction to research §2.3's per-layer gate). The bloom's opacity is
         ANIMATED, and a keyframe beats a `calc()` on the same element; on the
         parent the two compose multiplicatively, so the bloom keeps breathing
         under `surface: media` and resolves to zero opacity everywhere else. The
         markup stays mounted either way, which is cheaper and lower-risk than
         conditionally rendering it.

         `--invite-atmos` is the composition's own multiplier on top: `card` is
         defined as the quiet composition with no atmosphere at all
         (`_invite.css` :44-46), so it multiplies the whole layer to zero without
         needing a second gate in markup. -->
    <div class="invite__atmos" aria-hidden="true">
      <span class="invite__bloom"></span>
      <span class="invite__vignette"></span>
      <span class="invite__descent"><span class="invite__seed"></span></span>
    </div>

    <!-- ONE observer for the whole section, on the container.

         The shared atom in `journey-sections-shared.css` is
         `.reveal--armed .jp-reveal` — a DESCENDANT selector — and the `reveal`
         action adds `.reveal--armed` / `.is-in` to the node it is used on. So the
         action goes on the container and the staggered beats are its children;
         putting both on the same element matches nothing. One IntersectionObserver
         per section is also the cheaper shape.

         Scroll-triggered reveal is correct HERE, unlike the hero (pilot lesson 6):
         the invite is the page's close, below the fold on every real page. On a
         short page where `banner` or `sticky` opens above the fold, the observer
         fires on its first callback because the node is already intersecting, so
         nothing waits for a scroll that never comes. -->
    <div class="invite__inner" use:reveal={{ disabled: editable }}>
      <!-- NO EMPTY LANDMARK, AND NO PHANTOM COLUMN. `hasCopy || hasDoorway`
           above stops the whole section being a lit band of nothing, but the two
           are ORed, so the frame legitimately renders on `hasDoorway` ALONE —
           an unauthored invite on a purchasable course is a real state (nothing
           to say, something to sell). In exactly that state every child of this
           `<header>` self-hid and the header itself did not: `.invite__inner` is
           `display: flex` with `gap: var(--invite-block-gap)`, so the empty
           header still spent one whole block gap above the offer, and on `banner`
           — where `.invite__inner` is `grid-template-columns: 1fr auto` — it took
           the entire copy column and pushed the action into the narrow track.
           `hasCopy` is reused rather than restated: it already names the four
           fields this header holds. -->
      {#if hasCopy}
        <header class="invite__head jp-reveal">
          {#if eyebrow}
            <p class="jp-sec__eyebrow invite__eyebrow" {...editAttrs('eyebrow')}>
              {eyebrow}
            </p>
          {/if}
          <!-- `.jp-sec__heading` WITHOUT `--sub`, and this is the one deliberate
               departure from contract A36 in this file. A36's rule — "a section
               `<h2>` reads `--jp-heading-size`, NEVER `--jp-display`" — exists to
               stop a 48px heading being grown to 80px on every published page. This
               heading is ALREADY 80px: it is the only `<h2>` in the tree that ships
               `--text-display`, because the invite is the page's second display
               moment (the hero opens, the invite closes). Reading
               `--jp-heading-size` here would SHRINK it 80 → 48px on seven pages,
               breaking the same A3/D8 invariant A36 protects, from the other side.

               Measured both ways, at a real viewport (the `--text-*` steps carry
               `vw`, so a container-only probe reads the wrong number):

                 type          this h2 (--jp-display)    A36's letter (--jp-heading-size)
                 restrained    24.6 / 28.5 / 30 px       20.4 / 23.4 / 24 px
                 balanced      37.2 / 46.1 / 48 px       24.6 / 28.5 / 30 px
                 expressive    28.0 / 35.2 / 44 px       31.0 / 38.4 / 40 px
                 monumental    44.0 / 50.6 / 80 px       37.2 / 46.1 / 48 px
                                            (375 / 768 / 1440 viewport)

               `monumental` is Candlelit and is what all seven pages carry, and its
               column is IDENTICAL to the base commit's fixed `var(--text-display)`
               at all three widths — 44 / 50.56 / 80px before and after. Zero delta.

               NOTE THE LADDER IS NOT MONOTONIC: `expressive` renders SMALLER than
               `balanced` at every width, because `--text-5xl` maxes at 2.75rem while
               `--text-4xl` maxes at 3rem. That is a `tokens/typography` ladder
               defect, not this section's — `--jp-heading-size` (24/30/40/48) is
               monotonic — and it affects every consumer of `--jp-display`.
               Reported, not fixed here. -->
          <!-- SELF-HIDING, because the fallback is claimed once per page and this
               section may not be the claimant. An EMPTY `<h2>` would be worse than
               none: this is the only `<h2>` in the tree carrying `--text-display`
               (80px on the seeded pages), so a blank one is a screenful of nothing
               between the eyebrow and the offer.

               GUARDED ON `heading || accent`, not on `heading` alone. The accent is
               the creator's own words — the italic second line closing the heading —
               so an authored accent still gets a heading element to live in, and the
               `&nbsp;` separator only appears when there is something on both sides of
               it. Dropping authored copy because the field beside it is blank is the
               class of loss most of this file's history is made of. -->
          {#if heading || accent}
            <h2 class="jp-sec__heading invite__heading">
              {#if heading}<span {...editAttrs('heading')}>{heading}</span
                >{/if}{#if heading && accent}&nbsp;{/if}{#if accent}<span
                  class="invite__accent"
                  {...editAttrs('accent')}>{accent}</span
                >{/if}
            </h2>
          {/if}
          {#if sub}
            <p class="invite__sub" {...editAttrs('sub')}>{sub}</p>
          {/if}
        </header>
      {/if}

      {#if context.enrolled || paths.length === 0}
        <!-- THE PRICE-LESS THRESHOLD — a warm doorway seated on its own ember
             pool so beginning feels contained, safe, inevitable.

             NO PRICE HERE BY DESIGN. This branch is reached when the offer read
             was unavailable or the course has no purchasable path, and in both
             cases the checkout is the only surface that can state the terms. It is
             the live state on four of the seven pages, and it is the state every
             composition below falls back to — `sticky` renders its bar with this
             CTA and no amount, `tiers` and `table` render nothing at all rather
             than an empty grid.

             AN ENROLLED VIEWER TAKES THIS BRANCH TOO, and that is the fix for the
             state below: the compositions rendered every priced path to a member
             who had already bought, re-pointing each card's CTA to the same
             dashboard. Four cards quoting £24.99 / £27 / £270 / £15 to someone
             holding all of it, behind four links with one destination — and the
             file already said why that was wrong ("An enrolled viewer has nothing
             to buy") while rendering the buying UI anyway. It also compounded the
             WCAG 2.4.4 duplicate-link-name problem the composition CTAs work
             around: for an enrolled viewer the four names were not merely similar,
             they were the same link four times.
             `hrefFor(null)` already resolves to `dashboardUrl` and `ctaLabel`
             already reads the enrolled string, so the enrolled state needs no new
             markup — only this branch. -->
        <!-- THE LAST DEAD END, closed. A viewer who is not enrolled AND whose
             course has no purchasable path gets NO transactional affordance here.
             This branch used to render `hrefFor(null)` → `checkoutUrl` for them,
             and that checkout answers "<Course> isn't open for enrolment just
             now" after re-pitching the course in full — a closed loop back to the
             page they came from. It was the third of three such affordances; the
             hero CTA and the floating pill were withheld earlier, and this one
             could not be fixed in the same change because the file was owned by a
             different writer.

             THE TEST IS `=== false`, NOT `!context.purchasable`, and the
             distinction is the whole point: `purchasable` is a CONFIDENT NEGATIVE.
             A FAILED offer read leaves it true (the read is `.catch(() => null)`-
             guarded on an SEO-critical page), and a failed read also produces an
             empty `paths` array — so testing truthiness would strip the buy button
             off a perfectly purchasable page on any transient pricing hiccup. That
             is the opposite defect, on the same element.

             AN ENROLLED VIEWER IS UNAFFECTED: `hrefFor(null)` resolves to
             `dashboardUrl` for them and `ctaLabel` already reads the enrolled
             string, so their doorway is not transactional and stays exactly as it
             was. The eyebrow, heading and sub above still render — they are the
             creator's editorial copy, and a section with something to say is not
             the same as a section with something to sell. -->
        {#if context.enrolled || context.purchasable !== false}
          <div class="invite__single jp-reveal" data-jp-step="2">
            <div class="invite__pool" aria-hidden="true"></div>
            <CtaLink href={hrefFor(null)} variant="primary" size="lg">
              {ctaLabel}
            </CtaLink>
            <!-- The risk note ("Start free · cancel anytime") is purchase copy. It
                 says nothing true to a member who has already joined. -->
            {#if priceNote && !context.enrolled}
              <p class="invite__note" {...editAttrs('risk')}>{priceNote}</p>
            {/if}
          </div>
        {/if}
      {:else if composition === 'table'}
        <!-- COMPOSITION · table — a comparison matrix across the available paths.

             TRANSPOSED: the paths are COLUMNS and the attributes are ROWS. A
             feature matrix with one row per feature would need a union of feature
             labels across paths, and `bullets` is per-path free text — there is no
             such union in the read model, so the ✓/✗ grid the name suggests would
             be a control that renders nothing. WT-4 shipped `map.table` with three
             columns rather than the research's four for exactly this reason
             (contract A50). Every row below is a real field on `OfferPath`.

             `<th scope>` on both axes, and a visually-hidden `<caption>`, because
             a comparison table read cell-by-cell without headers is unusable.

             THE SCROLLER IS FOCUSABLE, and that is a measured requirement rather
             than belt-and-braces. Measured at a 375px section: the matrix's
             min-content is 733px against a 330px content box, so the region really
             does scroll and two of the four paths really are off-screen. A
             container that scrolls but cannot be focused is not keyboard-operable
             (WCAG 2.1.1) — Chrome gives no keyboard scrolling to a non-focusable
             overflow box. `role="region"` is what lets `tabindex` sit on a
             non-interactive element without tripping Svelte's
             `a11y_no_noninteractive_tabindex`, and it is named by the table's own
             caption via `aria-labelledby` so the string is announced once rather
             than duplicated into an `aria-label`. It is also the ONE focusable
             element in this section that is not a `CtaLink`, so it carries the R14
             ring itself — see the rule beside `.invite__scroller`.

             AUTOFIXER FINDING, REJECTED WITH REASONS AND RE-CHECKED:
             `svelte-autofixer` flags `tabindex="0"` here as
             `a11y_no_noninteractive_tabindex`, because `region` is a landmark and
             landmarks are non-interactive. The rule is right in general — a stray
             tabindex on a `<div>` is a real defect — and wrong for a SCROLL
             CONTAINER, which is the documented exception: WCAG 2.1.1 and the ARIA
             practices' scrollable-region guidance both require a region that
             scrolls to be keyboard-operable, and a browser gives no keyboard
             scrolling to a non-focusable overflow box. This region DOES scroll —
             733px of min-content in a 330px box, measured. So the warning is
             suppressed at the narrowest possible scope, one element, rather than
             the behaviour being removed. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="invite__scroller"
          role="region"
          tabindex="0"
          aria-labelledby={captionId}
        >
          <table class="invite__table">
            <caption id={captionId} class="sr-only">{CHROME.compareCaption}</caption>
            <thead>
              <tr>
                <td></td>
                {#each paths as path (path.id)}
                  <th scope="col" data-best={path.best ? 'true' : undefined}>
                    {#if path.best}{@render badge()}{/if}
                    <span class="invite__offer-name">{path.name}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{CHROME.rowPrice}</th>
                {#each paths as path (path.id)}
                  <td data-best={path.best ? 'true' : undefined}>
                    {@render priceBlock(path)}
                  </td>
                {/each}
              </tr>
              {#if paths.some((p) => p.who)}
                <tr>
                  <th scope="row">{CHROME.rowWho}</th>
                  {#each paths as path (path.id)}
                    <td data-best={path.best ? 'true' : undefined}>
                      {path.who ?? ''}
                    </td>
                  {/each}
                </tr>
              {/if}
              {#if paths.some((p) => p.bullets.length > 0)}
                <tr>
                  <th scope="row">{CHROME.rowIncludes}</th>
                  {#each paths as path (path.id)}
                    <td data-best={path.best ? 'true' : undefined}>
                      {@render bullets(path)}
                    </td>
                  {/each}
                </tr>
              {/if}
            </tbody>
            <tfoot>
              <tr>
                <td></td>
                {#each paths as path (path.id)}
                  <td data-best={path.best ? 'true' : undefined}>
                    <CtaLink
                      href={hrefFor(path.id)}
                      variant={path.best ? 'primary' : 'secondary'}
                      size="md"
                      aria-label={ctaName(path)}
                    >
                      {ctaLabel}
                    </CtaLink>
                  </td>
                {/each}
              </tr>
            </tfoot>
          </table>
        </div>
        {#if priceNote}
          <p class="invite__note jp-reveal" data-jp-step="3" {...editAttrs('risk')}>
            {priceNote}
          </p>
        {/if}
      {:else if composition === 'sticky'}
        <!-- COMPOSITION · sticky — a short in-flow section plus a bar that pins.

             THE STATIC BAR IS THE BASELINE (contract A40). It is a normal block in
             the flow here; the pinning lives entirely inside
             `@media (prefers-reduced-motion: no-preference)` further down, gated
             on `data-motion`. Nothing to undo, so nothing to forget.

             The bar carries the RECOMMENDED path — one amount and one CTA, because
             a pinned bar with four choices is a menu, not a bar. The full grid is
             not repeated: `tiers` is the composition for comparing. -->
        {@const best = paths.find((p) => p.best) ?? paths[0]}
        <div class="invite__bar jp-reveal" data-jp-step="2">
          <span class="invite__bar-id">
            <span class="invite__offer-name">{best.name}</span>
            {@render priceBlock(best)}
          </span>
          <CtaLink
            href={hrefFor(best.id)}
            variant="primary"
            size="md"
            aria-label={ctaName(best)}
          >
            {ctaLabel}
          </CtaLink>
        </div>
        {#if priceNote}
          <p class="invite__note jp-reveal" data-jp-step="3" {...editAttrs('risk')}>
            {priceNote}
          </p>
        {/if}
      {:else}
        <!-- COMPOSITIONS · pool / banner / card / tiers — one card per real path.

             `auto-fit` + a FLEXIBLE max, never a fixed one. The old ladder was
             `1fr` → `repeat(3, minmax(0, 1fr))` at a viewport breakpoint: a baked
             -in column count that put the golden page's FOUR paths into 3 + 1
             orphan. `minmax(min(100%, 16rem), 1fr)` makes the count fall out of
             the container's own width, which is what container-query scoping is
             for. The max is `1fr` and not a rem value because a fixed max makes
             the repetition count resolve to 1 — measured, three cards stacked in
             one column at every width (contract A48). -->
        <ul class="invite__offers">
          {#each paths as path, i (path.id)}
            {@const href = hrefFor(path.id)}
            <li
              class="invite__offer jp-reveal"
              data-jp-step={step(i)}
              data-best={path.best ? 'true' : undefined}
            >
              {#if path.best}{@render badge()}{/if}
              <h3 class="invite__offer-name">{path.name}</h3>
              {@render priceBlock(path)}
              {#if detail === 'full' && path.who}
                <p class="invite__offer-who">{path.who}</p>
              {/if}
              {#if path.blurb}
                <p class="invite__offer-blurb">{path.blurb}</p>
              {/if}
              {#if detail === 'full'}{@render bullets(path)}{/if}
              <CtaLink
                {href}
                variant={path.best ? 'primary' : 'secondary'}
                size="md"
                aria-label={ctaName(path)}
              >
                {ctaLabel}
              </CtaLink>
            </li>
          {/each}
        </ul>
        {#if priceNote}
          <p class="invite__note jp-reveal" data-jp-step="5" {...editAttrs('risk')}>
            {priceNote}
          </p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX — every value an axis read.

     `--jp-sec-pad-block` / `--jp-sec-pad-inline` / `--jp-sec-gap` are the shared
     role aliases declared once in `journey-design.css`. They contain `6cqw`, so
     they MUST be consumed on a DESCENDANT of `.jp-sec` — an element is not its
     own query container, and reading them on the wrapper silently resolves the
     `cqw` against the page instead of the section (pilot lesson 1). `.invite` is
     that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .invite {
    position: relative;
    isolation: isolate;
    display: grid;
    place-items: center;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--invite-shell-border);
    border-radius: var(--invite-shell-radius);
    box-shadow: var(--invite-shell-shadow);
    text-align: var(--jp-text-align);
    overflow: clip;

    /*
      THE STAGE HEIGHT, on the `density` axis rather than the rhythm clamp.
      Multiplying `100svh` by `vast`'s 1.6 asks for 128svh and hides the CTA —
      on the page's conversion surface that is the worst possible failure. The
      pilot swept this shape and measured compact 60svh · regular 80svh · airy
      100svh · vast capped, so `airy` — Candlelit's value, and what all seven
      published pages carry — lands on exactly today's `100svh` (pilot lesson 2).

      `svh` and not `cqh`: `cqh` silently falls back to the small viewport under
      `inline-size` containment, so a container-relative height here would be a
      viewport height wearing a container-query name (pilot lesson 7).
    */
    min-height: min(100svh, calc(80svh * var(--jp-rhythm)));

    /*
      THE PRICE AMOUNT'S OWN SCALE, and it is the one element in this section
      that earns one.

      `--jp-body-size` is the `type` axis's card-scale rung (contract A44) and
      everything else at card scale here reads it directly. The price does not:
      it is the single most consequential number on the page, and at
      `monumental` the rung is 24px against the 40px this section has always
      shipped. So it is DERIVED FROM the rung — never from `--jp-heading-size`
      again, and never a re-spelled clamp — with `--text-2xl` as a floor so no
      axis value can shrink the amount into the body copy around it.

      `5 / 3` is solved backwards exactly as the pilot solved its `80svh`: at
      `monumental` the rung is `--text-xl` (24px) and today's price is
      `--text-3xl` (40px). Measured, desktop: 30 / 30 / 33 / 40px across
      restrained / balanced / expressive / monumental — so the axis genuinely
      reaches the price, and Candlelit lands on today's value exactly.
    */
    --invite-price-size: max(
      var(--text-2xl),
      calc(var(--jp-body-size) * 5 / 3)
    );

    /* The gap between the section's blocks (head / offers / note). It was a
       fixed `--space-10`, so `density` could not reach it. Expressed as a
       multiple of the shared `--jp-sec-gap` — which already carries the rhythm —
       and 1.34 is solved backwards so `airy` lands on the 40px this section
       shipped before the axes existed. */
    --invite-block-gap: calc(var(--jp-sec-gap) * 1.34);

    /* ── THE ROLE TABLE, so a look is a VALUE and not a rule ───────────────
       The PER-LOOK COMMITMENTS block at the foot of this file is keyed on axis
       values (`edge: offset`, `accent: none`, …). Written as paint rules, six of
       the eight looks would re-declare the same card / badge / numeral
       declarations — the shape that produced the eight different spellings of
       `clamp(2rem, 6cqw, 4.4rem)` this tree is still cleaning up. Written as
       properties, a look states its VALUES and the paint stays in one place,
       which is the discipline `journey-design.css` holds itself to.

       EVERY DEFAULT HERE REPRODUCES THE BASE COMMIT EXACTLY. That is the whole
       point of the table rather than a nicety: `candlelit` matches none of the
       per-look selectors, so it resolves these defaults, and a default that
       merely looked reasonable would silently have restyled the one preset that
       already works. Byte-for-byte, what each default replaces:

         --invite-shell-*     the three declarations `.invite` already made
         --invite-card-*      `--radius-card` / axis border / axis shadow /
                              `--color-surface-secondary` / `space-6 * rhythm`
         --invite-best-*      the 2px `--jp-accent-mark` inset ring, no fill,
                              no elevation of its own
         --invite-badge-*     `--radius-full`, `--text-xs`, `--font-semibold`
         --invite-num-*       `--font-heading`, inherited weight, `normal`
                              numerals — i.e. no change
         --invite-label-font  `inherit`; the eyebrow had NO local rule at all,
                              so `inherit` is what it already computed
         --invite-head-*      `0px` paints no rule
         --invite-tick-*      the `--space-2` round dot
         --invite-table-rule  the fixed hairline the matrix already drew
         --radius-button      re-pointed only, never redefined: `CtaLink` reads
                              it for `border-radius` and this is the ONLY way a
                              section can reach the pay button's GEOMETRY
                              without becoming a second styler of `.cta`
                              (`journey-design.test.ts`, Codex-kdsuo — colour is
                              guaranteed in exactly one place and this file
                              never touches it)

       `0px`, `1em` and `0 none` — never a bare `0` or `1`. These substitute into
       `border-block-end`, `font-size` and `border`, and a UNITLESS zero in a
       length slot is the A63/A64 class of failure that invalidates the whole
       declaration silently.

       AND NOTHING IN THIS TABLE MAY BE COMPOSED INTO A LIST. Three of these hold
       `var(--jp-edge-shadow)`, which is the KEYWORD `none` at `edge: none`
       (candlelit) and `edge: heavy`; `box-shadow`'s grammar is `none | <shadow>#`
       so `none` as one item of a comma list invalidates the declaration at
       computed-value time and paints nothing (contract A54). Each is read as the
       WHOLE value of its own property. The local indirection is not a loophole
       around `journey-design.test.ts`'s list guard — it is the same rule, one
       level down, and it is stated here because the guard cannot see through
       an alias. */
    --invite-shell-radius: var(--jp-sec-radius);
    --invite-shell-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --invite-shell-shadow: var(--jp-edge-shadow);

    --invite-card-radius: var(--radius-card);
    --invite-card-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --invite-card-shadow: var(--jp-edge-shadow);
    --invite-card-bg: var(--color-surface-secondary);
    --invite-card-pad: calc(var(--space-6) * var(--jp-rhythm));

    --invite-best-outline: var(--border-width-thick) solid var(--jp-accent-mark);
    --invite-best-offset: calc(var(--border-width-thick) * -1);
    --invite-best-bg: var(--invite-card-bg);
    --invite-best-shadow: var(--invite-card-shadow);
    --invite-best-stripe: 0 none;

    /* THE BADGE, as seven values rather than seven rules. Three families state
       their recommended flag as "not a plate" — `syllabus` explicitly ("a
       left-border accent stripe RATHER THAN a filled badge"), `quiet-studio`
       ("no accent colour"), `long-read` ("no box borders anywhere") — and one
       (`open-air`) as a tint, "never a hard fill". The plate that survives is
       the filled pill three other looks keep, including candlelit.
       `--invite-badge-pos: static` is what un-straddles it from the card's top
       border and drops it into the card flow, which is why `align-self` appears
       on the base rule at all. */
    --invite-badge-pos: absolute;
    --invite-badge-shift: translateY(-50%);
    --invite-badge-pad: var(--space-1) var(--space-3);
    --invite-badge-radius: var(--radius-full);
    --invite-badge-size: var(--text-xs);
    --invite-badge-weight: var(--font-semibold);
    --invite-badge-tracking: var(--tracking-wider);
    --invite-badge-bg: var(--jp-accent-fill);
    --invite-badge-ink: var(--jp-accent-on-fill);
    --invite-badge-ring: none;

    --invite-num-font: var(--font-heading);
    --invite-num-weight: inherit;
    --invite-num-variant: normal;

    --invite-label-font: inherit;
    --invite-rowhead-size: calc(var(--jp-body-size) / 1.2);
    --invite-sub-size: var(--text-lg);

    --invite-head-rule: 0px;
    --invite-head-gap: 0px;

    --invite-tick-w: var(--space-2);
    --invite-tick-h: var(--space-2);
    --invite-tick-radius: var(--radius-full);

    --invite-table-rule: var(--border-width) solid var(--color-border-subtle);

    --invite-single-ring: var(--border-width) solid var(--jp-accent-edge);
    --invite-bar-ring: var(--border-width) solid var(--jp-accent-mark);
  }

  /* ── the atmosphere ─────────────────────────────────────────────────────
     ONE gate, on the parent (pilot lesson 3). `--jp-sec-atmos` is the `surface`
     axis's 0/1 switch; `--invite-atmos` is the composition's multiplier on top,
     so `card` — "one quiet card, no atmosphere" — needs no markup branch. */
  .invite__atmos {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: calc(var(--jp-sec-atmos) * var(--invite-atmos, 1));
  }

  /* Warm ground: brand light rising from the floor onto a settling dark base.
     This is the deep you arrive at — it fills the lower space, never a void.

     `--jp-accent-mark`, never `--jp-accent-fill`: the latter is `transparent` at
     `accent: text` and `accent: edge`, so the whole close went flat on two of
     five values (pilot lesson 4). Decorative rather than a meaningful graphic,
     so the 3:1 floor does not apply and a low mix is honest here — the same
     shape as `.proof__atmos`.

     `--color-background` and not a raw `#000` for the settling base (contract
     A18): a hardcoded black wash is what breaks a light-brand org, and
     `of-blood-and-bones` light is cream `#F6EFE6`. */
  .invite__bloom {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        115% 62% at 50% 122%,
        color-mix(in oklab, var(--jp-accent-mark) 26%, transparent),
        transparent 62%
      ),
      radial-gradient(
        85% 50% at 50% 112%,
        color-mix(in oklab, var(--jp-accent-edge) 24%, transparent),
        transparent 58%
      ),
      linear-gradient(
        180deg,
        transparent 40%,
        color-mix(in oklab, var(--color-background) 62%, transparent)
      );
  }

  /* Centred vignette focuses the eye and deepens the cinematic close. */
  .invite__vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      120% 90% at 50% 46%,
      transparent 52%,
      color-mix(in oklab, var(--color-background) 72%, transparent)
    );
  }

  /* ── the descent hairline + arriving spark + glowing seed ──
     "You have come all the way down." A small decorative brand mark, so
     `--jp-accent-mark` throughout — it is a real colour on all five accent
     values, where `--jp-accent-fill` is transparent on two. */
  .invite__descent {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: var(--border-width);
    height: clamp(
      var(--space-16),
      13svh,
      calc(var(--space-32) * var(--jp-rhythm))
    );
    background: linear-gradient(
      180deg,
      transparent,
      color-mix(in oklab, var(--jp-accent-mark) 52%, transparent)
    );
  }

  .invite__descent::before {
    /* the arriving spark — hidden until the ambient loop animates it */
    content: '';
    position: absolute;
    left: 50%;
    top: calc(var(--space-1) * -1);
    transform: translateX(-50%);
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    opacity: 0;
    background: var(--jp-accent-mark);
    box-shadow: 0 0 var(--space-3) var(--space-1)
      color-mix(in oklab, var(--jp-accent-mark) 70%, transparent);
  }

  .invite__seed {
    /* the point of arrival — the ground */
    position: absolute;
    bottom: calc(var(--space-1) * -1);
    left: 50%;
    transform: translateX(-50%);
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--jp-accent-mark);
    box-shadow: 0 0 var(--space-5) var(--space-1)
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
  }

  /* ── the content column ───────────────────────────────────────────────── */
  .invite__inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: var(--invite-block-gap);
    width: 100%;
    max-width: var(--jp-content-max);
    margin-inline: auto;
    /*
      MEASURED, and it is the difference between a scrolling table and a clipped
      one. A grid item's `min-width` is `auto`, so it refuses to shrink below its
      MIN-CONTENT — and `table`'s four columns have a min-content of ~733px. At a
      375px section this column grew to 733px, overflowed the 330px content box,
      and `overflow: clip` on the section quietly cut the last two paths off.
      `overflowsX` on the document read `false` the whole time, which is exactly
      why it needs measuring rather than eyeballing: the page did not scroll
      sideways because the content had been thrown away instead.

      With `min-width: 0` the column tracks the container and
      `.invite__scroller` does the scrolling, which is the rule anyway — wide
      content scrolls inside its own box and the page body never scrolls
      horizontally.
    */
    min-width: 0;
  }

  .invite__head {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: calc(var(--space-3) * var(--jp-rhythm));
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    /* The head hairline, OFF by default (`0px` paints no rule). `long-read`'s
       tell is "a hairline under every section head" and the measurement found it
       nowhere in the tree; `syllabus` wants the same rule so a block reads as a
       table with a header row. Both are `--invite-head-rule` VALUES rather than
       two more selectors. */
    padding-block-end: var(--invite-head-gap);
    border-block-end: var(--invite-head-rule) solid var(--color-border-subtle);
  }

  /* NO LOCAL RULE BEFORE THIS, deliberately: the `.jp-sec__eyebrow` atom already
     owns size (`--jp-eyebrow-size`, the `type` axis's own seam), tracking, weight
     and colour, and re-spelling any of them here would take the label off the
     axis. What this adds is the two roles the atom does NOT name — the FACE, so
     `plain-facts` and `syllabus` can set their families' mono label, and the ink,
     so the two families that deploy "accent as text" can spend it. Both default
     to what the atom already computed: `inherit` is the atom's own effective face
     (it sets none), and `--color-text-secondary` is the value it sets. */
  .invite__eyebrow {
    font-family: var(--invite-label-font);
    color: var(--color-text-secondary);
  }

  .invite__heading {
    margin: 0;
  }

  /* The authored italic accent closing the heading. `--jp-accent-text` — never
     `--jp-ember`, which measures 2.04:1 as text in dark (research §5.1). Same
     treatment as `HeroSection`'s accent, so a page's two display moments read
     as one voice. */
  .invite__accent {
    font-style: italic;
    color: var(--jp-accent-text);
  }

  .invite__sub {
    margin: 0;
    font-size: var(--invite-sub-size);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ── the offer grid ───────────────────────────────────────────────────── */
  .invite__offers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: var(--jp-sec-gap);
    align-items: stretch;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* The card. Border and elevation come from the `edge` axis — that is what puts
     the brutalist (`offset`) and wellness (`soft`) families within reach of the
     thing this section is made of. Under `edge: none` (Candlelit, and what all
     seven published pages carry) the card keeps its own plate: the surface
     itself is its identity, not the border, and the background is today's exact
     opaque `--color-surface-secondary` so the ink on it measures unchanged.

     RADIUS IS A TOKEN, NOT AN AXIS, deliberately: `radius` was considered and
     CUT as an axis (research §2.7), and `--jp-sec-radius` describes the SECTION
     box, which is squared under `surface: bare`/`media`. A card is a component,
     so it reads the component token. */
  .invite__offer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-3) * var(--jp-rhythm));
    padding: var(--invite-card-pad);
    border-radius: var(--invite-card-radius);
    border: var(--invite-card-border);
    box-shadow: var(--invite-card-shadow);
    background: var(--invite-card-bg);
    /* A CARD's copy stays left-aligned regardless of `align`, and this is
       deliberate rather than an oversight — it is also today's effective value,
       since nothing set `text-align` on the grid. `align` positions the
       section's own column, and a centred four-line offer inside a 16rem card is
       markedly harder to scan than a left-aligned one. */
    text-align: left;
  }

  /*
    THE RECOMMENDED RING — the one graphic in this section that owes 3:1, because
    it is the only thing distinguishing the path the page recommends.

    An INSET ring rather than `border-color`, so it composes with the `edge` axis
    instead of fighting it: at `edge: heavy` the axis already colours the border
    with `--jp-accent-edge`, and at `edge: none` there is no border to colour at
    all — the ring has to exist independently of both.

    `--jp-accent-mark`, at FULL strength, and both halves of that are measured
    lessons. The colour: `--jp-accent-edge` at `accent: glow` — Candlelit, and
    what every published page carries — is already a 45% ember mix, and A39
    measured 45% at 2.05:1 against the 3:1 floor. Measured again here: 2.30:1
    light / 1.27:1 dark on `of-blood-and-bones`. `--jp-accent-mark` tracks the
    AA-safe `--jp-ember-text` on four of five values and `--jp-heading` on the
    fifth, so it clears the floor everywhere (contract A38). The strength: no
    percentage is carried onto it, because the axis token IS the strength the
    axis chose and 26% of a 45% mix is ~12% — the shape that regressed a ring
    from 3.32:1 to 1.62:1 (contract A37). Resting versus recommended is carried
    on ring WEIGHT, not on opacity (A39).

    ── `outline`, NOT `box-shadow`, AND THAT IS A MEASURED FIX ────────────────
    This was written as `box-shadow: inset 0 0 0 2px MARK, var(--jp-edge-shadow)`
    and THE RING DID NOT RENDER AT ALL on any published page. `--jp-edge-shadow`
    resolves to the literal keyword `none` at `edge: none` (Candlelit, all seven
    pages) and at `edge: heavy`, and `box-shadow`'s grammar is
    `none | <shadow>#` — `none` may not appear as one ITEM of a comma list. The
    substitution therefore makes the whole declaration invalid at computed-value
    time, box-shadow is not inherited, and the property falls back to its initial
    value, which is `none`. Measured: `getComputedStyle(best).boxShadow` came back
    `"none"` at `edge: none` and `edge: heavy`, and the ring + elevation at the
    other three. A bare literal behaves identically (`inset 0 0 0 2px red, none`
    computes to `none`), so this is the grammar, not a var() quirk.

    This is the SAME trap the threshold card below documents for `border` math,
    from the other side: there the token's unitless `0` poisoned a `max()`; here
    the token's `none` poisons a shadow LIST. The rule that covers both: never
    compose `--jp-edge-*` into anything — read it as the whole value of its own
    property, or not at all.

    `outline` + a negative `outline-offset` draws the identical inset ring on its
    own property, so the axis keeps `box-shadow` entirely and the base
    `.invite__offer` rule's `var(--jp-edge-shadow)` still applies. The recommended
    card and its siblings now carry the SAME elevation and differ only in the
    ring, which is what "resting versus recommended is ring weight" was supposed
    to mean. Outline follows `border-radius`, and the card is an `<li>` that is
    never focusable, so this cannot collide with the CTA's own focus ring.
  */
  /*
    THE FOUR ROLES A "RECOMMENDED" CARD CAN SPEND, and only the first is on by
    default. The ring is candlelit's and the base commit's; the other three exist
    because three families say the recommended path in their own vocabulary and
    a ring is not it — `syllabus` uses a LEFT STRIPE "rather than a filled
    badge", `open-air` has "no border anywhere" so it must use a tint, and
    `signal` lifts the featured tier on "a small neutral shadow". Their defaults
    are no-ops: `--invite-best-bg` and `--invite-best-shadow` re-read the card's
    own values, and `--invite-best-stripe` is `0 none`.

    `border-inline-start` is the stripe's own property, so it overrides exactly
    one side of `.invite__offer`'s `border` shorthand and needs no math on
    `--jp-edge-width`.
  */
  .invite__offer[data-best='true'] {
    outline: var(--invite-best-outline);
    outline-offset: var(--invite-best-offset);
    border-inline-start: var(--invite-best-stripe);
    box-shadow: var(--invite-best-shadow);
    background: var(--invite-best-bg);
  }

  .invite__badge {
    position: var(--invite-badge-pos);
    top: 0;
    right: var(--space-5);
    /* Only consulted when `--invite-badge-pos` resolves to `static`: an
       absolutely-positioned flex child with both offsets resolved ignores its
       align-self entirely, so this is inert on the default and is what
       shrink-wraps the label once a look drops it into the card's flow. */
    align-self: flex-start;
    transform: var(--invite-badge-shift);
    padding: var(--invite-badge-pad);
    border-radius: var(--invite-badge-radius);
    font-family: var(--invite-label-font);
    font-size: var(--invite-badge-size);
    font-weight: var(--invite-badge-weight);
    letter-spacing: var(--invite-badge-tracking);
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--invite-badge-ink);
    background: var(--invite-badge-bg);
    /* THE WHOLE VALUE of its own `box-shadow`, default `none` — which is the
       initial value the base rule computed, so this adds nothing to candlelit. */
    box-shadow: var(--invite-badge-ring);
  }

  /* `accent: text` and `accent: edge` make `--jp-accent-fill` transparent, so
     there is no plate for `--jp-accent-on-fill` to sit on. Outlined pill +
     ladder ink (pilot lesson 4).

     NOW EXPRESSED AS THE THREE ROLE VALUES rather than as paint, so the per-look
     block below can restate them instead of having to out-specify them. Note
     this rule and the per-look blocks keyed on a single axis value are BOTH
     (0,2,0), so source order is what decides — which is the ordinary CSS reason
     the PER-LOOK COMMITMENTS block is last in the file and not merely tidy. */
  .invite[data-plated='no'] {
    --invite-badge-bg: transparent;
    --invite-badge-ink: var(--color-heading);
    --invite-badge-ring: inset 0 0 0 var(--border-width) var(--jp-accent-mark);
  }

  /* Card-scale text reads the `type` axis's third rung (contract A44,
     `Codex-8oznv`) rather than a fourth independently-derived clamp. Measured
     17 / 17 / 20 / 24px across the four `type` values. */
  .invite__offer-name {
    margin: 0;
    font-weight: var(--font-semibold);
    font-size: var(--jp-body-size);
    line-height: var(--leading-snug);
    color: var(--color-text);
  }

  .invite__price {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
  }

  /* Deliberately only the SIZE moves onto the axis. Face, weight, leading and
     tracking are left exactly as this section has always had them (inherited
     from the `<p>`), because each is an independent appearance change on seven
     published pages and none of them is what the `type` axis is for.
     `--invite-num-*` therefore default to precisely that: `--font-heading`,
     inherited weight, `normal` numerals. They exist because the amount is THE
     numeral of this section, and three families make a mechanical statement
     about numerals — mono for `plain-facts` and `syllabus`, tabular so digits
     cannot shuffle, and big for `full-send`. */
  .invite__price-amount {
    font-family: var(--invite-num-font);
    font-weight: var(--invite-num-weight);
    font-variant-numeric: var(--invite-num-variant);
    font-size: var(--invite-price-size);
    color: var(--color-heading);
  }

  /* `--color-text-secondary` resolves to `--jp-dim` on a journey page (7.79:1
     dark / 11.05:1 light, measured), NOT to `--jp-faint`. A price cadence is not
     non-essential text — "£15" without "per month" is a different offer — so it
     may never sit on the faint rung (contract A39). */
  .invite__price-cadence,
  .invite__offer-who,
  .invite__note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .invite__offer-blurb {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    /* Today's value: it is what pushes the CTA to the card floor so a row of
       cards lines its buttons up. */
    flex-grow: 1;
  }

  .invite__bullets {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text);
    flex-grow: 1;
  }

  /* The tick is a small decorative brand mark, so it takes `--jp-accent-mark`
     and NOT `--jp-accent-fill`. It is `aria-hidden` by construction — a `::before`
     is not in the accessibility tree — and the bullet text carries the meaning. */
  .invite__bullets li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2);
    text-align: left;
  }

  .invite__bullets li::before {
    content: '';
    width: var(--invite-tick-w);
    height: var(--invite-tick-h);
    margin-top: calc(var(--space-2) * 0.75);
    border-radius: var(--invite-tick-radius);
    background: var(--jp-accent-mark);
  }

  .invite__note {
    align-self: var(--jp-align);
  }

  /* ── the price-less threshold ─────────────────────────────────────────── */
  .invite__single {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--space-4) * var(--jp-rhythm));
    padding: calc(var(--space-8) * var(--jp-rhythm))
      calc(var(--space-10) * var(--jp-rhythm));
    border-radius: var(--invite-card-radius);
    /*
      A FLOOR ON THE BOUNDARY, for the same reason `CtaLink` floors its
      `min-height`: `edge: none` and `edge: soft` legitimately remove a border,
      but this card is the ONLY boundary around the price-less CTA on four of the
      seven published pages, and its surface is a 60% translucent plate rather
      than an opaque one — at `edge: none` with no floor it dissolves into the
      section.

      MEASURED TRAP, and the reason the floor is an inset ring rather than the
      obvious `max()`. `journey-design.css` declares `--jp-edge-width: 0` at both
      `none` and `soft` — a UNITLESS zero, which is a `<number>` and not a
      `<length>`. `max(var(--border-width), var(--jp-edge-width))` therefore mixes
      types, the whole `border` shorthand goes invalid at computed-value time,
      `border-style` stays `none`, and the card renders with NO boundary at all.
      Measured: `borderTopWidth` came back `0px` and the probe's ratio was
      meaningless. Plain `border: var(--jp-edge-width) solid X` is fine — a bare
      `0` is a valid border-width — so only MATH on the token breaks, which is
      what makes it easy to ship. Reported for a one-character fix in the axis
      file; until then, no component math touches that token.

      An inset ring composes instead of computing: the axis draws the border it
      wants (0 at `none`/`soft`) and the ring always draws today's hairline
      underneath it.

      THE RING IS AN `outline`, and the first spelling of it was broken. Written
      as `box-shadow: inset 0 0 0 1px EDGE, var(--jp-edge-shadow)` the ring
      vanished at `edge: none` and `edge: heavy`, because `--jp-edge-shadow` IS
      the keyword `none` there and `none` is not a legal ITEM of a `box-shadow`
      list — the declaration goes invalid at computed-value time and falls back
      to the initial `none`. Measured on the recommended card: `boxShadow` read
      back `"none"` at both values. That is the same "do not compose an
      `--jp-edge-*` token" rule the paragraph above states for `max()`, and it
      cost this card its only boundary on the four published pages that render
      this branch. `outline` keeps the ring on its own property; `box-shadow`
      stays the axis's alone, so `soft`'s elevation still lands.
    */
    border: var(--jp-edge-width) solid var(--jp-accent-edge);
    outline: var(--invite-single-ring);
    outline-offset: calc(var(--border-width) * -1);
    box-shadow: var(--jp-edge-shadow);
    background: color-mix(in oklab, var(--color-surface) 60%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
    text-align: center;
  }

  /* the warm pool it rests in */
  .invite__pool {
    position: absolute;
    inset: -14% -8% -34%;
    z-index: -1;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
    background: radial-gradient(
      60% 65% at 50% 70%,
      color-mix(in oklab, var(--jp-accent-mark) 20%, transparent),
      transparent 72%
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITIONS

     Each sets ARRANGEMENT only. Everything that varies alignment, measure,
     surface, accent, type-scale or motion is an axis and is handled above,
     which is why these blocks are short.
     ═══════════════════════════════════════════════════════════════════════ */

  /* `banner` — a compact horizontal strip. Ported from `.jp-invite--banner`
     (`_invite.css` :40-42): no stage height, the column uncapped, the offer row
     laid out inline. */
  .invite[data-invite='banner'],
  .invite[data-invite='card'],
  .invite[data-invite='table'],
  .invite[data-invite='sticky'],
  .invite[data-invite='tiers'] {
    min-height: 0;
  }

  .invite[data-invite='banner'] .invite__inner {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--invite-block-gap) calc(var(--invite-block-gap) * 2);
    max-width: max(var(--jp-content-max), 64rem);
  }

  .invite[data-invite='banner'] .invite__head {
    max-width: none;
  }

  .invite[data-invite='banner'] .invite__offers {
    grid-template-columns: repeat(
      auto-fit,
      minmax(min(100%, 12rem), max-content)
    );
    justify-content: end;
  }

  .invite[data-invite='banner'] .invite__offer {
    padding: calc(var(--space-4) * var(--jp-rhythm));
  }

  .invite[data-invite='banner'] .invite__note {
    grid-column: 1 / -1;
  }

  /* `card` — one quiet card, no atmosphere. Ported from `.jp-invite--card`
     (`_invite.css` :43-47), which hides the bloom, the vignette and the descent
     outright — expressed here as the atmosphere multiplier so there is one gate
     rather than three selectors. It also shrank the title, which is an axis
     value (`type`) and not a composition, so it is NOT reproduced: a creator who
     wants a smaller heading sets `type`. */
  .invite[data-invite='card'] {
    --invite-atmos: 0;
  }

  .invite[data-invite='card'] .invite__offers {
    grid-template-columns: 1fr;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  /* `tiers` — plan columns with the full detail and a recommended flag. The
     columns stretch to a common height so the CTAs line up, which is the whole
     point of putting plans side by side. */
  .invite[data-invite='tiers'] .invite__offer {
    gap: calc(var(--space-4) * var(--jp-rhythm));
  }

  .invite[data-invite='tiers'] .invite__offer :global(.cta) {
    margin-top: auto;
  }

  /* `table` — the comparison matrix.

     The wrapper scrolls on its own rather than letting the page scroll
     horizontally: a matrix of four paths cannot narrow past its content, and a
     body that scrolls sideways is a layout bug on every other section too. */
  .invite__scroller {
    width: 100%;
    overflow-x: auto;
  }

  /* R14, and the only place this section owes it. Every other interactive node
     here is a `CtaLink`, which owns its own ring (`CtaLink.svelte`'s
     `.cta:focus-visible`) — verified to survive `edge: none` and `edge: soft`,
     because the ring is an `outline` on the anchor and the `edge` axis only ever
     touches `border` and `box-shadow` on the section and the cards. The offer
     cards are `<li>` elements wrapping a CtaLink, never links themselves, so
     they are not focus targets. This scroller is, because `table` gave it
     `tabindex="0"`. Canonical recipe, same tokens as `CtaLink`. */
  .invite__scroller:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .invite__table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--jp-body-size);
  }

  /* A row rule is STRUCTURE, not treatment, so it is a fixed hairline rather
     than an `edge` axis read: `edge: none` and `edge: soft` would remove the
     only thing separating one attribute row from the next, and a matrix without
     row separation is not a lighter matrix, it is an unreadable one. Colour
     stays semantic (contract A11) — `--jp-line` is the palette's own rung and
     naming it here would open a second colour vocabulary inside a section. */
  .invite__table th,
  .invite__table td {
    padding: calc(var(--space-3) * var(--jp-rhythm));
    border-bottom: var(--invite-table-rule);
    vertical-align: top;
  }

  .invite__table tfoot td {
    border-bottom: 0;
  }

  /* The row headers are the matrix's spine, so they get a denser step —
     DERIVED FROM the card rung rather than from `--jp-heading-size` (contract
     A44), which is the only way the `type` axis still reaches them. */
  .invite__table tbody th {
    font-weight: var(--font-semibold);
    font-family: var(--invite-label-font);
    font-size: var(--invite-rowhead-size);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .invite__table thead th {
    position: relative;
    padding-top: calc(var(--space-6) * var(--jp-rhythm));
  }

  /* Same ring, same reason, same token as the card's — a column is the table's
     card. Drawn as an inset ring on the whole column's cells so it survives
     `edge: none`. */
  .invite__table th[data-best='true'],
  .invite__table td[data-best='true'] {
    background: color-mix(in oklab, var(--color-surface-secondary) 70%, transparent);
    box-shadow: inset var(--border-width-thick) 0 0 0 var(--jp-accent-mark),
      inset calc(var(--border-width-thick) * -1) 0 0 0 var(--jp-accent-mark);
  }

  .invite__table .invite__badge {
    position: static;
    display: inline-block;
    transform: none;
    margin-bottom: var(--space-2);
  }

  /* `sticky` — the in-flow bar. STATIC HERE, BY DESIGN (contract A40): this is
     the baseline every non-animating path lands on — no CSS, SSR, reduced
     motion, and the creator choosing `motion: none`. The pinning is added
     further down and never subtracted. */
  .invite__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--space-4) * var(--jp-rhythm));
    width: 100%;
    padding: calc(var(--space-4) * var(--jp-rhythm))
      calc(var(--space-6) * var(--jp-rhythm));
    border-radius: var(--invite-card-radius);
    /*
      Same boundary floor and the same unitless-zero reason as the threshold card
      above, but a DIFFERENT token for the ring, and the split is deliberate.

      The threshold card's quiet accent edge is EXISTING appearance on four
      published pages — measured 1.17:1 light / 1.53:1 dark before this change
      and 2.10 / 1.62 after — and it is decorative reinforcement of a boundary
      the card's own translucent plate already carries, so it does not owe 3:1
      and brightening it would be a design change dressed up as an a11y fix.

      This bar is NEW, and its edge DOES carry meaning: a pinned strip has to read
      as a separate plane from the content passing behind it, and at `edge: none`
      the axis contributes no elevation either. So its ring takes the AA-safe
      `--jp-accent-mark` (10.47:1 light / 5.00:1 dark) rather than
      `--jp-accent-edge`, whose 45% ember mix at `accent: glow` measured 2.30 /
      1.27 here. New surfaces are held to the floor; existing ones are preserved.

      `outline`, for the same measured reason as the two rings above: composing
      `var(--jp-edge-shadow)` into a `box-shadow` LIST makes the declaration
      invalid at `edge: none` and `edge: heavy`, where that token is the keyword
      `none`, and takes the ring with it.
    */
    border: var(--jp-edge-width) solid var(--jp-accent-edge);
    outline: var(--invite-bar-ring);
    outline-offset: calc(var(--border-width) * -1);
    box-shadow: var(--jp-edge-shadow);
    background: var(--color-surface-secondary);
    text-align: left;
  }

  /* A ROW, not a stack: measured at 135px tall when the name sat above the
     price, which is half again the height a bottom bar should ever be. */
  .invite__bar-id {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  /* The bar's amount steps down to the card rung. A 40px price is right when the
     price IS the block; in a bar it is a line of chrome, and the bar's whole job
     is to stay out of the way of the page behind it. */
  .invite__bar .invite__price-amount {
    font-size: var(--jp-body-size);
  }

  /* `sticky` is the one composition that must NOT clip, because `overflow: clip`
     on an ancestor disables `position: sticky` outright. The pool's soft bleed is
     contained on the card instead, so nothing escapes between sections.

     `position: fixed` is unavailable here BY CONSTRUCTION and this is not a
     shortfall: `.jp-sec` carries `container-type: inline-size`, which brings
     layout containment and makes the wrapper a containing block for fixed
     descendants (`SectionRenderer.svelte`'s own note says so). A viewport-pinned
     bar would need a portal out to `.org-layout`, as `IntroVideoModal` does.
     `position: sticky` is contained-safe, pins the bar for the whole time the
     section is on screen, and cannot ever cover another section's content. */
  .invite[data-invite='sticky'] {
    overflow: visible;
  }

  .invite[data-invite='sticky'] .invite__single {
    overflow: clip;
  }

  /* ── ENHANCED: ambient loops, only once JS confirms motion is welcome ──
     Durations come from the `motion` axis rather than being picked, so a page
     set to `fade` breathes faster than one set to `drift`. Both multipliers are
     solved backwards from Candlelit, whose `motion: drift`
     (`--duration-slowest`, 800ms) lands on the 8s and 5s this section shipped
     before the axes existed. */
  .invite--enhanced .invite__bloom {
    animation: invite-breathe calc(var(--jp-reveal-duration) * 10)
      var(--jp-reveal-ease) infinite;
  }

  .invite--enhanced .invite__descent::before {
    animation: invite-descend calc(var(--jp-reveal-duration) * 6.25)
      var(--jp-reveal-ease) infinite;
  }

  .invite--enhanced .invite__seed {
    animation: invite-pulse calc(var(--jp-reveal-duration) * 6.25)
      var(--jp-reveal-ease) infinite;
  }

  /* The bloom's resting opacity IS its baseline, so the keyframe has something
     to return to and the reduced-motion path needs no override — stopping the
     animation leaves the layer exactly where it should be. */
  @keyframes invite-breathe {
    0%,
    100% {
      opacity: 0.84;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes invite-descend {
    0% {
      top: calc(var(--space-1) * -1);
      opacity: 0;
    }
    18% {
      opacity: 1;
    }
    72% {
      opacity: 1;
    }
    100% {
      top: 100%;
      opacity: 0;
    }
  }

  @keyframes invite-pulse {
    0%,
    60%,
    100% {
      transform: translateX(-50%) scale(1);
      box-shadow: 0 0 var(--space-5) var(--space-1)
        color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
    }
    78% {
      transform: translateX(-50%) scale(1.5);
      box-shadow: 0 0 var(--space-6) var(--space-2)
        color-mix(in oklab, var(--jp-accent-mark) 72%, transparent);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     `sticky`'s PINNING — the enhancement, added and never subtracted.

     Three conditions must ALL hold: the composition is `sticky`, the viewer has
     not asked for reduced motion, and the `motion` axis is not `none`. The axis
     is read in markup (`data-motion`) because a scoped style block cannot reach
     the ancestor `data-jp-motion` attribute.

     Inverting this — pin by default, unpin under reduced motion — is what
     contract A40 forbids, and the measured reason is that an override has to
     remember every property the pinned state set. Round 2's marquee measured
     clean on every motion probe and still parked two of three items outside its
     clipped strip, because the forgotten property was the one that allowed
     wrapping. Here the forgotten property would be the one that keeps the CTA
     inside the flow.
     ═══════════════════════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: no-preference) {
    /* `:not([data-motion='none'])` and no longer `[data-motion='on']`, because
       the attribute now carries the AXIS VALUE for the per-look block below. The
       matched set is IDENTICAL, including the no-`design` case: the attribute is
       then absent entirely, `:not()` matches, and the bar pins exactly as it did
       when `motion` defaulted to `'on'`. */
    .invite[data-invite='sticky']:not([data-motion='none']) .invite__bar {
      position: sticky;
      bottom: var(--space-4);
      z-index: 2;
    }
  }

  /* ── narrow container ──
     A CONTAINER query, not a viewport media query (contract A14). `.jp-sec` IS
     the container, and the builder canvas renders sections inside a device frame
     narrower than the window, where a viewport query reads the wrong number —
     which is exactly what the raw `@media (max-width: 640px)` this replaces was
     doing. 40rem is 640px at the root font size, so the breakpoint itself is
     unchanged; only what it measures is. */
  @container (max-width: 40rem) {
    .invite__single {
      width: 100%;
      padding-inline: calc(var(--space-6) * var(--jp-rhythm));
    }

    .invite[data-invite='banner'] .invite__inner {
      grid-template-columns: 1fr;
    }

    .invite[data-invite='banner'] .invite__offers {
      justify-content: var(--jp-align);
    }

    .invite__bar {
      justify-content: var(--jp-align);
    }
  }

  /* ═══ PER-LOOK COMMITMENTS ═══════════════════════════════════════════════
     Everything above is axis-generic: it consumes magnitudes and paints one
     arrangement per composition. What follows commits each design LANGUAGE to
     its documented tell (`00-design-language-research.md` §1), because a tell is
     a SELECTOR-level statement — which elements are boxes, which corner is
     square, which label is monospaced, which numeral is tabular, which rule is
     drawn — and `journey-design.css` deliberately emits nothing but custom
     properties.

     ── THE SELECTOR DISCIPLINE, stated once so every block can be checked ───
     `candlelit` is the one preset that already works and it must come out of
     this pass byte-identical. It is uniquely identified by FOUR of its nine axis
     values — `surface: media`, `edge: none`, `media: bleed`, `accent: glow` —
     and SHARES the other five: `type: monumental` (with quiet-studio,
     plain-facts), `align: center` (quiet-studio, open-air, full-send),
     `density: airy` (open-air), `width: text` (long-read, open-air),
     `motion: drift` (open-air).

     So NO selector below is keyed on any of those five. Every one of them names
     one of these twelve, and none matches the candlelit bundle:

       edge: offset                    → plain-facts  only
       edge: offset + accent: fill     → plain-facts  only
       accent: edge                    → syllabus     only
       type: restrained                → syllabus     only
       accent: none                    → quiet-studio only
       density: vast                   → quiet-studio only
       edge: soft                      → open-air     only
       edge: heavy                     → full-send    only
       motion: stagger                 → full-send    only
       surface: bare  + align: start   → long-read    only
       edge: hairline + accent: fill   → signal       only
       accent: text                    → long-read + open-air (never candlelit,
                                         which is `glow`)

     The two compounds are compounds BY NECESSITY rather than by taste:
     `long-read` and `signal` each share all nine of their axis values with some
     sibling, so neither has a single value to key on. Each is justified in its
     own block.

     `open-air` is the dangerous one — it shares FOUR axes with candlelit — so
     every open-air rule here is keyed on `edge: soft`, which candlelit
     (`edge: none`) cannot match.

     `media` IS NOT AVAILABLE as a key here and that is deliberate: see `look` in
     the script. `media: none` would have identified `plain-facts` uniquely and
     `edge: offset` does the same job on a value this section actually spends. */

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere.

     MEASURED ON THE BASE: the 2px border and the hard drop were BOTH already
     reachable — `--jp-edge-width` is `--border-width-thick` at this value and
     `--jp-edge-shadow` is `var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)`,
     and the section shell and every offer card already read both. That half of
     the tell needed nothing. The other two halves were absent outright: this
     file contained no `--font-mono` anywhere, and `radius 0 everywhere` was
     contradicted in six places — the section shell (`--jp-sec-radius` is
     `--radius-card` under `surface: panel`, this look's surface), the offer card,
     the threshold card, the sticky bar, the badge pill and the pay button's own
     `--radius-button`.

     THE PAY BUTTON IS REACHED BY RE-POINTING `--radius-button`, never by
     selecting `.cta`. `CtaLink` reads that token for its `border-radius`, and it
     is the one styler of `.cta` in the tree by test (Codex-kdsuo) — a section
     that paints the pay button's COLOURS breaks the single place its contrast is
     guaranteed. Geometry through the token costs nothing and touches no rule. */
  .invite[data-edge='offset'] {
    --invite-shell-radius: var(--radius-none);
    --invite-card-radius: var(--radius-none);
    --invite-badge-radius: var(--radius-none);
    --invite-tick-radius: var(--radius-none);
    --radius-button: var(--radius-none);

    /* MONO LABELS AND MONO NUMERALS. The eyebrow, the badge and the matrix's row
       spine take the family's label face; the price amount loses the serif
       `--font-heading` it inherits by default, because "no separate display
       face" is this family's own row and a serif £27 is the single most
       display-like thing in the section. Tabular so the digits cannot shuffle
       between one card and the next. */
    --invite-label-font: var(--font-mono);
    --invite-num-font: var(--font-mono);
    --invite-num-variant: tabular-nums;

    /* "The grid visible as actual lines" — the matrix's row rule steps up from
       the fixed hairline to the axis's own 2px `--jp-line-strong`. Plain
       substitution, no math on the token (A64). */
    --invite-table-rule: var(--jp-edge-width) solid var(--jp-edge-color);
  }

  /* The head rule, at the axis's weight and in the axis's colour rather than
     `--color-border-subtle` — a 2px subtle hairline is a contradiction, and this
     family's rules are meant to be seen. `width: 100%` because `.invite__head`
     is a column flex child of a container with `align-items: start` here, which
     shrink-wraps it to its longest line. */
  .invite[data-edge='offset'] .invite__head {
    width: 100%;
    padding-block-end: calc(var(--jp-sec-gap) / 3);
    border-block-end: var(--jp-edge-width) solid var(--jp-edge-color);
  }

  /* The accent spent as the family spends it: "solid rectangles of it, text
     reversed out". COMPOUNDED with `accent: fill` rather than left on
     `edge: offset` alone, because `--jp-accent-fill` is `transparent` at
     `accent: text` and `accent: edge` — a creator who picked those with this edge
     would get `--jp-accent-on-fill` ink on the section's own background, which is
     the two-token contrast pair broken in half. `.invite__head` is a column flex
     box with `align-items: var(--jp-align)`, so the slab shrink-wraps its text at
     both align values with no width of its own.

     The `width: 100%` above is on the HEAD, not the eyebrow, so the slab still
     shrink-wraps inside it. */
  .invite[data-edge='offset'][data-accent='fill'] .invite__eyebrow {
    padding: var(--space-1) var(--space-3);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a hairline grid, mono numerals, and a LEFT-BORDER ACCENT STRIPE
     rather than a filled badge.

     MEASURED ON THE BASE: none of the three reached this section. Numerals were
     proportional-figure serif; the only hairline was the matrix's row rule,
     which four of the six compositions never render; and the recommended path
     was signalled by a 2px ring on ALL FOUR sides of a `--radius-card` box, with
     a RINGED BADGE PILL sitting on top of it — `accent: edge` makes
     `--jp-accent-fill` transparent, so `data-plated="no"` already outlines the
     pill instead of filling it. An outlined pill is still the badge the tell
     names in opposition: "rather than" is a statement about the CARRIER, not
     about the fill.

     SO THE LABEL LOSES ITS BOX AND KEEPS ITS TEXT. Hiding the badge outright
     would have been wrong for a different reason — it is the visible string that
     says which path the page recommends, and this file's own `ctaName` note
     explains that it is what programmatically associates "Recommended" with the
     offer's own heading. Removing information is not a treatment change.

     THE STRIPE IS `--jp-accent-mark`, NOT `--jp-accent-edge`, and the
     measurement is already in this file (see `.invite__offer[data-best]`):
     `--jp-accent-edge` measured 2.30:1 light / 1.27:1 dark against a 3:1 graphic
     floor, while `--jp-accent-mark` tracks the AA-safe `--jp-ember-text` and
     clears it everywhere. A stripe that carries the tell has to be seen. Read
     directly, with no mix carried onto it (contract A37). */
  .invite[data-accent='edge'] {
    --invite-card-radius: var(--radius-sm);
    --invite-tick-radius: var(--radius-none);
    --invite-label-font: var(--font-mono);
    --invite-num-font: var(--font-mono);
    --invite-num-variant: tabular-nums;

    /* The hairline under the section head, so the block reads as a table with a
       header row — the same value `long-read` sets for a different reason. */
    --invite-head-rule: var(--border-width);
    --invite-head-gap: calc(var(--jp-sec-gap) / 3);

    /* THE STRIPE REPLACES THE RING. `outline: none` rather than a zero width, so
       the shorthand is unambiguous; `--invite-best-offset` is then inert. */
    --invite-best-outline: none;
    --invite-best-stripe: var(--border-width-thick) solid var(--jp-accent-mark);

    /* NOT A BADGE — a mono column label in the card's own flow, so the accent
       appears exactly once per row: in the stripe. `--jp-accent-text` is
       `--jp-text` at this accent value, i.e. deliberately neutral, which is the
       family's own row ("accent as edge — left-border status stripes, plus small
       fills on badges only", and this badge no longer has a fill to be one of).

       These six restate what `.invite[data-plated='no']` set earlier at the SAME
       specificity (0,2,0) — source order is what decides, which is why the
       PER-LOOK block sits after it rather than merely tidily at the end. */
    --invite-badge-pos: static;
    --invite-badge-shift: none;
    --invite-badge-pad: 0px;
    --invite-badge-radius: var(--radius-none);
    --invite-badge-bg: transparent;
    --invite-badge-ink: var(--jp-accent-text);
    --invite-badge-ring: none;
  }

  .invite[data-accent='edge'] .invite__head {
    width: 100%;
  }

  /* `type: restrained` is `syllabus`'s type value and nobody else's, so the
     dense-dashboard reading rhythm lands here: "many small steps, fine-grained
     hierarchy". The sub drops off the fixed `--text-lg` onto the body rung it
     actually is, and the matrix's row spine goes a full step under it. */
  .invite[data-type='restrained'] {
    --invite-sub-size: var(--jp-body-size);
    --invite-rowhead-size: var(--text-xs);
  }

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
     Tell: three type sizes, ONE hairline, no accent colour, and more empty space
     than content.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so almost every declaration below
     REMOVES something. Measured on the base, against each half of the tell:

       "one hairline"      — `edge: hairline` is this look's edge value, so the
                             section shell drew a full box AND every offer card
                             drew its own. On the golden four-path offer that is
                             FIVE hairline boxes, not one hairline.
       "no accent colour"  — the badge is a filled plate at `--jp-accent-fill`,
                             which at `accent: none` is `--jp-ink-4`: not brand,
                             but still a plate, and a plate is the thing this
                             family does not have.
       "three type sizes"  — the section drew SEVEN: `--jp-eyebrow-size`,
                             `--jp-display`, `--text-lg` (sub), `--jp-body-size`
                             (offer name), `--invite-price-size`, `--text-sm`
                             (cadence / who / blurb / bullets / note) and
                             `--text-xs` (badge), plus `--jp-body-size / 1.2` for
                             the matrix spine — eight in `table`.

     The size collapse below is stated as ARITHMETIC rather than as an adjective,
     which is the only form of the claim that can be checked: `--text-sm` (eyebrow
     at `monumental`, cadence, who, blurb, bullets, note, badge, row spine),
     `--jp-body-size` (sub, offer name, price) and `--jp-display` (heading).
     Exactly three. Weight comes with it, because "three sizes" is a hierarchy
     claim and a semibold offer name at the same size as a normal sub is a fourth
     level by another means. */
  .invite[data-accent='none'] {
    --invite-shell-border: 0 none;
    --invite-shell-shadow: none;
    --invite-shell-radius: var(--radius-none);

    --invite-card-bg: transparent;
    --invite-card-border: 0 none;
    --invite-card-shadow: none;
    --invite-card-radius: var(--radius-none);
    --invite-card-pad: 0px;
    --invite-best-outline: none;

    /* The two rings this section hardcodes so a border-less `edge` value cannot
       dissolve a boundary. CHECKED, not assumed: this look is `edge: hairline`,
       so `--jp-edge-width` is `--border-width` and BOTH surfaces still draw the
       axis's own 1px border underneath — removing the ring leaves exactly one
       hairline on each rather than none, which is the tell. The removal would be
       a real regression at `edge: none` / `edge: soft`, and neither is this
       look's value. */
    --invite-single-ring: none;
    --invite-bar-ring: none;

    /* NO PLATE. The label survives as a label: "labels uppercase with
       `--tracking-wider` or wider" is this family's own row, so it takes the
       wider step and the quiet secondary ink rather than the heading rung. */
    --invite-badge-pos: static;
    --invite-badge-shift: none;
    --invite-badge-pad: 0px;
    --invite-badge-radius: var(--radius-none);
    --invite-badge-bg: transparent;
    --invite-badge-ink: var(--color-text-secondary);
    --invite-badge-ring: none;
    --invite-badge-tracking: var(--tracking-widest);

    /* The eyebrow's tracking through the shared atom's own documented seam
       (`journey-sections-shared.css`), never a re-spelled recipe. */
    --jp-eyebrow-tracking: var(--tracking-widest);

    /* The bullet tick stops being a dot and becomes a short rule — the same
       "hairlines, not marks" logic, one element down. */
    --invite-tick-w: var(--space-3);
    --invite-tick-h: var(--border-width);
    --invite-tick-radius: var(--radius-none);
  }

  /* THE ONE HAIRLINE, and only one: a short rule opening the copy column. A
     pseudo-element, so there is no markup change and nothing enters the
     inline-edit seam's `textContent`. `flex: none` because `.invite__head` is a
     column flex container, which makes a `::before` a flex ITEM.

     ON THE HEAD RATHER THAN ON `.invite__inner`, deliberately: `banner` makes
     `.invite__inner` a two-column GRID, where a `::before` would claim a cell and
     push the action out of its track. It also means a section with nothing to say
     (`hasCopy` false, `hasDoorway` true) draws no rule at all, which is the honest
     answer — the hairline opens a piece of writing, and there is none. */
  .invite[data-accent='none'] .invite__head::before {
    content: '';
    flex: none;
    width: var(--space-16);
    height: var(--border-width);
    margin-block-end: calc(var(--jp-sec-gap) / 2);
    background: var(--color-border);
  }

  /* MORE EMPTY SPACE THAN CONTENT, and the three collapsed sizes. `vast` already
     carries a 1.6 rhythm through `--jp-sec-gap`, so doubling it is the family's
     "the emptiness IS the design" rather than an arbitrary number — and it still
     multiplies the org's own `--brand-density-scale` through `--space-unit`. */
  .invite[data-density='vast'] {
    --invite-block-gap: calc(var(--jp-sec-gap) * 2);
    --invite-sub-size: var(--jp-body-size);
    --invite-price-size: var(--jp-body-size);
    --invite-badge-size: var(--text-sm);
    --invite-rowhead-size: var(--text-sm);
  }

  .invite[data-density='vast'] .invite__offer-name {
    font-weight: var(--font-normal);
  }

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `align: start` ──────
     Tell: the eyebrow and the body share a left edge, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY. `long-read` has no axis value of its own:
     `surface: bare` is shared with `quiet-studio` and `align: start` with
     `plain-facts`, `syllabus` and `signal` — but `quiet-studio` is
     `align: center` and none of the other three is `surface: bare`, so the PAIR
     is `long-read` alone. Candlelit is `surface: media`, so it matches neither
     half, let alone both.

     MEASURED ON THE BASE: the shared left edge already holds — `align: start`
     sets `--jp-measure-margin: 0px` and `.invite__head`'s `align-items: start`
     puts the eyebrow, the heading and the sub on one edge. The HEAD HAIRLINE was
     absent, and "no box borders anywhere" was contradicted by the section shell
     (a full hairline box, from `edge: hairline`) and by every offer card, which
     is a `--radius-card` plate on `--color-surface-secondary`. The cards become
     rule-separated columns, which is what a magazine does with a comparison. */
  .invite[data-surface='bare'][data-align='start'] {
    --invite-shell-border: 0 none;
    --invite-shell-shadow: none;
    --invite-shell-radius: var(--radius-none);

    --invite-head-rule: var(--border-width);
    --invite-head-gap: calc(var(--jp-sec-gap) / 3);

    --invite-card-bg: transparent;
    --invite-card-border: 0 none;
    --invite-card-shadow: none;
    --invite-card-radius: var(--radius-none);
    --invite-card-pad: 0px;
    --invite-best-outline: none;

    --invite-badge-pos: static;
    --invite-badge-shift: none;
    --invite-badge-pad: 0px;
    --invite-badge-bg: transparent;
    --invite-badge-ink: var(--jp-accent-text);
    --invite-badge-ring: none;
  }

  /* The rule spans the MEASURE, not the head's longest line, so it reads as a
     section rule and not as an underlined heading. `width: 100%` is required
     because `.invite__head` is a column flex child of a container with
     `align-items: start`, which shrink-wraps it. */
  .invite[data-surface='bare'][data-align='start'] .invite__head {
    width: 100%;
  }

  /* HAIRLINE HORIZONTAL RULES ONLY. A rule ABOVE each column rather than a box
     around it — the only edge a magazine draws — and the recommended one steps up
     to the thick accent rule, so the flag survives the removal of the ring
     without a box coming back. `--jp-accent-mark` for the 3:1 reason the ring
     block states at length. */
  .invite[data-surface='bare'][data-align='start'] .invite__offer {
    padding-block: calc(var(--jp-sec-gap) / 2);
    border-block-start: var(--border-width) solid var(--color-border-subtle);
  }

  .invite[data-surface='bare'][data-align='start']
    .invite__offer[data-best='true'] {
    border-block-start: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  /* THE PRICE-LESS THRESHOLD, un-boxed and returned to the left edge. This is
     the branch four of the seven published pages actually render, and it was the
     last box: a bordered, ringed, blurred, CENTRED plate inside a section whose
     whole tell is "the eyebrow and the body share a left edge". The CTA does not
     need the plate to be found — `CtaLink`'s primary variant is a filled brand
     control that this file may not repaint and does not need to.

     The `align-items` / `text-align` centring on `.invite__single` is left alone
     for every other look on purpose: a single centred doorway is a legitimate
     close, and `align` positions the section's column rather than dictating the
     inside of a card (the same argument `.invite__offer`'s `text-align: left`
     makes). `long-read` is the one family that states the shared edge AS the
     tell.

     `backdrop-filter` is dropped in both spellings, since there is no plate left
     to frost. */
  .invite[data-surface='bare'][data-align='start'] .invite__single {
    align-items: var(--jp-align);
    padding: 0px;
    border: 0 none;
    outline: none;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    text-align: var(--jp-text-align);
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ───────────────────────
     Tell: no border anywhere, pill controls, and a shadow you have to look for.

     KEYED ONLY ON `edge: soft`. This look shares four axes with candlelit
     (`align: center`, `density: airy`, `width: text`, `motion: drift`) and a bare
     rule on any of them would restyle the one preset that works; `edge: soft` is
     open-air's and nobody else's, and candlelit is `edge: none`.

     MEASURED ON THE BASE, half of it already held: `--jp-edge-width` is `0px`
     here and `--jp-edge-shadow` is `--shadow-lg` — a 14px-blur, 10%/5%-alpha drop,
     i.e. "large, very diffuse, very low opacity" — and the shell, the cards, the
     threshold card and the bar all already read both. What did NOT hold is that
     four borders in this file are NOT the `edge` axis's to remove: the
     recommended card's 2px outline, the threshold card's 1px ring, the bar's 1px
     ring, and the badge's own inset ring (this look is `accent: text`, so
     `data-plated="no"` outlines the pill). "No border anywhere" cannot be true
     while any of those draw.

     SO THE RECOMMENDED FLAG MOVES ONTO THE FAMILY'S OWN VOCABULARY — "accent as
     tinted background + accent text, NEVER a hard fill" — and the diffuse shadow
     does the separating that the removed rings were doing. The 8% and 14% mixes
     sit on `--jp-accent-mark`, which is `--jp-ember-text` at four of five accent
     values and `--jp-heading` at the fifth, never a pre-mixed token, so this is
     not contract A37's mix-of-a-mix: `--jp-accent-edge` WOULD have been exactly
     that (already a 45% ember mix at `accent: glow`, so 8% of it is ~3.6% ember).

     THE MATRIX'S ROW RULES STAY. The rule beside `.invite__table th` already
     settled that argument: a row rule there is STRUCTURE, not treatment, and a
     comparison matrix with no row separation is not a lighter matrix, it is an
     unreadable one. This look's tell loses to WCAG on that one element, said out
     loud rather than quietly.

     AND THE TWO RING REMOVALS ARE SAFE HERE, SPECIFICALLY — checked rather than
     assumed, because the rings' own comments explain that they exist so a
     border-less `edge` value cannot dissolve a boundary. That argument is about
     `edge: none`, where `--jp-edge-shadow` is the KEYWORD `none` and the axis
     contributes neither a border nor an elevation. At `edge: soft` it is
     `--shadow-lg`, a real 14px drop, and both surfaces read it — so the boundary
     is carried, by the exact material this family names. Removing the ring at
     `edge: none` would be the regression; this is not that. */
  .invite[data-edge='soft'] {
    /* "`--radius-xl` on panels, `--radius-full` on controls." The tinted band IS
       a panel here — `surface: tint` leaves `--jp-sec-radius` at the root default
       `--radius-none`, so the band was square. */
    --invite-shell-radius: var(--radius-xl);
    --invite-card-radius: var(--radius-xl);
    --radius-button: var(--radius-full);

    --invite-best-outline: none;
    --invite-best-bg: color-mix(
      in oklab,
      var(--jp-accent-mark) 8%,
      var(--color-surface-secondary)
    );

    --invite-single-ring: none;
    --invite-bar-ring: none;

    /* The badge as this family's own accent: a tinted pill with accent TEXT,
       "never a hard fill". MIXED INTO `--invite-card-bg` AND NOT INTO
       `transparent`, which is a straddle problem rather than a taste one: the
       badge is `position: absolute` at `top: 0` with a `-50%` shift, so half of
       it hangs over the section's tinted band and half over the card. A
       translucent pill would read as two different colours across that seam.
       Opaque, it is one chip. */
    --invite-badge-radius: var(--radius-full);
    --invite-badge-ring: none;
    --invite-badge-ink: var(--jp-accent-text);
    --invite-badge-bg: color-mix(
      in oklab,
      var(--jp-accent-mark) 14%,
      var(--invite-card-bg)
    );
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` · `motion: stagger` ───────
     Tell: whole inverted bands, pill CTAs at `--radius-full`, spring easing, and
     BIG NUMERALS.

     MEASURED ON THE BASE: the inverted band already holds, and it holds properly
     rather than by accident — `surface: invert` re-points `--jp-ink` to pole B and
     `.journey-palette--page .jp-sec` derives `--color-surface-secondary` from
     `--jp-ink-3`, so the offer cards flip WITH the band instead of staying a
     light plate on a dark one. The 2px accent border also already holds
     (`--jp-edge-color` is `--jp-accent-edge` at this value). The other three did
     not: the pay button was `--radius-md`, nothing in the file responded to
     `--ease-spring` outside the shared reveal, and the section's one real numeral
     — the price — measured 33px at `expressive`, against a 44px heading.

     THE BIG NUMERAL IS THE PRICE, at `--jp-display` and bold with tabular
     figures. It is the number this section exists to state, and this is the one
     family that says numerals out loud.

     THE 2px RING ON THE RECOMMENDED CARD IS KEPT ON PURPOSE. At `edge: heavy` the
     card border is already 2px of `--jp-accent-edge` and the inset ring sits
     directly inside it, so the recommended card carries a contiguous 4px accent
     edge — which in this family reads as the intended shout rather than as a
     doubled border. Considered and left alone; the change would have been a
     change for its own sake. */
  .invite[data-edge='heavy'] {
    --radius-button: var(--radius-full);
    --invite-shell-radius: var(--radius-xl);
    --invite-card-radius: var(--radius-xl);
    --invite-badge-radius: var(--radius-full);

    --invite-price-size: var(--jp-display);
    --invite-num-weight: var(--font-bold);
    --invite-num-variant: tabular-nums;
  }

  .invite[data-edge='heavy'] .invite__price-amount {
    line-height: var(--leading-none);
  }

  /* SPRING EASING, MADE VISIBLE. `--jp-reveal-ease` is `--ease-spring` at this
     motion value and the reveal already rides it, but a reveal happens once and
     off-screen; the place a viewer can FEEL a curve is the thing they are
     pointing at. So the offer card lifts, with the overshoot on the way up.

     `translate` and not `transform: scale()`: a scaled card resamples its own
     text and the price is the largest glyph run in the section. `:focus-within`
     as well as `:hover` so a keyboard user reaching the CTA inside the card gets
     the same feedback — and neither state carries any information, so this is
     decoration and not a hover-only affordance.

     `.cta` IS NOT TOUCHED, and not for want of a better carrier: `CtaLink` owns a
     `transition` that includes its own background, so re-declaring `transition`
     on `.cta` from here would silently drop the button's colour transition — and
     painting `.cta` at all is what `journey-design.test.ts` forbids (Codex-kdsuo).
     The card is the element this file owns. */
  .invite[data-motion='stagger'] .invite__offer {
    transition: translate var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  .invite[data-motion='stagger'] .invite__offer:hover,
  .invite[data-motion='stagger'] .invite__offer:focus-within {
    translate: 0 calc(var(--space-2) * -1);
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small neutral shadow; one filled
     accent button per section.

     ANOTHER COMPOUND BY NECESSITY. `signal` shares all nine of its axis values:
     `edge: hairline` is also `quiet-studio`, `long-read` and `syllabus`, and
     `accent: fill` is also `plain-facts` and `full-send` — but those two are
     `edge: offset` and `edge: heavy`, and the three other hairline looks are
     `accent: none` / `text` / `edge`. So the PAIR is `signal` alone, and
     candlelit (`edge: none`, `accent: glow`) matches neither half.

     MEASURED ON THE BASE, and this is the one look that was mostly already
     right — which is worth stating rather than inventing work for. The cards are
     `--radius-card` (`--radius-lg`, the family's own radius) with a hairline
     border and `--shadow-xs`, "a small NEUTRAL shadow" and not a coloured one;
     and "one filled accent button per section" is exact — every composition gives
     the recommended path `variant="primary"` and each sibling `secondary`, so
     there is precisely one filled control.

     THE ONE REAL GAP is how "recommended" is said. A 2px ember ring is a
     brutalist or technical device; this family differentiates a featured tier by
     LIFTING it. So the ring steps down to a hairline in the same AA-safe
     `--jp-accent-mark` — the width is not part of a contrast ratio, so the 3:1
     floor the ring owes is unchanged — and the elevation steps up from
     `--shadow-xs` to `--shadow-md`, which is the family's own shadow row.
     Resting versus recommended is still carried on weight and elevation, never
     on opacity (contract A39).

     THE SECOND GAP IS ARITHMETIC, and it is why the badge moves too. The family's
     colour row is "accent as FILL on the CTA ONLY; accent as text on links", and
     this look is `accent: fill` — so the card shipped TWO full-strength accent
     plates side by side, the "Recommended" pill and the pay button beneath it,
     against a row that says one. The pill becomes the chip this family actually
     uses: the card's own opaque surface, a hairline in `--jp-accent-mark`, and
     the accent as TEXT.

     THE PLATE HAS TO STAY OPAQUE, and `--invite-card-bg` rather than
     `transparent` is the whole reason: the badge is `position: absolute` at
     `top: 0` with a `-50%` shift, so it STRADDLES the card's top border. A
     transparent chip would have the hairline running straight through its
     letters. `--jp-ember-text` on `--jp-ink-3` is the pair `journey-design.test.ts`
     already pins as clearing AA on a panel surface, so the ink is safe on it. */
  .invite[data-edge='hairline'][data-accent='fill'] {
    --invite-best-outline: var(--border-width) solid var(--jp-accent-mark);
    --invite-best-offset: calc(var(--border-width) * -1);
    --invite-best-shadow: var(--shadow-md);

    --invite-badge-bg: var(--invite-card-bg);
    --invite-badge-ink: var(--jp-accent-text);
    --invite-badge-ring: inset 0 0 0 var(--border-width) var(--jp-accent-mark);
  }

  /* ── ACCENT AS TEXT — `long-read` + `open-air` ───────────────────────────
     The two families whose accent row is "accent as TEXT: kickers, link
     underlines, footnote markers" (1.1) and "tinted background + accent text"
     (1.3). Both spend it on the eyebrow, which is the only kicker this section
     has; `--jp-accent-text` is the axis's AA-safe text rung and never
     `--jp-ember`, which measures 2.04:1 as text in dark (research §5.1).

     A shared key rather than two rules, because it is genuinely the same
     statement — and `accent: text` is exactly those two looks. Candlelit is
     `accent: glow`, so its eyebrow keeps the atom's `--color-text-secondary`. */
  .invite[data-accent='text'] .invite__eyebrow {
    color: var(--jp-accent-text);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REDUCED MOTION

     `journey-sections-shared.css` already kills every `animation` inside
     `.jp-sec` with `!important`, and `journey-design.css` neutralises
     `--jp-reveal-distance` — a 0.01ms transition to a translated end state still
     moves the element. What is left is this section's own obligation.

     NOTHING TO UNDO FOR `sticky`: the in-flow bar is the baseline and the
     pinning only exists inside `@media (prefers-reduced-motion: no-preference)`,
     so this query never sees a position to reset (contract A40).

     The descent spark DOES need a line, and it is the one case an inverted
     baseline cannot cover: its resting state is `opacity: 0` because it only
     exists while travelling. A stopped spark is an invisible 4px dot pinned to
     the top of the hairline, so it leaves the layout entirely rather than
     sitting there as a dead node.
     ═══════════════════════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .invite__descent::before {
      display: none;
    }

    /* The one transform the per-look pass added, and the one thing
       `journey-sections-shared.css`'s `animation: none !important` guard cannot
       reach — it stops KEYFRAMES, and this is a transition to a translated
       state. Listed explicitly rather than as a wildcard, so the next look that
       adds a hover transform has to come here and say so. */
    .invite[data-motion='stagger'] .invite__offer {
      transition: none;
    }

    .invite[data-motion='stagger'] .invite__offer:hover,
    .invite[data-motion='stagger'] .invite__offer:focus-within {
      translate: none;
    }
  }
</style>
