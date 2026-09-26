<!--
  @component PageRenderer

  The page kit's root: one `.lp[data-lp-style]` element per page, its sections
  resolved once (`resolveSections`) and each rendered through its block.

  PAGE BRAND OVERRIDES keep today's mechanism: the root becomes a nested
  `[data-org-brand]` carrying only the overridden `--brand-*` inputs
  (`render/brand-overrides.ts`); anything unset inherits the org. The page's
  own fonts are loaded here, because the org layout loads only the org's.

  EDITING changes attributes, never structure: with `edit` the text fields
  carry the inline-edit seam, the root is still (no entrance), sections carry
  their id for selection, and there is no floating bar over the canvas.

  `theme` is a SCOPED preview (`data-lp-theme`) for thumbnails and the dev
  route; it never touches `<html data-theme>` (ref 11-theming §4).
-->
<script lang="ts">
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import { brandOverridesToStyleAttr } from '../render/brand-overrides';
  import type { JourneySalesContext } from '../render/types';
  import { priceWithCadence } from './model/copy';
  import { brandFontsHref } from './model/fonts';
  import { pricingView } from './model/offer';
  import { readText } from './model/read';
  import { resolveSections, resolveStyle } from './model/resolve';
  import type { BlockEdit, KitPage } from './model/types';
  import { type PageEdit, setKitPage } from './page-context';
  import { BLOCKS } from './registry';
  import SectionShell from './SectionShell.svelte';
  import StickyCta from './StickyCta.svelte';
  import './styles/kit.css';
  import './styles/schemes.css';
  import './styles/style-bold.css';
  import './styles/style-clean.css';
  import './styles/style-soft.css';
  import './styles/style-cinematic.css';

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
  }: Props = $props();

  const style = $derived(resolveStyle(page.design));
  const sections = $derived(resolveSections(page));
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
  const fontsHref = $derived(brandFontsHref(brandOverrides));

  setKitPage({
    get style() {
      return style;
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
  const signature = $derived(sections.map((s) => `${s.id}:${s.layout}`).join('|'));
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
  data-org-brand={brandStyle ? '' : undefined}
  style={brandStyle}
>
  <div class="lp-page">
    {#each sections as section (section.id)}
      {@const Block = BLOCKS[section.type]}
      <SectionShell {section} editing={!!edit} selected={selectedId === section.id}>
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
      scheme={style === 'cinematic' ? 'soft' : 'contrast'}
      {signature}
    />
  {/if}
</div>
