# WP-08: Brand Editor Fine-Tune Panel Expansion

## Goal

Expand the fine-tune colors panel from 7 tokens in 4 groups to ~35 tokens across 11 groups. Add accordion UI, hero title blend mode control, non-color inputs (sliders, selects), and `defaultSeed` for tokens that don't exist as CSS vars until overridden.

## Depends On

- ALL other WPs (01-07, 09) — every token must be defined and wired in CSS before the panel can meaningfully control it
- This is the LAST work packet to implement

## Background

The current fine-tune panel (`BrandEditorFineTuneColors.svelte`) uses a simple structure:
- `TOKEN_GROUPS` array defines groups with tokens
- Each token has `key`, `name`, `auto` (description)
- `readComputedColor(key)` probes `var(--color-{key})` to get the auto-derived value
- `enableCustomize(key)` reads the computed color and writes it to `tokenOverrides`
- `clearOverride(key)` deletes the key from `tokenOverrides`

We need to extend this with:
1. **More groups and tokens** (surfaces, text, headings, hero, interactive, borders, focus, player, glass, cards, typography)
2. **`defaultSeed`** for tokens whose CSS vars don't exist until overridden (hero tokens default to `#ffffff`)
3. **`--brand-` prefix detection** in `readComputedColor()` for hero/heading/player tokens
4. **Blend mode segmented control** for hero title
5. **Non-color inputs** — sliders for card scales, select for text-transform
6. **Collapsible accordion groups** to manage the expanded list

---

## Instructions

### Step 1: Extend token type definition

In `BrandEditorFineTuneColors.svelte`, update the token type used in `TOKEN_GROUPS`:

```typescript
interface TokenDef {
  key: string;
  name: string;
  auto: string;
  /** Fallback when readComputedColor returns null (e.g., hero tokens default to white) */
  defaultSeed?: string;
  /** If true, this key uses --brand- prefix instead of --color- */
  brandPrefix?: boolean;
  /** For hero title: render blend mode segmented control instead of simple picker */
  blendControl?: boolean;
  /** Companion key to set/clear alongside this one (e.g., hero-title-blend) */
  linkedKey?: string;
  /** linkedKey value to set when this token is customized */
  linkedValue?: string;
  /** Non-color input type */
  inputType?: 'color' | 'slider' | 'select';
  /** For sliders: min, max, step, unit */
  sliderConfig?: { min: number; max: number; step: number; unit?: string };
  /** For selects: options */
  selectOptions?: { value: string; label: string }[];
}
```

### Step 2: Define all TOKEN_GROUPS

Replace the existing `TOKEN_GROUPS` array with the full set:

