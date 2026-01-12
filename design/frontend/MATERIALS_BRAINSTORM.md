
## 5. Advanced Brand Personality Tokens

To truly capture "any brand," we need to control the *atmosphere* and *feel* of the interface, not just the colors.

### A. Iconography Personality (The "Stroke" Factor)
Icons are a huge part of brand identity. While we can't easily swap entire icon sets (e.g. FontAwesome vs Heroicons) dynamically without bloat, we *can* control how Lucide (or similar SVG lines) renders.

| Token | Description | CSS Property |
|-------|-------------|--------------|
| `--brand-icon-stroke` | Stroke width (1px - 3px) | `stroke-width` in SVGs |
| `--brand-icon-radius` | Corner roundness (round/square) | `stroke-linecap`, `stroke-linejoin` |

```css
svg.icon {
  stroke-width: var(--brand-icon-stroke, 2px);
  stroke-linecap: var(--brand-icon-radius, round);
}
```

### B. Depth & Shadows (The "Vibe" Factor)
Shadows define the "light" of the brand universe.

| Token | Description | Value Examples |
|-------|-------------|----------------|
| `--brand-shadow-color` | The base color of shadows | `#000` (Neutral), `#4f46e5` (Electric Indigo) |
| `--brand-shadow-strength` | Opacity multiplier | `0` (Flat Design), `0.2` (Subtle), `1` (Hard) |

**Colored Shadows**: A "Cyber" brand uses Neon Blue shadows. A "Natural" brand uses Warm Brown shadows.
**Flat Design**: Setting strength to `0` instantly creates a trendy "Neo-Brutalist" or "Flat" look.

### C. Border Personality (The "Structure" Factor)
Borders define the "heaviness" of the UI.

| Token | Description | Value Examples |
|-------|-------------|----------------|
| `--brand-border-width` | Base border thickness | `1px` (Standard), `2px` (Retina), `3px` (Brutalist) |
| `--brand-border-style` | Line style | `solid`, `dashed` (Sketchy), `double` (Retro) |

### D. Motion Energy (The "Speed" Factor)
Brands have a tempo.

| Token | Description | Value Examples |
|-------|-------------|----------------|
| `--brand-motion-scale` | Multiplier for durations | `0.5` (Snappy/Pro Tool), `1` (Balanced), `2.0` (Relaxed/Luxury) |

---

## 6. The "Brand DNA" Configuration Object

All of this boils down to a single JSON configuration that can be stored in the Org settings:

```json
{
  "brand": {
    "colors": { "primary": "#e85a3f", "surface": "#ffffff" },
    "fonts": { "body": "Inter", "heading": "Playfair Display" },
    "shape": { "radius": "0.5rem", "borderWidth": "1px" },
    "texture": { "glass": true, "noise": "paper" },
    "atmosphere": {
      "shadowColor": "#292524",
      "motionSpeed": 1.2
    }
  }
}
```

This ensures we can "rehydrate" the entire design system from a simple, portable config.
