<!--
  @component VideoSection

  Cinematic video frame — backs both `introVideo` and `reel` (Codex-2pryk ·
  WP-3/WP-5), the prototype's single `video()` renderer. Honest poster
  placeholder, no real playback. Variants: cinema (corners + meta) · simple ·
  split (text beside the frame). Styling in `../journey-sections.css`.

  ═══════════════════════════════════════════════════════════════════════════
  CONSOLIDATION DELETES THIS FILE (contract A16, `Codex-eckbx`).

  WT-2 has ported both types into the unified public components. This twin and
  its CSS partial are LEFT IN PLACE ON PURPOSE: `JourneyBuilderCanvas` still
  renders through `render-edit/section-registry.ts`, so draining them now would
  leave the studio canvas previewing UNSTYLED sections until the canvas is
  repointed. A16 accepts a canvas that looks different from the published page;
  it does not accept one with no styles.

  ── PORT MAP — this file and `../journey-sections/_video.css` → the public pair
  Public components:
    `render/sections/IntroVideoSection.svelte`  (`introVideo`)
    `render/sections/ReelSection.svelte`        (`reel`)

  | canvas class / rule              | public destination                        |
  |----------------------------------|-------------------------------------------|
  | `.jp-video`                      | `.iv` / `.reel` — padding now             |
  |                                  | `--jp-sec-pad-block/-inline` (density)    |
  | `.jp-video__lead`                | `.iv__lead` / `.reel__lead`               |
  | `.jp-video__kick`                | the shared `.jp-sec__eyebrow` atom        |
  | `.jp-video__heading`             | the shared `.jp-sec__heading--sub` atom   |
  | `.jp-video__sub`                 | `.iv__sub` / `.reel__sub`                 |
  | `.jp-video__frame`               | `.iv__media` / `.reel__frame`             |
  | `.jp-video__frame::after`        | `.iv__scrim` / `.reel__scrim`             |
  | `.jp-video__play`                | `.iv__play` / `.reel__play`               |
  | `.jp-video__corner--{tl,tr,bl,br}` | `.iv__corner--*` / `.reel__corner--*`   |
  | `.jp-video__tag`                 | `.iv__tag` / `.reel__tag`                 |
  | `.jp-video__dur`                 | `.iv__duration` / `.reel__dur`            |
  | `.jp-video--simple .jp-video__corner`, | inverted into the POSITIVE         |
  | `.jp-video--simple .jp-video__tag`     | `brackets` / `framedChrome` derivations |
  | `.jp-video--split .jp-video__wrap` | `.iv__split` / `.reel__split`           |
  | `@container (max-width: 520px)`  | inverted to `@container (min-width: 34rem)` |

  ── THE GENUINE SPLITS, recorded because they are not 1:1 ──────────────────
  • ONE `.jp-video__frame` became TWO public boxes. `introVideo`'s is a 3-layer
    poster plate; `reel`'s is a 5-blend-layer letterbox whose aspect is the
    section's identity. They were never the same box; one canvas class served
    both because the canvas draws neither faithfully.
  • `.jp-video__frame::after` — a scrim fixed at `height: 42%` — was NOT ported
    as a percentage. It became `background: var(--jp-media-scrim)` on a full-box
    overlay, because a fixed-percentage scrim against a variable
    `aspect-ratio` is precisely the coupling defect WT-2 was sent to fix.
  • `.jp-video__play`'s single `background: color-mix(--jp-ember 92%, white)`
    became TWO states in `IntroVideoSection` (`data-iv-plate` solid / hollow),
    because `--jp-accent-fill` is `transparent` at `accent: text` and
    `accent: edge` and a play button is a functional control, not a decoration.

  DELIBERATELY NOT PORTED, because these are axes rather than compositions:
  • `.jp-video__heading`'s `font-size: clamp(1.6rem, 4.4cqw, 2.4rem)` — the
    `type` axis owns scale. Porting it would put treatment back inside the
    variant namespace, which is the thing this programme removes.
  • `.jp-video__lead { text-align: center }` — the `align` axis owns alignment.
  • `.jp-video__frame`'s `box-shadow: 0 34px 80px -40px black` — replaced by
    `--shadow-xl`, since a raw black shadow breaks on a light-brand org (A18).
  ═══════════════════════════════════════════════════════════════════════════
-->
<script lang="ts">
  import { PlayIcon } from '$lib/components/ui/Icon';
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();

  const edit = (key: string) => (value: string) => onEdit?.(key, value);
  const corners = ['tl', 'tr', 'bl', 'br'] as const;
</script>

{#snippet lead()}
  <div class="jp-video__lead">
    {#if has(props, 'kicker')}
      <EditableText tag="p" class="jp-video__kick" field="kicker" value={text(props, 'kicker')} {editable} onEdit={edit('kicker')} />
    {/if}
    <EditableText tag="h2" class="jp-video__heading" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
    {#if has(props, 'sub')}
      <EditableText tag="p" class="jp-video__sub" field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {/if}
  </div>
{/snippet}

{#snippet frame()}
  <div class="jp-video__frame">
    {#each corners as c (c)}<span class="jp-video__corner jp-video__corner--{c}"></span>{/each}
    <!--
      Was a literal `▶` (U+25B6). That codepoint carries EMOJI PRESENTATION on
      Apple platforms, so a glyph that reads as typography in the source was
      shipping an emoji into product UI — the same trap WT-4 found in `map`'s
      `▶ ♪ ✎` content-type map. A geometric-shape codepoint is not automatically
      safe; this is a real icon and belongs in the icon set.
    -->
    <span class="jp-video__play" aria-hidden="true"><PlayIcon /></span>
    {#if has(props, 'clip')}<span class="jp-video__tag">{text(props, 'clip')}</span>{/if}
    {#if has(props, 'duration')}<span class="jp-video__dur">{text(props, 'duration')}</span>{/if}
  </div>
{/snippet}

<section class="jp-video jp-video--{variant}">
  {#if variant === 'split'}
    <div class="jp-video__wrap">{@render lead()}{@render frame()}</div>
  {:else}
    {@render lead()}{@render frame()}
  {/if}
</section>