```typescript
const TOKEN_GROUPS = [
  {
    label: 'Surfaces',
    description: 'Background colors for cards and containers',
    tokens: [
      { key: 'surface-card', name: 'Card Background', auto: 'Lifted from page background (+5% lighter)' },
      { key: 'surface-secondary', name: 'Thumbnail Area', auto: 'Recessed from page background (−3% darker)' },
      { key: 'surface-tertiary', name: 'Code Blocks', auto: 'Deeply recessed containers (−6% darker)', },
      { key: 'surface-elevated', name: 'Modals & Floating', auto: 'Raised elements (+2% lighter)' },
      { key: 'surface-variant', name: 'Alt Containers', auto: 'Alternative surface for variety (−4% darker)' },
    ],
  },
  {
    label: 'Text',
    description: 'Text colors across the site',
    tokens: [
      { key: 'text', name: 'Body Text', auto: 'Auto-contrast from background (black or white)' },
      { key: 'text-secondary', name: 'Secondary', auto: 'Descriptions, labels — slightly muted' },
      { key: 'text-tertiary', name: 'Tertiary', auto: 'Navigation hints, footer text — more muted' },
      { key: 'text-muted', name: 'Placeholders', auto: 'Input placeholders, subtle hints' },
      { key: 'text-on-brand', name: 'On Brand', auto: 'Auto contrast — black or white based on your primary' },
    ],
  },
  {
    label: 'Headings',
    description: 'Independent heading color (h1-h6)',
    tokens: [
      {
        key: 'heading-color',
        name: 'Heading Color',
        auto: 'Matches body text by default',
        brandPrefix: true,
      },
    ],
  },
  {
    label: 'Hero',
    description: 'Colors for the hero section over the shader background',
    tokens: [
      {
        key: 'hero-title-color',
        name: 'Title',
        auto: 'White with adaptive blend (inverts against shader)',
        defaultSeed: '#ffffff',
        brandPrefix: true,
        blendControl: true,
        linkedKey: 'hero-title-blend',
        linkedValue: 'normal',
      },
      { key: 'hero-text', name: 'Content Text', auto: 'Description, pills, stat numbers', defaultSeed: '#ffffff', brandPrefix: true },
      { key: 'hero-text-muted', name: 'Muted Text', auto: 'Stat labels, category pills', defaultSeed: '#ffffff', brandPrefix: true },
      { key: 'hero-cta-bg', name: 'Primary CTA Bg', auto: 'Browse/Explore button background', defaultSeed: '#ffffff', brandPrefix: true },
      { key: 'hero-cta-text', name: 'Primary CTA Text', auto: 'Browse/Explore button text', defaultSeed: '#1a1a2e', brandPrefix: true },
      { key: 'hero-glass-tint', name: 'Glass CTA Tint', auto: 'Semi-transparent button tint color', defaultSeed: '#ffffff', brandPrefix: true },
      { key: 'hero-glass-text', name: 'Glass CTA Text', auto: 'Library/Meet Creators button text', defaultSeed: '#ffffff', brandPrefix: true },
      { key: 'hero-border-tint', name: 'Dividers', auto: 'Pill borders, stat separator line', defaultSeed: '#ffffff', brandPrefix: true },
    ],
  },
  {
    label: 'Interactive',
    description: 'Buttons, links, and clickable elements',
    tokens: [
      { key: 'interactive', name: 'Default', auto: 'Derived from your primary color' },
      { key: 'interactive-hover', name: 'Hover', auto: 'Shown when hovering buttons and links' },
      { key: 'interactive-active', name: 'Active', auto: 'Shown while pressing a button or link' },
      { key: 'interactive-subtle', name: 'Subtle', auto: 'Ghost/subtle button background tint' },
    ],
  },
  {
    label: 'Borders',
    description: 'Dividers, card edges, input borders',
    tokens: [
      { key: 'border', name: 'Default', auto: 'Card borders, section dividers' },
      { key: 'border-strong', name: 'Strong', auto: 'Emphasized borders, input hover' },
      { key: 'border-subtle', name: 'Subtle', auto: 'Light dividers, secondary borders' },
      { key: 'border-hover', name: 'Hover', auto: 'Input hover state borders' },
    ],
  },
  {
    label: 'Focus',
    description: 'Keyboard navigation outlines',
    tokens: [
      { key: 'focus', name: 'Ring Color', auto: 'Outline around keyboard-focused elements' },
      { key: 'focus-ring', name: 'Ring Glow', auto: 'Soft halo behind the focus ring' },
    ],
  },
  {
    label: 'Player Chrome',
    description: 'Video and audio player controls',
    tokens: [
      { key: 'player-text', name: 'Player Text', auto: 'White controls on dark background', brandPrefix: true, defaultSeed: '#ffffff' },
      { key: 'player-text-secondary', name: 'Secondary', auto: 'Timestamps, secondary labels', brandPrefix: true, defaultSeed: '#cccccc' },
      { key: 'player-surface', name: 'Button Bg', auto: 'Translucent button/track backgrounds', brandPrefix: true, defaultSeed: '#ffffff' },
      { key: 'player-overlay', name: 'Dark Overlay', auto: 'Dark background behind controls', brandPrefix: true, defaultSeed: '#000000' },
    ],
  },
  {
    label: 'Glass & Overlay',
    description: 'Glass morphism tint color',
    tokens: [
      { key: 'glass-tint', name: 'Glass Tint', auto: 'White tint used in glass effects (pricing, hero)', brandPrefix: true, defaultSeed: '#ffffff' },
    ],
  },
  {
    label: 'Content Cards',
    description: 'Card hover interaction scale',
    tokens: [
      {
        key: 'card-hover-scale',
        name: 'Hover Scale',
        auto: 'How much cards lift on hover (1.0 = none, 1.05 = dramatic)',
        brandPrefix: true,
        inputType: 'slider',
        sliderConfig: { min: 1.0, max: 1.06, step: 0.005, unit: 'x' },
      },
      {
        key: 'card-image-hover-scale',
        name: 'Image Zoom',
        auto: 'How much card images zoom on hover',
        brandPrefix: true,
        inputType: 'slider',
        sliderConfig: { min: 1.0, max: 1.15, step: 0.01, unit: 'x' },
      },
    ],
  },
  {
    label: 'Typography Style',
    description: 'Label text casing',
    tokens: [
      {
        key: 'text-transform-label',
        name: 'Label Case',
        auto: 'Uppercase for badges, nav labels, stat labels',
        brandPrefix: true,
        inputType: 'select',
        selectOptions: [
          { value: '', label: 'Default (UPPERCASE)' },
          { value: 'capitalize', label: 'Title Case' },
          { value: 'none', label: 'Sentence case' },
        ],
      },
    ],
  },
];
```

### Step 3: Update readComputedColor for brand-prefix tokens

Modify the `readComputedColor` function to handle `--brand-` prefix tokens:

