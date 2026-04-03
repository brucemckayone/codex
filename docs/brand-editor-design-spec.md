# Brand Editor Design Specification

**Version**: 1.0
**Date**: 2026-04-03
**Status**: Implementation-ready

---

## 1. Overview

The Brand Editor is a floating panel that lets org admins customize branding while browsing their live site. It replaces the static branding settings form with an interactive, Figma-style editing experience.

### Entry Point

Studio > Settings > Branding > **"Edit Brand Live"** button.

Clicking this button navigates to the org's public space page with `?brandEditor=true` in the URL. The panel opens over the live site — the admin sees every change instantly as they make it.

### Who Can Use It

Only users with `creator` or `admin` role on the current org. The panel component checks role on mount and silently refuses to render if unauthorized.

---

## 2. Panel Layout

### Dimensions

```
┌──────────────────────────────────────┐
│             VIEWPORT                 │
│                                      │
│                         ┌──────────┐ │
│                         │  PANEL   │ │
│                         │  360px   │ │
│                         │          │ │
│                         │  max-h:  │ │
│                         │  85vh    │ │
│                         │          │ │
│                         │          │ │
│                         └──────────┘ │
│                         16px margin  │
│                                      │
└──────────────────────────────────────┘
```

- **Width**: 360px fixed
- **Max height**: 85vh (scrollable content area)
- **Position**: fixed, right: 16px, bottom: 16px
- **Z-index**: `--z-modal` (1050) — above everything except toasts
- **Border radius**: `--radius-xl` (2x base)

### Glass Material

The panel uses the frosted glass material from `materials.css`:

```
background: var(--material-glass)
backdrop-filter: blur(var(--blur-lg))    /* 12px */
border: 1px solid var(--material-glass-border)
box-shadow: var(--shadow-xl)
```

### Panel Structure (Open State)

```
┌────────────────────────────────────┐
│ ◀ Colors                    ─  ✕  │  ← Header (breadcrumb + minimize + close)
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Primary         #6366F1    │  │  ← Control area (scrollable)
│  │  [=====●=================]  │  │
│  │  [color canvas]             │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Secondary       #22C55E    │  │
│  │  [=====●=================]  │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Accent          #F59E0B    │  │
│  │  [=====●=================]  │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Background      #FFFFFF    │  │
│  │  [=====●=================]  │  │
│  └──────────────────────────────┘  │
│                                    │
│  → Fine-tune colors...            │  ← Drill-down link to Level 2
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │  ← Footer (dirty indicator + actions)
└────────────────────────────────────┘
```

### Minimized State

When the user clicks the minimize button (─), the panel collapses into a compact floating bar:

```
┌──────────────────────────────────────┐
│             VIEWPORT                 │
│                                      │
│                                      │
│                                      │
│                                      │
│                                      │
│            ┌─────────────────────┐   │
│            │ 🎨 ● [Save] [▲]    │   │  ← Minimize bar
│            └─────────────────────┘   │
│                          16px margin │
└──────────────────────────────────────┘
```

- **Layout**: `[brand icon] [dirty dot] [Save button] [Expand button]`
- **Position**: fixed, right: 16px, bottom: 16px
- **Styling**: same glass material, pill shape (`--radius-full`)
- **Height**: 48px
- The **dirty dot** (●) is a small amber circle visible only when changes are unsaved
- **Save** button is only visible when dirty
- **Expand** (▲) reopens the full panel

---

## 3. State Machine

```
                    ?brandEditor=true
                          │
                          ▼
                    ┌───────────┐
     ╭─── close ───│   OPEN    │──── minimize ────╮
     │              └───────────┘                  │
     │                   ▲                         ▼
     │                   │                  ┌─────────────┐
     │              expand │                │  MINIMIZED  │
     │                   │                  └─────────────┘
     │                   ╰─────── expand ──────────╯
     ▼
┌──────────┐
│  CLOSED  │
└──────────┘
     │
     ╰── removes ?brandEditor from URL
         if dirty: prompt beforeunload
         if clean: silent close
```

### State Transitions

| From | To | Trigger | Animation | Duration |
|---|---|---|---|---|
| Closed → Open | URL has `?brandEditor=true` | `--duration-slow` (300ms) slide-up + fade-in | `--ease-out` |
| Open → Minimized | Click minimize (─) | `--duration-slow` (300ms) scale-down + slide to bar position | `--ease-in-out` |
| Minimized → Open | Click expand (▲) | `--duration-slow` (300ms) scale-up from bar position | `--ease-out` |
| Open → Closed | Click close (✕) | `--duration-normal` (200ms) fade-out + slide-down | `--ease-in` |
| Minimized → Closed | Click close on bar | Same as above | Same |

