<!--
  @component GuideSection (CANVAS TWIN)

  The guide / credibility section (Codex-2pryk · WP-3/WP-5). Candlelit poster
  play-frame beside role / heading / bio / pull-quote. Styling in
  `../journey-sections.css` → `../journey-sections/_guide.css`.

  ═══════════════════════════════════════════════════════════════════════════
  SUPERSEDED — CONSOLIDATION DELETES THIS FILE.

  Contract A16: the surviving component is the unified public one at
  `render/sections/GuideSection.svelte`, which now carries all five compositions,
  all nine design axes and the `editable` / `onEdit` seam as PROPS. This twin is
  kept alive only until `JourneyBuilderCanvas.svelte` is repointed at that
  component (`Codex-eckbx`), because deleting it now would leave the builder
  canvas previewing an UNSTYLED section. A16 accepts a canvas that looks
  different from the published page; it does not accept one with no styles.

  DO NOT add features here. Everything below has a port target.

  ── PORT MAP (canvas class → public class) ────────────────────────────────
  | this file / `_guide.css`  | `render/sections/GuideSection.svelte`        |
  |---------------------------|---------------------------------------------|
  | `.jp-guide`               | `.guide`                                    |
  | `.jp-guide__inner`        | `.guide__inner`                             |
  | `.jp-guide__player`       | `.guide__plate`                             |
  | `.jp-guide__ember`        | `.guide__ember` (inside `.guide__atmos`)    |
  | `.jp-guide__watch`        | `.guide__tag`                               |
  | `.jp-guide__dur`          | `.guide__dur`                               |
  | `.jp-guide__play`         | `.guide__play` (+ `.guide__play-icon`)      |
  | `.jp-guide__text`         | `.guide__body`                              |
  | `.jp-guide__role`         | `.guide__eyebrow` (+ `.jp-sec__eyebrow`)    |
  | `.jp-guide__heading`      | `.guide__heading` (+ `.jp-sec__heading--sub`)|
  | `.jp-guide__body`         | `.guide__bio` (+ `.jp-sec__measure`)        |
  | `.jp-guide__quote`        | `.guide__quote`                             |
  | `.jp-guide--centered`     | `.guide--column`   (variant id `column`)    |
  | `.jp-guide--quote`        | `.guide--quote`                             |
  | — (new)                   | `.guide--credentials`, `.guide--letter`      |
  | — (new)                   | `.guide__atmos`, `.guide__center`,           |
  |                           | `.guide__img`, `.guide__scrim`,               |
  |                           | `.guide__grain`, `.guide__vignette`,          |
  |                           | `.guide__sheen`, `.guide__mark`,              |
  |                           | `.guide__name`, `.guide__facts`,              |
  |                           | `.guide__fact`, `.guide__sign`,               |
  |                           | `.guide__sig`, `.guide__signoff`              |

  ── SPLITS AND DELIBERATE NON-PORTS ──────────────────────────────────────
  • `.jp-guide__player` SPLIT into four public elements. The canvas packs a
    portrait frame, an atmosphere stack, a scrim and a centring context into one
    685-character rule; the public version separates them because the `media`
    axis owns the frame's geometry (`--jp-media-aspect` / `-radius` / `-inset` /
    `-mask` / `-scrim` / `-display`) while `surface` owns the atmosphere through
    the single `--jp-sec-atmos` gate on `.guide__atmos`. They are two axes and
    could not share one element.
  • `.jp-guide__play`'s `▶` TEXT GLYPH IS NOT PORTED — it is replaced here too,
    with `PlayIcon` via `IconBase`. U+25B6 carries emoji presentation on Apple
    platforms, so a glyph that looks typographic was shipping an emoji into
    product UI (round-2 lesson; `Codex-1khpv` tracks the same class of defect in
    the section catalogue's own `icon: '☺'`, which is a CLOSED file and is
    reported, not fixed).
  • The canvas's `.jp-guide--quote .jp-guide__body { display: none }` is NOT
    ported. The catalogue's own hint for this composition is "A big pull-quote
    leads; bio and attribution beneath", so the public `quote` composition keeps
    the bio and demotes the heading instead. The hint is the specification.
  • Every hardcoded size in `_guide.css` (`clamp(1.6rem, 4.2cqw, 2.6rem)`,
    `0.72rem`, `1.72` leading, `16px`/`26px` radii, `40px 90px -50px` shadow) is
    NOT ported as a literal. Those are what the `type`, `density`, `edge` and
    `media` axes replace — that substitution is the whole point of the WP.
  ═══════════════════════════════════════════════════════════════════════════
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';
  import { PlayIcon } from '$lib/components/ui/Icon';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
</script>

<section class="jp-guide jp-guide--{variant}">
  <div class="jp-guide__inner">
    <div class="jp-guide__player">
      <span class="jp-guide__ember" aria-hidden="true"></span>
      {#if has(props, 'clip')}<span class="jp-guide__watch">{text(props, 'clip')}</span>{/if}
      {#if has(props, 'duration')}<span class="jp-guide__dur">{text(props, 'duration')}</span>{/if}
      <span class="jp-guide__play" aria-hidden="true"><PlayIcon /></span>
    </div>
    <div class="jp-guide__text">
      {#if has(props, 'role')}
        <EditableText tag="p" class="jp-guide__role" field="role" value={text(props, 'role')} {editable} onEdit={edit('role')} />
      {/if}
      <EditableText tag="h2" class="jp-guide__heading" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
      {#if has(props, 'body')}
        <EditableText tag="p" class="jp-guide__body" field="body" value={text(props, 'body')} {editable} onEdit={edit('body')} />
      {/if}
      {#if has(props, 'quote')}
        <blockquote class="jp-guide__quote">
          <EditableText tag="p" field="quote" value={text(props, 'quote')} {editable} onEdit={edit('quote')} />
        </blockquote>
      {/if}
    </div>
  </div>
</section>