```typescript
const BRAND_PREFIX_TOKEN_KEYS = new Set([
  'heading-color',
  'hero-text', 'hero-text-muted', 'hero-title-color', 'hero-cta-bg', 'hero-cta-text',
  'hero-glass-tint', 'hero-glass-text', 'hero-border-tint',
  'player-text', 'player-text-secondary', 'player-surface', 'player-overlay',
  'glass-tint',
  'card-hover-scale', 'card-image-hover-scale',
  'text-transform-label',
]);

function readComputedColor(key: string): string | null {
  const orgLayout = document.querySelector('.org-layout');
  if (!orgLayout) return null;

  const prefix = BRAND_PREFIX_TOKEN_KEYS.has(key) ? '--brand-' : '--color-';
  const probe = document.createElement('div');
  probe.style.color = `var(${prefix}${key})`;
  orgLayout.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  // ... rest of existing conversion logic
}
```

### Step 4: Update enableCustomize with defaultSeed

```typescript
function enableCustomize(key: string) {
  const token = findTokenDef(key); // helper to look up the token in TOKEN_GROUPS
  const hex = readComputedColor(key);
  if (hex) {
    setOverride(key, hex);
  } else if (token?.defaultSeed) {
    setOverride(key, token.defaultSeed);
  }
  // Also set linked key if defined
  if (token?.linkedKey && token?.linkedValue) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    current[token.linkedKey] = token.linkedValue;
    brandEditor.updateField('tokenOverrides', current);
  }
}
```

### Step 5: Update clearOverride with linked keys

```typescript
function clearOverride(key: string) {
  const token = findTokenDef(key);
  const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
  delete current[key];
  // Also clear linked key
  if (token?.linkedKey) {
    delete current[token.linkedKey];
  }
  brandEditor.updateField('tokenOverrides', current);
}
```

### Step 6: Add blend mode segmented control

For the hero title token (where `blendControl: true`), render a segmented control instead of the simple Customize/Auto toggle:

```svelte
{#if token.blendControl}
  {@const blendMode = getOverride('hero-title-blend')}
  {@const titleColor = getOverride('hero-title-color')}
  <div class="fine-tune__blend-control">
    <div class="fine-tune__blend-options">
      <button
        class="fine-tune__blend-option"
        class:fine-tune__blend-option--active={!titleColor}
        onclick={() => { clearOverride('hero-title-color'); clearOverride('hero-title-blend'); }}
      >Adaptive</button>
      <button
        class="fine-tune__blend-option"
        class:fine-tune__blend-option--active={titleColor === '#ffffff' && blendMode === 'normal'}
        onclick={() => { setOverride('hero-title-color', '#ffffff'); setOverride('hero-title-blend', 'normal'); }}
      >Light</button>
      <button
        class="fine-tune__blend-option"
        class:fine-tune__blend-option--active={titleColor && titleColor !== '#ffffff' && blendMode === 'normal'}
        onclick={() => { setOverride('hero-title-color', '#1a1a2e'); setOverride('hero-title-blend', 'normal'); }}
      >Dark</button>
    </div>
    {#if titleColor && blendMode === 'normal' && titleColor !== '#ffffff'}
      <OklchColorPicker value={titleColor} onchange={(hex) => setOverride('hero-title-color', hex)} />
    {/if}
  </div>
{/if}
```

Options:
- **Adaptive** (default): clears both `hero-title-color` and `hero-title-blend` → restores `mix-blend-mode: difference`
- **Light**: sets `hero-title-color: #ffffff`, `hero-title-blend: normal` → solid white
- **Dark**: sets `hero-title-color: #1a1a2e`, `hero-title-blend: normal` → dark color with picker

### Step 7: Add non-color input rendering

For tokens with `inputType: 'slider'`:

```svelte
{#if token.inputType === 'slider' && token.sliderConfig}
  {@const current = parseFloat(getOverride(token.key) ?? String(token.sliderConfig.min === 1 ? 1 : token.sliderConfig.min))}
  <BrandSliderField
    id={token.key}
    label={token.name}
    value="{current.toFixed(token.sliderConfig.step < 0.01 ? 3 : 2)}{token.sliderConfig.unit ?? ''}"
    min={token.sliderConfig.min}
    max={token.sliderConfig.max}
    step={token.sliderConfig.step}
    {current}
    oninput={(e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v === '1' || v === String(token.sliderConfig!.min)) {
        clearOverride(token.key);
      } else {
        setOverride(token.key, v);
      }
    }}
  />
{/if}
```

For tokens with `inputType: 'select'`:

```svelte
{#if token.inputType === 'select' && token.selectOptions}
  <select
    class="fine-tune__select"
    value={getOverride(token.key) ?? ''}
    onchange={(e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === '') clearOverride(token.key);
      else setOverride(token.key, v);
    }}
  >
    {#each token.selectOptions as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
{/if}
```

