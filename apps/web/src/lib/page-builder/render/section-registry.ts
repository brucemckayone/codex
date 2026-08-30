/**
 * Section-type → Svelte component registry (Codex-2pryk.3.1 · WP-3).
 *
 * The public renderer maps a KNOWN {@link CourseSectionType} to its component
 * and SKIPS any unknown type — the frozen contract widens `PageSection.type` to
 * `string` precisely so a future/unrecognised section type degrades to "not
 * rendered" instead of a decode error (forward-compatible). This registry is the
 * one place that mapping lives.
 *
 * INERT + CE-4-safe: it imports section components that themselves consume only
 * DS primitives + the brand-editor token layer — never the studio editor UI
 * (`$lib/components/page-builder`).
 */
import type { Component } from 'svelte';
import type {
  CourseSectionType,
  PageSection,
  ResolvedSectionDesign,
  SectionProps,
} from '$lib/page-builder';
import { aliasKeys } from './coerce';
import AcheSection from './sections/AcheSection.svelte';
import FaqSection from './sections/FaqSection.svelte';
import FeelSection from './sections/FeelSection.svelte';
import GuideSection from './sections/GuideSection.svelte';
import HeroSection from './sections/HeroSection.svelte';
import IntroVideoSection from './sections/IntroVideoSection.svelte';
import InviteSection from './sections/InviteSection.svelte';
import MapSection from './sections/MapSection.svelte';
import ProofSection from './sections/ProofSection.svelte';
import ReelSection from './sections/ReelSection.svelte';
import TurnSection from './sections/TurnSection.svelte';
import type { JourneySalesContext } from './types';

/**
 * The uniform prop contract every section component renders against.
 *
 * The six additive props below are ALL OPTIONAL, deliberately: this interface is
 * the single props contract for all 11 sections, so making any of them required
 * would break every component in one commit and force the whole programme through
 * one worktree. Optional means the foundation lands the seam, and each component
 * work-package opts in when it implements its axes and its edit affordances.
 */
