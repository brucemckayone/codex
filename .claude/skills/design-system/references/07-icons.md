# Reference 07 — Icons

The Codex icon system is **hand-rolled** (no icon library dependency). 67 icon components
live at `apps/web/src/lib/components/ui/Icon/`, each rendering through a shared `IconBase`
wrapper.

## 1. The Architecture

```
lib/components/ui/Icon/
├── IconBase.svelte          # The <svg> wrapper — size, viewBox, stroke, aria-hidden
├── index.ts                 # Barrel — exports every icon
├── AlertCircleIcon.svelte
├── CheckIcon.svelte
├── ChevronDownIcon.svelte
├── …62 more…
└── CloseIcon.svelte
```

**`IconBase.svelte`** (canonical source):

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SVGAttributes } from 'svelte/elements';

  interface Props extends SVGAttributes<SVGSVGElement> {
    size?: number | string;
    children: Snippet;
  }

  const { size = 24, children, class: className, ...restProps }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className ?? ''}
  aria-hidden="true"
  {...restProps}
>
  {@render children()}
</svg>
```

## 2. Usage

```svelte
<script lang="ts">
  import { CheckIcon, ChevronDownIcon } from '$lib/components/ui/Icon';
</script>

<!-- Decorative (alongside label) -->
<button>
  <CheckIcon />
  Save changes
</button>

<!-- Sized -->
<CheckIcon size={16} />
<CheckIcon size="2rem" />    <!-- string values pass through as-is -->

<!-- Icon-only button — MUST have aria-label on the button -->
<button aria-label="Dismiss notification">
  <CloseIcon />
</button>

<!-- Colour inheritance — uses currentColor stroke -->
<span style="color: var(--color-error)">
  <AlertCircleIcon />        <!-- renders in error red -->
