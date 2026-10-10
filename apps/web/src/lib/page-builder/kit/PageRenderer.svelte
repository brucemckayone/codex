<!--
  @component PageRenderer

  The page kit's root: one `.lp[data-lp-style]` element per page, its sections
  resolved once (`resolveSections`) and each rendered through its block.

  PAGE BRAND OVERRIDES keep today's mechanism: the root becomes a nested
  `[data-org-brand]` carrying only the overridden `--brand-*` inputs
  (`render/brand-overrides.ts`); anything unset inherits the org. A page
  that sets its own background also carries `data-org-bg`, so the org's
  surfaces, text and border are derived from it in that background's theme
  — the kit draws those tokens (`styles/schemes.css`), and gives the other
  theme back to the org's when the page sets no twin for it
  (`data-page-bg`: light, dark or both). The page's
  own fonts are loaded here, because the org layout loads only the org's.

  THE GROUND'S POLE AND BAND (03 X48) follow the org's ground, not the
  viewer's theme, and CSS cannot read a colour's lightness: so each theme's
  ground is resolved here (`model/resolve.ts`) from the org's backgrounds
  (the `orgGrounds` prop: the caller passes the layout's data, or the brand
  editor's while it is open) and the page's own, and named on the root as
  `data-ground-light` /
  `data-ground-dark`. A moving background is drawn only on the bands it is
  proven on, and as `base` elsewhere.

  EDITING changes attributes, never structure: with `edit` the text fields
  carry the inline-edit seam, the root is still (no entrance), sections carry
  their id for selection, and there is no floating bar over the canvas.

  STILL (a thumbnail, or editing) is also on the page context, so a block may
  draw what stands in for missing media there — a plate, a frame waiting for
  a picture — and never on the public page. What the canvas alone draws is
  marked `data-lp-edit-only`.

  `theme` is a SCOPED preview (`data-lp-theme`) for thumbnails and the dev
  route; it never touches `<html data-theme>` (ref 11-theming §4).

  ATMOSPHERE (03 §5.1): `data-lp-atmosphere` marks a live page with a "Moving
  background" section, so the org layout clears the stack above its shader
  for this page only. Never set while editing or still — the canvas and
  thumbnails sit inside the studio, and there `atmosphere` draws its glow.

  ENTRANCES (03 X13): the root hosts the page's stage (`motion/entrances.ts`),
  which plays each reveal, build and mark once as the visitor reaches it.
  Nothing is staged while still.
-->
<script lang="ts">
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    brandOverridesToCssVars,
    brandOverridesToStyleAttr,
  } from '../render/brand-overrides';
  import type { JourneySalesContext } from '../render/types';
  import { priceWithCadence } from './model/copy';
  import { brandFontsHref } from './model/fonts';
  import { pricingView } from './model/offer';
  import { readText } from './model/read';
  import {
    atmosphereProven,
    resolveGroundBands,
    resolveSections,
    resolveStyle,
    type ThemeGrounds,
  } from './model/resolve';
  import { STYLES } from './model/styles';
  import type { BlockEdit, KitPage } from './model/types';
  import { entrances } from './motion/entrances';
  import { type PageEdit, setKitPage } from './page-context';
  import { BLOCKS } from './registry';
  import SectionShell from './SectionShell.svelte';
  import StickyCta from './StickyCta.svelte';
  import './styles/kit.css';
  import './styles/schemes.css';
  import './styles/surfaces.css';
  import './styles/motion.css';
  import './styles/style-bold.css';
  import './styles/style-clean.css';
  import './styles/style-soft.css';
  import './styles/style-cinematic.css';
  import './styles/style-path.css';
  import './styles/style-poster.css';
  import './styles/style-studio.css';
  import './styles/style-quiet.css';

  interface Props {
    page: KitPage;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    edit?: PageEdit | null;
    selectedId?: string | null;
    theme?: 'light' | 'dark';
    /** No entrance motion (thumbnails, galleries). Always true while editing. */
    still?: boolean;
    /** Show the floating call to action. Never shown while editing. */
    sticky?: boolean;
    /**
     * The org's own backgrounds per theme, as its layout paints them
     * (`$lib/page-builder/org-grounds.ts`; 03 X48). Passed in as plain data,
     * never read from a store here. Absent: no org background, so each
     * theme takes its own pole.
     */
    orgGrounds?: ThemeGrounds;
  }

  const {
    page,
    context,
    brandOverrides = null,
    edit = null,
    selectedId = null,
    theme,
    still = false,
    sticky = true,
    orgGrounds = {},
  }: Props = $props();

  const style = $derived(resolveStyle(page.design));
  const grounds = $derived.by(() => {
    const vars = brandOverridesToCssVars(brandOverrides);
    return resolveGroundBands(orgGrounds, {
      light: vars['--brand-bg'],
      dark: vars['--brand-bg-dark'],
    });
  });
  const sections = $derived.by(() => {
    const resolved = resolveSections(page);
    return atmosphereProven(grounds)
      ? resolved
      : resolved.map((s) =>
          s.scheme === 'atmosphere' ? { ...s, scheme: 'base' as const } : s
        );
  });
  const propsById = $derived(new Map(page.sections.map((s) => [s.id, s.props])));
  const edits = $derived(
    new Map<string, BlockEdit | null>(
      sections.map((s) => [
        s.id,
        edit ? { commit: (key: string, value: string) => edit.commit(s.id, key, value) } : null,
      ])
    )
  );
  const brandStyle = $derived(brandOverridesToStyleAttr(brandOverrides));
  // `org-brand.css` derives the surfaces, text and border from the background
  // only under `[data-org-bg]`, which has no page-override twin: a page that
  // sets its own background carries the attribute, so they follow it — in
  // that background's own theme only (`schemes.css`, owner D7).
  // Which theme(s) that background is for: the kit selects on this, never on
  // the style text, to give the other theme back to the org.
  const pageBg = $derived.by(() => {
    const vars = brandOverridesToCssVars(brandOverrides);
    const light = '--brand-bg' in vars;
    const dark = '--brand-bg-dark' in vars;
    return light && dark ? 'both' : light ? 'light' : dark ? 'dark' : undefined;
  });
  const fontsHref = $derived(brandFontsHref(brandOverrides));

  setKitPage({
    get style() {
      return style;
    },
    // As `data-lp-still` below: editing is always still.
    get still() {
      return still || !!edit;
    },
  });

  /** The floating bar says what the page's own offer button says. */
  const offerProps = $derived(
    propsById.get(sections.find((s) => s.type === 'pricing')?.id ?? '') ?? {}
  );
  const heroProps = $derived(
    propsById.get(sections.find((s) => s.type === 'hero')?.id ?? '') ?? {}
  );
  const stickyLabel = $derived(
    readText(offerProps, 'ctaLabel') ?? readText(heroProps, 'ctaLabel')
  );
  const stickyPrice = $derived.by(() => {
    const featured = pricingView(context, offerProps).featured;
    return featured ? priceWithCadence(featured) : undefined;
  });
  const showSticky = $derived(sticky && !edit && sections.length > 0);
  // The floating bar is the org's own raised card (its card colour, D9),
  // holding the org's own button, unless a Style names a band for it (phase
  // 3a): a dark bar is a band the org's site never shows, and its button
  // would have to move to stay legible.
  const stickyScheme = $derived(STYLES[style].sticky ?? 'base');
  const signature = $derived(sections.map((s) => `${s.id}:${s.layout}`).join('|'));
  // The org's shader draws in the ORG's colours, so a page with its own
  // colours shows the glow (which follows them) rather than clash (03 X11).
  const ownColours = $derived(
    Boolean(brandOverrides?.primaryColor || brandOverrides?.secondaryColor)
  );
  const atmosphere = $derived(
    edit || still || ownColours || !sections.some((s) => s.scheme === 'atmosphere')
      ? undefined
      : (STYLES[style].atmosphere ?? 'soft')
  );