export interface SectionComponentProps {
  config: SectionProps;
  context: JourneySalesContext;
  /**
   * The COMPOSITION to draw — `resolveVariant(section)`'s output (a catalogue
   * variant id, or `''` for an unknown type). Until Codex-qcgo3 this was not
   * merely un-passed, it was absent from this type, so all 37 declared variants
   * were unreachable on the public page. A component that has not implemented its
   * variants yet simply ignores it.
   */
  variant?: string;
  /**
   * The FULLY RESOLVED design axes — `resolveDesign(section, page)`'s output.
   * `SectionRenderer` also emits these as `data-jp-*` attributes on the section
   * wrapper, which is how CSS reads them; the prop exists for the cases that need
   * an axis in MARKUP or in JS (e.g. `motion: 'none'` skipping a reveal
   * observer, or `media: 'none'` not rendering a frame at all).
   */
  design?: ResolvedSectionDesign;
  /**
   * Whether this render is the studio's inline WYSIWYG canvas rather than the
   * public page — the seam that lets ONE component set serve both trees.
   *
   * Passed as a PROP, never resolved by an import: `$lib/page-builder` is the
   * CE-4-scanned PUBLIC_LIB_ROOT and must never pull in
   * `$lib/components/page-builder`. Defaults to false ⇒ public, read-only.
   */
  editable?: boolean;
  /**
   * Commit an inline copy edit: `key` is the `props` key the field maps to,
   * `value` the new string. Only meaningful when `editable` is true; the public
   * renderer never passes it.
   */
  onEdit?: (key: string, value: string) => void;
  /**
   * THE COURSE TITLE, BUT ONLY FOR THE ONE SECTION ALLOWED TO BORROW IT.
   *
   * Five sections were each independently fixed away from a hardcoded editorial
   * fallback (`Codex-i9pzs`) and all five landed on the same replacement — the
   * course's own title (`hero.headline`, `introVideo.heading`, `reel.heading`,
   * `map.title`, `invite.heading`). Each fix is locally right; the aggregate is
   * not. On the DEFAULT state of a page — `section-catalog`'s `defaultProps` do
   * not pre-fill any of those five — the served document reads
   * `<h1>Bone Deep</h1> … <h2>Bone Deep</h2> ×4`: to a reader a rendering fault,
   * to a crawler a keyword-stuffed outline with no hierarchy.
   *
   * So the fallback is now CLAIMED, once per page, by whichever renderable
   * section comes first without an authored heading ({@link claimTitleFallback}).
   * Every other section resolves `undefined` and self-hides its heading element.
   * The five sections MUST read this prop rather than `context.course.title`
   * directly — the context still carries the title, because sections legitimately
   * use it for alt text, modal titles and aria labels, so the discipline is at the
   * heading read and nowhere else.
   *
   * Resolved at the ARRAY level (`SectionRenderer`) rather than pushed onto
   * {@link JourneySalesContext}: one section cannot know what its neighbours
   * authored, and a context field that only the assembler can populate would make
   * every host that builds a context responsible for a rule it cannot see.
   *
   * `undefined` ⇒ this section may not use the course title. A host that mounts
   * `SectionFrame` itself and passes nothing therefore gets self-hiding headings
   * rather than a wrong one, which is the safe direction.
   */
  titleFallback?: string;
  /**
   * The heading level this section's OWN top-level heading must use.
   *
   * `hero` is the only section that emits an `<h1>` (every other of the eleven
   * emits `<h2>` — verified across all of them), and a page may hold more than one
   * hero: `duplicateSection()` clones a section with the same type, and the seeded
   * golden page proved that is not theoretical (it shipped two `id="ache"`,
   * `Codex-yxkj7`). Two heroes therefore served two `<h1>`s.
   *
   * `SectionFrame` passes `2` for any section that is NOT the first of its type on
   * the page, so a duplicated hero demotes its headline to `<h2>` and the document
   * keeps one top-level heading. Deliberately a DEMOTION rather than dropping the
   * duplicate section: an author who duplicated a hero can still see and delete it,
   * on the public page and in the canvas alike, and a renderer that silently
   * withholds a section the author added is a worse failure than an untidy outline.
   * The publish-time answer is {@link validatePageShape}'s `multiple-hero`.
   *
   * Absent ⇒ the component's own default (`1` for `hero`, `2` everywhere else).
   */
  headingLevel?: 1 | 2;
}

/** A renderable section component. */
export type SectionComponent = Component<SectionComponentProps>;

/**
 * The catalogue's section types mapped to their components (in ship order, for
 * readability — order at render time comes from the page's `sections` array).
 */
export const SECTION_COMPONENTS: Record<CourseSectionType, SectionComponent> = {
  hero: HeroSection,
  introVideo: IntroVideoSection,
  ache: AcheSection,
  turn: TurnSection,
  reel: ReelSection,
  map: MapSection,
  feel: FeelSection,
  proof: ProofSection,
  guide: GuideSection,
  faq: FaqSection,
  invite: InviteSection,
};

/**
 * Resolve a stored section type (a widenable `string`) to its component, or
 * `null` when the type is not in this template's catalogue — the renderer skips
 * a `null` (forward-compatible with future section types / other page types).
 */
export function resolveSectionComponent(type: string): SectionComponent | null {
  return (
    (SECTION_COMPONENTS as Record<string, SectionComponent | undefined>)[
      type
    ] ?? null
  );
}

/** A section paired with its resolved component, ready to render. */
export interface RenderableSection {
  section: PageSection;
  Component: SectionComponent;
  /**
   * The section's DOM id — its in-page anchor target, guaranteed unique within
   * the page. See {@link selectRenderableSections} for the scheme.
   */
  anchorId: string;
}

/**
 * The next free anchor id for a section type: the bare type when unused, else the
 * type plus the lowest free ordinal (`ache`, `ache-2`, `ache-3`, …).
 *
 * The ordinal is searched rather than assumed so a generated id can never collide
 * with a real section type — a page holding types `ache`, `ache` and (some future)
 * `ache-2` still produces three distinct ids.
 */