### Close Behavior

- **If clean** (no unsaved changes): close immediately, remove `?brandEditor=true` from URL
- **If dirty**: show a confirmation dialog ("You have unsaved changes. Discard?")
  - Discard: revert all CSS variables to original values, clear sessionStorage, close
  - Cancel: keep panel open

### beforeunload

When the editor is dirty AND the user navigates away from the SvelteKit app (actual page unload, not SvelteKit navigation):

```javascript
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    // Browser shows native "Leave site?" dialog
  }
});
```

For SvelteKit navigation (route changes within the app), use the `beforeNavigate` hook:

```javascript
beforeNavigate(({ cancel }) => {
  if (isDirty && !confirm('Discard unsaved brand changes?')) {
    cancel();
  }
});
```

---

## 4. Breadcrumb Drill-Down

The panel uses a level-based navigation system. Each level slides in from the right, with a breadcrumb trail for context.

### Levels

```
Level 0 (Home)
├── Level 1: Colors (4 OKLCH pickers)
│   └── Level 2: Fine-tune Colors (token overrides)
├── Level 1: Typography (font dropdowns)
│   └── Level 2: Fine-tune Typography (scale + weights)
├── Level 1: Shape & Spacing (radius + density sliders)
├── Level 1: Shadows (intensity + tint)
└── Level 1: Logo (upload + preview)
```

### Level 0 — Home

```
┌────────────────────────────────────┐
│ Brand Editor                ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🎨  Colors                 → │  │
│  │ Primary, secondary, accent   │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Aa  Typography             → │  │
│  │ Font families and scale      │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ⬡  Shape & Spacing         → │  │
│  │ Radius and density           │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ◐  Shadows                 → │  │
│  │ Depth and tint               │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ◻  Logo                    → │  │
│  │ Upload and positioning       │  │
│  └──────────────────────────────┘  │
│                                    │
│  ─── Presets ────────────────────  │
│  [Minimal] [Vibrant] [Corp] [Dark] │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

Each category card is a clickable row that navigates to Level 1.

### Presets

Four built-in presets. Clicking a preset applies ALL its values instantly:

| Preset | Primary | Accent | Radius | Density | Font Body | Font Heading |
|---|---|---|---|---|---|---|
| **Minimal** | `#171717` | `#737373` | `0rem` (sharp) | `1` | Inter | Inter |
| **Vibrant** | `#6366F1` | `#F59E0B` | `0.75rem` (playful) | `1` | Poppins | Poppins |
| **Corporate** | `#1E40AF` | `#047857` | `0.25rem` (tight) | `0.9` | Source Sans 3 | Source Sans 3 |
| **Dark** | `#A78BFA` | `#F472B6` | `0.5rem` (balanced) | `1` | DM Sans | DM Sans |

Clicking a preset:
1. Updates all store values
2. Immediately injects new CSS variables
3. Marks state as dirty
4. The page re-renders with the new brand instantly

### Navigation Animation

When drilling from Level 0 → Level 1:
- Current view slides **left** and fades out
- New view slides in from the **right** and fades in
- Duration: `--duration-slow` (300ms)
- Easing: `--ease-out`

When going back (Level 1 → Level 0):
- Current view slides **right** and fades out
- Previous view slides in from the **left** and fades in
- Same duration and easing

The header breadcrumb updates: `Brand Editor` → `◀ Colors` (with back arrow).

---

## 5. Level 1 — Colors