</span>
```

## 3. Rules

| Rule | Why |
|---|---|
| `stroke="currentColor"` — never hardcode | Inherits from surrounding `color` so icons theme with text |
| `aria-hidden="true"` on SVG by default | Icons are decorative; the semantic name lives on the parent `<button>` or `<a>` |
| Sizing in **px**, not `em` | Icon size must not scale with surrounding text — it's a chrome element, not copy |
| Stroke-width `2` default; `1.5` for fine icons | Set via `stroke-width` attr on individual icons (they override `IconBase`) |
| `viewBox="0 0 24 24"` standard | All icons share this coordinate system — swap is a drop-in replacement |
| Never inline `<svg>` in components outside the Icon folder | Drifts, misses a11y, breaks theming |

## 4. Adding a New Icon

1. **Source the SVG** — ideally from Lucide (already the design-language base), Heroicons, or
   custom design. Ensure 24×24 viewBox with stroke-based paths (not filled shapes).
2. **Create `NewIcon.svelte`** in `lib/components/ui/Icon/`:
   ```svelte
   <script lang="ts">
     import IconBase from './IconBase.svelte';
     import type { SVGAttributes } from 'svelte/elements';
     let { size, class: className, ...rest }: SVGAttributes<SVGSVGElement> & { size?: number | string } = $props();
   </script>

   <IconBase {size} class={className} {...rest}>
     <!-- Paste the inner <path>, <circle>, <line>… elements here -->
     <path d="M12 2v20" />
     <path d="M2 12h20" />
   </IconBase>
   ```
3. **Export from the barrel** — add to `lib/components/ui/Icon/index.ts`:
   ```ts
   export { default as NewIcon } from './NewIcon.svelte';
   ```
4. **Verify** — import and render the icon in a story or test page. Confirm currentColor
   inheritance and sizing with Chrome DevTools MCP screenshot at 16/20/24/32 px.
5. **Never** paste fill-based paths or `fill="#xxxxxx"` — strip those. If an icon genuinely
   needs fills, make it a separate one-off component outside the Icon folder and document why.

## 5. Logo Handling (Separate From Icons)

Org logos are **uploaded assets**, not hand-rolled SVG components:

- Stored in R2 (via dev-cdn on port 4100 for local dev)
- Rendered as `<img src={logoUrl} alt="{orgName} logo" />`
- Managed by `BrandEditorLogo.svelte` + `LogoUpload.svelte`
- Visibility controlled by `hero-hide-logo` token override (see
  [10-brand-editor.md Path E](10-brand-editor.md#7-path-e--adding-a-new-visibility-flag))

If you need to render a platform-level logo SVG (not an org logo), add it under
`lib/components/branding/` as a standalone component — don't mix into the icon system.

## 6. Inline-SVG Strays

Several components still inline `<svg>` markup (stories, some video player chrome,
`IntroVideoModal.svelte`). When you touch one of these files, migrate to the Icon pattern:

1. Extract the SVG's inner paths into a new `<NewIcon>.svelte` if the icon doesn't exist yet
2. Replace the inline `<svg>…</svg>` with `<NewIcon />`
3. If it's truly a one-off illustration (not a chrome icon), keep it inline but add
   `aria-hidden="true"` and ensure the parent has an accessible name

## 7. UI-Text Glyphs Are Icons

Unicode characters used as standalone UI chrome count as icons under R7 and must not be
inlined. Seen in the wild (iter-04):

| Glyph | Typical misuse | Correct replacement |
|---|---|---|
| `+` / `−` | Accordion expand/collapse indicator | `<ChevronDownIcon />` rotated, or `<PlusIcon>` / `<MinusIcon>` |
| `▲` / `▼` | Sort direction, panel expand/collapse | `<ChevronUpIcon />` / `<ChevronDownIcon />` |
| `●` / `○` | Visibility toggle, radio state | `<CircleIcon filled />` / `<CircleIcon />` or `<EyeIcon />` |
| `◇` / `◈` / `◻` / `✦` | Category-indicator glyphs in menus | Extract a proper icon; if decorative in a map, keep but `aria-hidden` |

Why it matters:
- Font substitution on low-coverage systems can render the wrong glyph or a `.notdef` box
- Screen readers announce some glyphs as their Unicode name ("BLACK UP-POINTING TRIANGLE")
- Sizing is inconsistent with the icon system — glyphs pick up the text font scale, icons pick up `size` prop
- Brand-level customization can't skin glyphs (no `currentColor` contract)

**When glyphs ARE OK**: decorative map-icons in enums (`levels.ts`'s category icons) where
the glyph never enters the DOM directly — it's metadata consumed by a renderer that
substitutes the real icon. If your code does `{category.icon}` in markup, that's a glyph-as-UI-text,
not metadata.

## 8. Gotchas / Anti-patterns

- **Don't** inline `<svg>` in components when an Icon would do. Drift risk, a11y risk, theme-break risk.
- **Don't** use PNG/JPG for a UI glyph. Raster icons don't scale, don't theme, and cost bytes.
- **Don't** hardcode `stroke="#000"` or `stroke="var(--color-text)"` — use `currentColor` (the default).
- **Don't** forget `aria-label` on icon-only buttons. The `<svg>` is `aria-hidden` by design — the button needs its own name.
- **Don't** size icons in `em` unless you specifically want them to scale with text (rare — usually wrong in chrome contexts).
- **Don't** override `viewBox` per-icon. Keep 24×24 so every icon is a drop-in swap.
- **Don't** export `IconBase` to consumers. Every consumer imports a specific named icon.
- **Don't** ship a new icon without adding it to the barrel. Unregistered icons break the import contract.

## 9. When to Re-Verify This Reference

- `apps/web/src/lib/components/ui/Icon/IconBase.svelte` — wrapper implementation
- `apps/web/src/lib/components/ui/Icon/index.ts` — current icon inventory
- Any PR that introduces an icon library dependency (would change this entire reference)

If the code disagrees, **the code wins**.
