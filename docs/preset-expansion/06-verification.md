# WP-06: Full Verification Pass

## Goal

Verify all 25 presets end-to-end: apply, check visual result (shader, hero, cards, pricing, player), toggle dark mode, save, reload, switch between presets.

## Depends On

- All other WPs (01-05) must be complete

---

## Instructions

This is a verification-only WP. No code changes.

### Test Matrix

For each of the 25 presets, verify:

| Check | What to look for |
|---|---|
| Shader | Correct shader activates on hero (or none for Minimal/Paper/Mono) |
| Hero text | Hero title, description, pills, stats use correct colours |
| Hero blend | Title blend mode matches (adaptive vs normal) |
| Hero CTAs | Browse Content and glass CTA buttons use correct colours |
| Hero layout | Correct layout variant (default vs centered) |
| Cards | Hover scale matches preset value (subtle vs dramatic) |
| Labels | Text-transform matches (uppercase / capitalize / none) |
| Glass | Pricing page glass tint matches preset colour |
| Headings | h1-h6 use heading-color if set |
| Player | Player controls use player-text colour if set |
| Dark mode | Toggle dark → verify darkOverrides apply (bg + primary shift) |
| Fonts | Google Fonts load without FOUT |

### Quick Test Sequence (per preset)

1. Apply preset in brand editor
2. Check hero section (scroll to top) — shader + text + CTAs + layout
3. Scroll to content cards — hover one, check scale + badge labels
4. Navigate to `/pricing` — check glass tint on tier cards
5. Toggle dark mode — check dark overrides apply
6. Toggle back to light

### Clean Switching Tests

1. Apply "Neon" (max tokens: shader, cyan player, green glass, aggressive hover)
2. Apply "Zen" (minimal: rain shader, sage, gentle hover, no text-transform)
3. Verify: ALL Neon tokens are gone — no cyan leaking, no aggressive hover
4. Apply "Minimal" (no shader, no hover, no text-transform)
5. Verify: shader disappears entirely, cards don't lift, labels are sentence case

### Save + Reload Tests

1. Apply "Onyx" preset
2. Click Save
3. Hard refresh (Cmd+Shift+R)
4. Verify: page loads with Onyx styling — bismuth shader, gold glass, dark bg
5. Re-open brand editor → verify saved state matches Onyx
6. Apply "Mono" → Save → Refresh → Verify: black/white, no shader

### Edge Cases

1. Apply preset → make a manual token override (e.g., change hero-text to red)
2. Apply a different preset → verify: manual override is cleared
3. Apply preset → Discard (don't save) → verify: reverts to previously saved state
4. Apply preset with dark bg → verify text auto-contrast works (white text on dark)
5. Apply preset without bg → verify default theme surface colours unchanged

---

## Verification Checklist

### Professional (3)
- [ ] Corporate: topo shader, blue CTA, subtle hover, uppercase
- [ ] Executive: silk shader, gold CTA, gold glass, uppercase
- [ ] Consulting: clouds shader, teal CTA, capitalize

### Creative (3)
- [ ] Vibrant: glow shader, pink glass, dramatic hover, no text-transform, centered
- [ ] Sunset: nebula shader, amber glass, capitalize
- [ ] Ocean: caustic shader, aqua glass

### Bold (3)
- [ ] Dark: ether shader, indigo headings/title, centered, dark overrides
- [ ] Neon: flux shader, cyan title/player, green glass, aggressive hover, dark overrides
- [ ] Ember: lava shader, red headings, orange glass

### Minimal (3)
- [ ] Minimal: NO shader, NO hover, no text-transform
- [ ] Paper: NO shader, warm gray glass, capitalize
- [ ] Mono: NO shader, black title/headings/CTA, uppercase, dark overrides

### Organic (3)
- [ ] Forest: growth shader, green glass, capitalize
- [ ] Desert: waves shader, terracotta glass, warm bg
- [ ] Bloom: pollen shader, pink glass, centered, no text-transform

### Tech (3)
- [ ] Terminal: spore shader, green everything, monospace, black bg, uppercase
- [ ] Blueprint: gyroid shader, blue bg, blue CTA, uppercase
- [ ] Gradient: flow shader, purple heading, cyan glass, centered, dramatic hover

### Luxury (3)
- [ ] Onyx: bismuth shader, gold everything, near-black bg, centered, uppercase
- [ ] Marble: pearl shader, off-white bg, charcoal, capitalize
- [ ] Velvet: silk shader, deep purple bg, lavender headings, centered

### Playful (3)
- [ ] Bubblegum: glow shader, bouncy radius, Fredoka, no text-transform, centered
- [ ] Retro: film shader, cream bg, Archivo Black, orange glass, uppercase
- [ ] Arcade: plasma shader, lime glass, blue title, dark bg, aggressive hover

### Atmospheric (3)
- [ ] Midnight: aurora shader, deep blue bg, silver, centered, capitalize
- [ ] Storm: vortex shader, gray bg, lightning blue title, dramatic hover, uppercase
- [ ] Zen: rain shader, warm white bg, sage, Lora serif, minimal hover, no text-transform