```
┌────────────────────────────────────┐
│ ◀ Colors                    ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  Primary                           │
│  ┌─────────────────────┬────────┐  │
│  │ [canvas area]       │ #6366  │  │
│  │ (saturation/light)  │  F1   │  │
│  │                     │ [swa] │  │
│  ├─────────────────────┴────────┤  │
│  │ [========●================]  │  │  ← Hue slider (0-360°)
│  └──────────────────────────────┘  │
│                                    │
│  Secondary                         │
│  ┌──────────┐ #22C55E             │
│  │ [swatch] │ [========●======]   │  │  ← Compact picker (swatch + hue)
│  └──────────┘                      │
│                                    │
│  Accent                            │
│  ┌──────────┐ #F59E0B             │
│  │ [swatch] │ [========●======]   │  │
│  └──────────┘                      │
│                                    │
│  Background                        │
│  ┌──────────┐ #FFFFFF  [clear]    │
│  │ [swatch] │ [========●======]   │  │
│  └──────────┘                      │
│                                    │
│  → Fine-tune colors...            │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

**Primary** gets the full OKLCH picker (canvas + hue slider + hex input) because it's the most important color and admins need fine-grained control.

**Secondary, Accent, Background** get compact pickers (swatch + hue slider + hex input) to save space. Clicking the swatch opens the full canvas picker in a popover.

The **Background** field has a "clear" link that resets it to null (uses default theme background).

---

## 6. OKLCH Color Picker

The custom color picker operates in the OKLCH color space for perceptually uniform color selection.

### Layout

```
┌─────────────────────────┬──────────┐
│                         │          │
│   [Canvas Area]         │  Hex     │
│   256 × 160px           │  input   │
│                         │          │
│   X-axis: Chroma (C)    │  #6366F1 │
│   Y-axis: Lightness (L) │          │
│                         │  [swatches]
│         ●               │  ○ ○ ○ ○ │
│   (draggable thumb)     │  ○ ○ ○ ○ │
│                         │          │
├─────────────────────────┴──────────┤
│ [================●===============] │  ← Hue slider (0-360°)
└────────────────────────────────────┘
```

### Canvas Area

- **Rendered**: on a `<canvas>` element using `CanvasRenderingContext2D`
- **Size**: 256 × 160 CSS pixels (512 × 320 device pixels on 2x displays)
- **X-axis**: Chroma from 0 (left, gray) to max chroma (right, most saturated)
- **Y-axis**: Lightness from 1 (top, white) to 0 (bottom, black)
- **Hue**: fixed (set by the hue slider), determines the canvas gradient
- **Rendering**: For each pixel, compute `oklch(L, C, H)` and convert to sRGB. Pixels outside the sRGB gamut render as a subtle checkerboard pattern
- **Performance**: Re-render canvas only when hue changes. Use `requestAnimationFrame` for smooth thumb tracking during drag
- **Thumb**: 12px circle with white border (2px) and drop shadow, positioned at the current L/C coordinates

### Hue Slider

- **Range**: 0° to 360°
- **Visual**: rainbow gradient strip (full hue spectrum at fixed L=0.7, C=0.15)
- **Height**: 12px with rounded ends
- **Thumb**: 16px circle with white border
- **Interaction**: click or drag to set hue. Canvas re-renders on hue change

### Hex Input

- **Format**: 6-character hex with `#` prefix
- **Validation**: On blur or Enter, parse hex → OKLCH, update canvas + hue slider
- **Invalid input**: red border, don't update until valid
- **Sync**: When canvas/hue updates, hex input updates in real time

### Swatch Row

- 8 preset swatches: common brand colors (2 rows of 4)
- Clicking a swatch sets the full OKLCH state from that color
- Active swatch has a ring indicator

### Mouse/Touch Interaction

**Canvas drag**:
1. `pointerdown` on canvas → capture pointer, update L/C from position
2. `pointermove` while captured → update L/C continuously
3. `pointerup` → release capture
4. Clamp to canvas bounds

**Hue slider drag**: Same pattern, but only X-axis maps to hue degree.

**Touch**: Use `touch-action: none` on canvas and slider to prevent scroll during drag.

---

## 7. Level 1 — Typography

```
┌────────────────────────────────────┐
│ ◀ Typography                ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  Body Font                         │
│  ┌──────────────────────────────┐  │
│  │ Inter                      ▼ │  │  ← Select dropdown
│  └──────────────────────────────┘  │
│                                    │
│  Preview: The quick brown fox...   │  ← Live text sample
│                                    │
│  Heading Font                      │
│  ┌──────────────────────────────┐  │
│  │ Inter                      ▼ │  │
│  └──────────────────────────────┘  │
│                                    │
│  Preview:                          │
│  Heading Sample                    │  ← Live heading sample
│                                    │
│  → Fine-tune typography...        │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

Font previews render using the currently selected font family. Google Fonts are loaded dynamically when a font is selected — the URL is constructed and injected as a `<link>` element.

Available fonts: Inter (default), Roboto, Open Sans, Lato, Poppins, Montserrat, Playfair Display, Merriweather, DM Sans, Source Sans 3, Nunito, Raleway.

---

## 8. Level 1 — Shape & Spacing

```
┌────────────────────────────────────┐
│ ◀ Shape & Spacing           ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  Corner Radius                     │
│  Sharp ──────●────────── Playful   │
│  0rem         0.5rem         1rem  │
│                                    │
│  ┌──────────┐  ┌──────────────┐   │
│  │  Button   │  │   Card       │   │  ← Live preview thumbnails
│  │  preview  │  │   preview    │   │
│  └──────────┘  └──────────────┘   │
│                                    │
│  Density                           │
│  Compact ────●─────────── Spacious │
│  0.85         1.0            1.15  │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