### Step 8: Add collapsible accordion groups

Wrap each group in a collapsible section:

```svelte
{#each TOKEN_GROUPS as group}
  {@const isExpanded = expandedGroup === group.label}
  <section class="fine-tune__group">
    <button
      class="fine-tune__group-header"
      onclick={() => { expandedGroup = isExpanded ? null : group.label; }}
    >
      <h3 class="fine-tune__group-label">{group.label}</h3>
      <span class="fine-tune__group-count">{group.tokens.length}</span>
      <span class="fine-tune__group-chevron">{isExpanded ? '−' : '+'}</span>
    </button>

    {#if isExpanded}
      {#if group.description}
        <p class="fine-tune__group-desc">{group.description}</p>
      {/if}
      {#each group.tokens as token}
        <!-- existing token rendering, extended for new input types -->
      {/each}
    {/if}
  </section>
{/each}
```

State:
```typescript
let expandedGroup = $state<string | null>(null);
```

---

## Verification Steps

### V1: Panel renders all 11 groups

1. Open brand editor → navigate to Colors → Fine-tune colors
2. Verify: 11 group headers visible (Surfaces, Text, Headings, Hero, Interactive, Borders, Focus, Player Chrome, Glass & Overlay, Content Cards, Typography Style)
3. Each header shows token count badge
4. Click each group → verify it expands and collapses correctly

### V2: Color token overrides work

1. Expand "Text" group
2. Click "Customize" on "Body Text"
3. Verify: color picker appears with the current auto-derived text color
4. Change to red (#ff0000)
5. Verify: body text across the page turns red immediately (live preview)
6. Click "Auto" → verify: text reverts to auto-derived color
7. Repeat for at least one token in each color group

### V3: Heading color independence

1. Expand "Headings" group
2. Click "Customize" on "Heading Color"
3. Set to blue (#0000ff)
4. Verify: all h1-h6 headings turn blue, body text stays unchanged
5. Click "Auto" → verify: headings revert to matching body text

### V4: Hero blend mode control

1. Expand "Hero" group
2. Verify: "Title" token shows segmented control (Adaptive / Light / Dark)
3. Click "Adaptive" → verify: title uses mix-blend-mode: difference (dynamic inversion)
4. Click "Light" → verify: title is solid white, no blend mode
5. Click "Dark" → verify: title is dark color, color picker appears
6. Pick a custom dark color → verify: title updates live
7. Click "Adaptive" again → verify: restores blend mode behavior

### V5: Hero text tokens

1. Customize "Content Text" to red
2. Verify: hero description, pill text, stat numbers turn red
3. Customize "Muted Text" to blue
4. Verify: stat labels, category pills turn blue
5. Customize "Primary CTA Bg" to black, "Primary CTA Text" to white
6. Verify: Browse/Explore button is black with white text
7. Reset all → verify: hero returns to all-white default

### V6: Player chrome tokens

1. Expand "Player Chrome" group
2. Customize "Player Text" to yellow
3. Navigate to a video content page → play video
4. Verify: player controls text/icons are yellow
5. Reset → verify: returns to white

### V7: Non-color inputs

1. Expand "Content Cards" group
2. Verify: "Hover Scale" shows a slider (1.0 to 1.06)
3. Drag slider to 1.05
4. Hover a content card on the page → verify: more dramatic lift
5. Reset slider to 1.02 (or default) → verify: returns to normal

6. Expand "Typography Style" group
7. Verify: "Label Case" shows a dropdown (Default/Title Case/Sentence case)
8. Select "Sentence case"
9. Verify: badges, nav labels change from UPPERCASE to sentence case
10. Select "Default" → verify: returns to uppercase

### V8: Glass tint

1. Expand "Glass & Overlay" group
2. Customize "Glass Tint" to red
3. Navigate to pricing page → verify: glass highlights on cards have red tint
4. Go back to hero → verify: glass CTA buttons have red tint
5. Reset → verify: returns to white

### V9: Save and restore

1. Customize several tokens across different groups
2. Click Save
3. Hard refresh the page (Cmd+Shift+R)
4. Re-open brand editor
5. Verify: all customized tokens are restored with their saved values
6. Verify: the page renders with the saved customizations (not auto-derived values)

### V10: Discard

1. Customize several tokens
2. Click Discard (or close editor and confirm discard)
3. Verify: ALL tokens revert to auto-derived values
4. Re-open editor → verify: no stale overrides remain

### V11: No regression in existing tokens

1. The 7 original tokens (surface-card, surface-secondary, interactive, interactive-hover, interactive-active, focus, focus-ring, text-on-brand) must still work exactly as before
2. Customize each → verify: live preview works
3. Save → reload → verify: persisted correctly
