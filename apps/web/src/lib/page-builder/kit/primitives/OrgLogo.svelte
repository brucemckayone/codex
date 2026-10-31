<!--
  @component OrgLogo

  The org's logo, which the hero sets above its words (Codex-61zsk.73), so a
  phone visitor sees it too: the site's rail that shows it is hidden there.
  40px tall, 32px at phone width, never wider than 160px, in its own
  proportions: the kit's `--lp-logo-h` and `--lp-logo-box` (kit.css), which
  the hero's poster and Path's route read too, so they always allow for the
  box this draws. It is a picture of the org's name, so the name is what it
  says. It is not a link: the rail and the bottom bar already go home, and a
  new tab stop would change every Tab walk.

  THE PLATE: an org has one logo file, and most are drawn for white, so on a
  dark ground it sits on a small white plate. Whether a ground is dark is
  not known where the page is rendered (the viewer's theme is chosen on
  `<html>`), so the plate decides in CSS from the section's ink: light ink
  means a dark ground, and the plate is drawn; dark ink, and it is clear.
  `plate` forces it, for a ground whose ink does not tell (the org's shader,
  a cover picture: owner call 8). In forced colours the user's palette
  replaces every ground, so the plate is always drawn there.

  It sets no space below itself: the words' grid gap sets it off the eyebrow.
  The plate's padding is always there, and taken back by the margin, so the
  mark lines up with the eyebrow's words whether or not the plate shows. It
  is as wide as its picture and leaves its alignment to its parent, so a
  centred grid or a centred line centres it.
-->
<script lang="ts">
  interface Props {
    /**
     * The org's logo file: one, as uploaded, with no sizes to choose from,
     * so it offers no `srcset` (the image-sizes census knows it by this
     * name: `image-sizes-coverage.test.ts`).
     */
    logoUrl: string;
    name: string;
    /**
     * Always the plate, for a ground whose ink does not tell (the org's
     * shader, a cover picture). False: the ink decides.
     */
    plate: boolean;
    class?: string;
    /**
     * Told the address that failed to load, so a parent that sets the logo
     * in a row of its own can take the row away too.
     */
    onfail?: (logoUrl: string) => void;
  }

  const { logoUrl, name, plate, class: className, onfail }: Props = $props();

  // A logo that fails to load leaves nothing, never a broken glyph; another
  // address (the brand editor swapping it) tries again.
  let failed = $state<string | null>(null);

  function fail() {
    failed = logoUrl;
    onfail?.(logoUrl);
  }
</script>

{#if logoUrl && logoUrl !== failed}
  <img
    class="lp-logo {className ?? ''}"
    src={logoUrl}
    alt={name}
    decoding="async"
    data-plate={plate ? '' : undefined}
    onerror={fail}
  />
{/if}

<style>
  /* The plate's padding above and below is what the kit's box leaves round
     the logo's height, and its sides a share of that height, so it keeps
     its shape at phone width; the logo stays its size.
     The margin takes the inline padding back, so the plate, where it shows,
     reaches into the gutter and the mark stays on the words' edge; at most
     160px of mark, and never more than its column. White is written from
     the ink as the kit writes its fixed colours (its `--_anti-ink`), so no
     literal colour appears: opaque where the ink is light, clear where it
     is dark. An engine without relative colour draws no plate: it keeps the
     first declaration, or, since a `var()` fails only once computed, ends
     at the same clear ground. The logo then stands bare.
     No shadow: it would outline a clear plate on a light ground. Its
     corners bend with the Style's pictures, never rounder than a quarter of
     the logo's height. */
  .lp-logo {
    --_h: var(--lp-logo-h);
    --_pad-b: calc((var(--lp-logo-box) - var(--_h)) / 2);
    --_pad-i: calc(var(--_h) * 0.25);
    display: inline-block;
    vertical-align: top;
    box-sizing: border-box;
    block-size: var(--lp-logo-box);
    inline-size: auto;
    max-inline-size: calc(min(calc(var(--space-10) * 4), 100%) + 2 * var(--_pad-i));
    margin-inline: calc(-1 * var(--_pad-i));
    padding: var(--_pad-b) var(--_pad-i);
    border-radius: min(var(--lp-radius-media), calc(var(--_h) * 0.25));
    background: none;
    background: oklch(from var(--lp-ink) 1 0 0 / clamp(0, (l - 0.5) * 100, 1));
    object-fit: contain;
  }

  /* Forced: the shader and a cover picture, whose ink does not tell. */
  .lp-logo[data-plate] {
    background: oklch(from var(--lp-ink) 1 0 0);
  }

  /* The system palette would paint the plate in the user's own ground: it
     keeps its white, outlined in the user's text colour. */
  @media (forced-colors: active) {
    .lp-logo {
      background: oklch(from var(--lp-ink) 1 0 0);
      forced-color-adjust: none;
      outline: var(--lp-border) solid CanvasText;
    }
  }
</style>