- **Radius slider**: 0rem (sharp corners) to 1rem (rounded/playful). Step: 0.05rem
- **Density slider**: 0.85 (compact) to 1.15 (spacious). Step: 0.05
- Both use `<input type="range">` with custom styling
- Preview thumbnails show a mock button and card that update live

---

## 9. Level 1 — Shadows

```
┌────────────────────────────────────┐
│ ◀ Shadows                   ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  Shadow Intensity                  │
│  None ───────●──────────── Strong  │
│  0%          50%             100%  │
│                                    │
│  Shadow Tint                       │
│  ┌──────────┐ #000000             │
│  │ [swatch] │ [=======●=======]   │
│  └──────────┘                      │
│                                    │
│  Preview:                          │
│  ┌──────────────────────────────┐  │
│  │  Card with current shadow    │  │
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

Shadow intensity scales `--shadow-strength`. Shadow tint changes `--shadow-color`.

---

## 10. Level 1 — Logo

```
┌────────────────────────────────────┐
│ ◀ Logo                      ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │         [Logo Preview]       │  │  ← Current logo on brand bg
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
│  [Upload Logo]  [Delete]           │
│                                    │
│  Accepts PNG, SVG, WebP.          │
│  Max 2MB. Recommended: 400×100px. │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

Logo upload uses the existing `LogoUpload` component from studio. The preview area shows the logo on a surface matching the current brand background color.

---

## 11. Level 2 — Fine-tune Colors

```
┌────────────────────────────────────┐
│ ◀ Fine-tune Colors          ─  ✕   │
├────────────────────────────────────┤
│                                    │
│  Interactive                       │
│  Default  [=====●====] Hover      │
│  #6366F1               #4F46E5    │
│  [Auto] [Reset]                   │
│                                    │
│  Focus Ring                        │
│  Ring     [=====●====] Border     │
│  #C4B5FD               #6366F1    │
│  [Auto] [Reset]                   │
│                                    │
│  Text on Brand                     │
│  #FFFFFF  [Auto ✓]                │
│                                    │
│  Surfaces                          │
│  Background  [========●=====]     │
│  #FFFFFF                           │
│  Surface     [========●=====]     │
│  #FFFFFF                           │
│  [Auto] [Reset]                   │
│                                    │
├────────────────────────────────────┤
│  ● Unsaved       [Save]  [Reset]  │
└────────────────────────────────────┘
```

Fine-tune pages expose individual token overrides. Each token shows:
- Current resolved value (computed from the primary color by default)
- A slider or compact picker to override
- **[Auto]** button: removes the override, reverts to OKLCH-derived value
- **[Reset]** button: reverts to the saved server value

---

## 12. Live Preview Mechanism

The editor does NOT use component props to inject branding. Instead, it sets CSS custom properties directly on the org layout DOM element:

```javascript
function injectBrandVars(values: BrandEditorState) {
  const el = document.querySelector('.org-layout');
  if (!el) return;

  // Set the raw input variables that org-brand.css derives from
  el.style.setProperty('--brand-color', values.primaryColor);
  el.style.setProperty('--brand-secondary', values.secondaryColor);
  el.style.setProperty('--brand-accent', values.accentColor);
  el.style.setProperty('--brand-bg', values.backgroundColor);
  el.style.setProperty('--brand-radius', `${values.radius}rem`);
  el.style.setProperty('--brand-density', String(values.density));

  // Ensure the brand attribute is set so CSS rules activate
  if (!el.hasAttribute('data-org-brand')) {
    el.setAttribute('data-org-brand', '');
  }
}
```

This works because `org-brand.css` already derives the full palette (interactive, focus, text-on-brand, etc.) from these input variables using OKLCH relative colors. The browser recomputes all derived tokens instantly.