function claimAnchorId(type: string, used: Set<string>): string {
  if (!used.has(type)) {
    used.add(type);
    return type;
  }
  let n = 2;
  while (used.has(`${type}-${n}`)) n += 1;
  const id = `${type}-${n}`;
  used.add(id);
  return id;
}

/**
 * The pure heart of the renderer: given a page's ordered `sections`, return the
 * ones that should render — ENABLED and of a KNOWN type — each paired with its
 * component and its DOM id, in stored order. Disabled sections and unknown types
 * are dropped (forward-compatible). Extracted so the selection rules — and the
 * id scheme — are unit-testable without a DOM.
 *
 * ANCHOR IDS (Codex-yxkj7). The renderer used the section TYPE as the DOM id,
 * justified by a comment claiming types are unique within a page. They are not:
 * `duplicateSection()` clones a section with the SAME type, and the seeded golden
 * page (`of-blood-and-bones` → `pricing-smoke-test`) served two
 * `<section id="ache">` — an invalid document where `#ache` resolves to whichever
 * came first.
 *
 * The FIRST section of a type keeps the type-named id, so any `#<type>` link a
 * visitor already holds still lands on the section they expect; later duplicates
 * take an ordinal suffix. (No component currently EMITS an in-page anchor — the
 * hero's scroll cue is a decorative `aria-hidden` div, not the `#map` link the
 * old comment here claimed — but the ids are in served HTML and therefore
 * bookmarkable, so the first-wins rule is what keeps them stable.)
 *
 * Assigned HERE, over the already-filtered list, so a disabled or unknown section
 * never consumes an ordinal and toggling one off cannot renumber its neighbours.
 */
export function selectRenderableSections(
  sections: readonly PageSection[]
): RenderableSection[] {
  const used = new Set<string>();
  const out: RenderableSection[] = [];
  for (const section of sections) {
    if (!section.enabled) continue;
    const Component = resolveSectionComponent(section.type);
    if (Component === null) continue;
    out.push({
      section,
      Component,
      anchorId: claimAnchorId(section.type, used),
    });
  }
  return out;
}

/**
 * The prop each fallback-capable section resolves its own top heading from. Only
 * these five can borrow the course title, so only these five can CLAIM it.
 *
 * Read through `aliasKeys` at the call site rather than listing the aliases here:
 * `map.title` also accepts the builder's stored `heading` key, and a second copy
 * of that preference list is exactly how a claim could disagree with the render
 * (`map` would self-hide a heading it was in fact authored).
 */
const TITLE_FALLBACK_PROP: Readonly<Record<string, string>> = {
  hero: 'headline',
  introVideo: 'heading',
  reel: 'heading',
  map: 'title',
  invite: 'heading',
};