</script>

<svelte:head>
  {#if fontsHref}<link rel="stylesheet" href={fontsHref} />{/if}
</svelte:head>

<div
  class="lp"
  data-lp-style={style}
  data-lp-theme={theme}
  data-lp-still={still || edit ? '' : undefined}
  data-lp-editing={edit ? '' : undefined}
  data-lp-atmosphere={atmosphere}
  data-org-brand={brandStyle ? '' : undefined}
  data-org-bg={pageBg ? '' : undefined}
  data-page-bg={pageBg}
  data-ground-light={grounds.light}
  data-ground-dark={grounds.dark}
  style={brandStyle}
  {@attach entrances(still || !!edit)}
>
  <div class="lp-page">
    {#each sections as section (section.id)}
      {@const Block = BLOCKS[section.type]}
      <SectionShell
        {section}
        background={propsById.get(section.id)?.background}
        mediaBaseUrl={context.mediaBaseUrl}
        editing={!!edit}
        selected={selectedId === section.id}
      >
        <Block
          props={propsById.get(section.id) ?? {}}
          {section}
          {context}
          edit={edits.get(section.id) ?? null}
        />
      </SectionShell>
    {/each}
  </div>
  {#if showSticky}
    <StickyCta
      {context}
      label={stickyLabel}
      priceLine={stickyPrice}
      scheme={stickyScheme}
      {signature}
    />
  {/if}
</div>