Font injection requires loading the font first:
```javascript
function injectFont(family: string) {
  const id = `brand-font-${family.replace(/\s/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}
```

### Theme Toggle

The editor includes a light/dark theme toggle button in the header. This:
1. On open: captures the current `data-theme` attribute value
2. On toggle: switches between `'light'` and `'dark'` on `document.documentElement`
3. On close: reverts to the captured original theme

This lets admins preview their brand in both themes without permanently changing the site theme.

---

## 13. Store Architecture

The brand editor store uses Svelte 5 runes with sessionStorage persistence:

```typescript
interface BrandEditorState {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  fontBody: string;
  fontHeading: string;
  radius: number;         // 0 to 1 (rem)
  density: number;        // 0.85 to 1.15
  // Level 2 overrides (null = auto-derive from primary)
  tokenOverrides: Record<string, string | null>;
}
```

**Lifecycle**:
1. **Open**: Load saved branding from server data → initialize store → inject CSS vars
2. **Edit**: Each change updates store → injects CSS vars → page re-renders
3. **Minimize**: Store persists in memory + sessionStorage
4. **Close (clean)**: Clear store, remove injected CSS vars
5. **Close (dirty + discard)**: Revert to original server values, clear sessionStorage
6. **Save**: POST to branding API → invalidate cache → toast success → mark clean

**sessionStorage key**: `codex:brand-editor:{orgId}`

On page reload, if sessionStorage has unsaved state for this org, auto-open the editor and restore it.

---

## 14. Save Flow

1. User clicks **[Save]** in the footer
2. Build the update payload from current store state
3. `POST /api/org/{orgId}/settings/branding` with the payload
4. On success:
   - `invalidateAll()` to refresh server data
   - Toast: "Brand updated" (success)
   - Mark store as clean (clear dirty flag)
   - Clear sessionStorage
5. On error:
   - Toast: "Failed to save brand" (error)
   - Keep store dirty, don't clear sessionStorage

---

## 15. Mobile Adaptation

Below 640px viewport width:

```
┌──────────────────────────────────┐
│           VIEWPORT               │
│                                  │
│       (page content)             │
│                                  │
│                                  │
├──────────────────────────────────┤
│  ◀ Colors               ─  ✕    │  ← Full-width sheet
│                                  │
│  Primary         #6366F1         │
│  [canvas area]                   │
│  [hue slider]                    │
│                                  │
│  Secondary       #22C55E         │
│  [swatch] [hue slider]          │
│                                  │
│  ● Unsaved    [Save] [Reset]    │
└──────────────────────────────────┘
```

- **Width**: 100% (full viewport width)
- **Position**: fixed bottom sheet
- **Max height**: 70vh
- **Border radius**: `--radius-xl` on top corners only
- **Slide-up animation**: from bottom edge
- **Drag handle**: 4px × 40px centered bar at top for touch dismiss

The minimized state on mobile is the same compact bar, centered at the bottom.

---

## 16. Accessibility

- **Focus trap**: When panel is open, Tab cycles through panel controls only (not underlying page)
- **Escape**: Closes panel (with dirty check)
- **aria-label**: "Brand editor" on the panel root
- **role="dialog"**: on the panel container
- **Color picker canvas**: `role="application"` with `aria-label="Color selection area"`. Arrow keys move the thumb: Left/Right adjust Chroma, Up/Down adjust Lightness
- **Sliders**: All use `<input type="range">` with proper `aria-label` and `aria-valuetext`
- **Announcements**: When saving, use `aria-live="polite"` region for "Brand saved" / "Save failed"

---

## 17. Animation Reference

All animations use tokens from `motion.css`:

| Animation | Duration Token | Easing Token | CSS Property |
|---|---|---|---|
| Panel open | `--duration-slow` (300ms) | `--ease-out` | transform, opacity |
| Panel close | `--duration-normal` (200ms) | `--ease-in` | transform, opacity |
| Minimize | `--duration-slow` (300ms) | `--ease-in-out` | transform, width, height |
| Expand from minimize | `--duration-slow` (300ms) | `--ease-out` | transform, width, height |
| Level drill-down (forward) | `--duration-slow` (300ms) | `--ease-out` | transform (translateX), opacity |
| Level drill-back | `--duration-slow` (300ms) | `--ease-out` | transform (translateX), opacity |
| Canvas thumb tracking | `requestAnimationFrame` | N/A | left, top (no transition) |
| Color swatch click | `--duration-fast` (100ms) | `--ease-default` | ring opacity |
| Dirty dot appear | `--duration-normal` (200ms) | `--ease-bounce` | scale |

All animations respect `prefers-reduced-motion: reduce` via the global rule in motion.css that sets all durations to 0.01ms.