/** Whether this section's own heading prop is authored (aliases included). */
function hasAuthoredHeading(section: PageSection): boolean {
  const prop = TITLE_FALLBACK_PROP[section.type];
  if (prop === undefined) return true;
  return aliasKeys(section.type, prop).some((key) => {
    const value = section.props?.[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * Which section — if any — may fall back to the course title for its heading.
 * Returns its `section.id`, or `null` when every fallback-capable section on the
 * page is authored (or the page has none).
 *
 * TWO PASSES, AND THE ORDER IS LOAD-BEARING.
 *
 *  1. A HEADING-LESS `hero` WINS WHEREVER IT SITS. Its `<h1>` is the only one on
 *     the page and it cannot self-hide — a hero with no headline is a
 *     full-viewport blank stage, and `HeroSection` splits the headline into words,
 *     so an absent one is not even renderable. Handing the claim to an earlier
 *     `map` would leave the hero with nothing to print. `HeroSection` therefore
 *     keeps an unconditional last-resort fallback of its own, and this pass is
 *     what stops that fallback ever DUPLICATING another section's heading.
 *  2. Otherwise FIRST-WINS among the remaining four. Not "hero-wins" as a general
 *     rule: a page with no `hero` at all would then have no heading anywhere
 *     carrying the course's name, and `validatePageShape` only WARNS on `no-hero`
 *     because opening on an `ache` is a real editorial choice.
 *
 * Pure, and takes the already-filtered renderables so a DISABLED or unknown-type
 * section can never claim a fallback nobody will see.
 */
export function claimTitleFallback(
  renderables: readonly RenderableSection[]
): string | null {
  const hero = renderables.find(
    ({ section }) => section.type === 'hero' && !hasAuthoredHeading(section)
  );
  if (hero !== undefined) return hero.section.id;

  const first = renderables.find(({ section }) => !hasAuthoredHeading(section));
  return first?.section.id ?? null;
}

/** One thing wrong with a page's section composition. */
export interface PageShapeIssue {
  /** Stable machine code — the UI maps it to copy, tests assert on it. */
  code:
    | 'empty-page'
    | 'no-hero'
    | 'multiple-hero'
    | 'hero-not-first'
    | 'no-cta';
  /**
   * `error` shapes must not reach a PUBLISHED page — the builder's publish action
   * blocks on them and the service rejects them. `warn` shapes are surfaced
   * inline and publishable: they are taste, or a deliberate choice a creator is
   * allowed to make.
   */
  severity: 'error' | 'warn';
}

/**
 * Validate a page's SECTION COMPOSITION — the one property of a journey page that
 * nothing checked anywhere.
 *
 * `selectRenderableSections` filters on `enabled` + known-type and preserves
 * array order verbatim; its tests assert order preservation and nothing about
 * validity. So the builder could publish, and did not stop, any of:
 *
 *   · `sections: []` — which is what `createJourney` INSERTS. Publishing without
 *     adding a section serves a document with a valid `<title>`, a `Course`
 *     JSON-LD asserting the course exists, and a body holding nothing but a
 *     hidden `inert` floating pill. An indexable blank page.
 *   · two `hero` sections — reachable via `duplicateSection()` — i.e. two
 *     full-viewport stages at `min-height: min(100svh, 80svh × rhythm)` before any
 *     content, and (until `headingLevel`) two `<h1>`s.
 *   · a page with no `hero`, so no `<h1>` at all under a run of `<h2>`s.
 *   · a sales page with no conversion affordance anywhere.
 *
 * PURE + ORDER-AWARE, taking the STORED sections rather than the renderables:
 * a section the author has toggled off is not part of the published shape, so the
 * same `enabled` + known-type filter is applied here — an unknown future type
 * cannot be judged and is skipped, exactly as the renderer skips it.
 *
 * Severities are calibrated to what a creator is ALLOWED to want. Opening on an
 * `ache` rather than a hero is a real editorial choice (`no-hero`, `warn`), and so
 * is putting a `turn` above the hero (`hero-not-first`, `warn`). Two heroes and an
 * empty page are not choices, they are mistakes with no reading that helps a
 * visitor; a page that cannot be bought from is the one that costs the creator
 * money.
 *
 * `no-cta` deliberately tests for a `hero` OR an `invite` and NOT for
 * `context.purchasable`: this is a check on the page's SHAPE, evaluated where
 * there is no viewer and no offer read. A course with nothing to sell yet is a
 * legitimate draft; a published page with nowhere to press is not.
 */
export function validatePageShape(
  sections: readonly PageSection[]
): PageShapeIssue[] {
  const live = sections.filter(
    (section) =>
      section.enabled && resolveSectionComponent(section.type) !== null
  );

  if (live.length === 0) return [{ code: 'empty-page', severity: 'error' }];

  const issues: PageShapeIssue[] = [];
  const heroCount = live.filter((section) => section.type === 'hero').length;

  if (heroCount === 0) issues.push({ code: 'no-hero', severity: 'warn' });
  if (heroCount > 1) issues.push({ code: 'multiple-hero', severity: 'error' });
  if (heroCount > 0 && live[0].type !== 'hero') {
    issues.push({ code: 'hero-not-first', severity: 'warn' });
  }
  if (heroCount === 0 && !live.some((section) => section.type === 'invite')) {
    issues.push({ code: 'no-cta', severity: 'error' });
  }

  return issues;
}
