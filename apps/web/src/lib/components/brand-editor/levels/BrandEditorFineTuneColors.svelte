<!--
  @component BrandEditorFineTuneColors
  Level 2 — Per-token color overrides with auto-derive reset.
  Depends on tokenOverrides DB column (Codex-r7il, now complete).
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { srgbToHex } from '$lib/brand-editor/oklch-math';
  import OklchColorPicker from '../color-picker/OklchColorPicker.svelte';
  import BrandSliderField from '../BrandSliderField.svelte';
  import * as m from '$paraglide/messages';

  interface TokenDef {
    key: string;
    name: string;
    auto: string;
    defaultSeed?: string;
    brandPrefix?: boolean;
    blendControl?: boolean;
    linkedKey?: string;
    linkedValue?: string;
    inputType?: 'color' | 'slider' | 'select';
    sliderConfig?: { min: number; max: number; step: number; unit?: string };
    selectOptions?: { value: string; label: string }[];
  }

  const TOKEN_GROUPS: { label: string; description: string; tokens: TokenDef[] }[] = [
    {
      label: 'Surfaces',
      description: 'Background colors for cards and containers',
      tokens: [
        { key: 'surface-card', name: 'Card Background', auto: 'Lifted from page background (+5% lighter)' },
        { key: 'surface-secondary', name: 'Thumbnail Area', auto: 'Recessed from page background (−3% darker)' },
        { key: 'surface-tertiary', name: 'Code Blocks', auto: 'Deeply recessed containers (−6% darker)' },
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
        { key: 'heading-color', name: 'Heading Color', auto: 'Matches body text by default', brandPrefix: true },
      ],
    },
    {
      label: 'Hero',
      description: 'Colors for the hero section over the shader background',
      tokens: [
        { key: 'hero-title-color', name: 'Title', auto: 'White with adaptive blend (inverts against shader)', defaultSeed: '#ffffff', brandPrefix: true, blendControl: true, linkedKey: 'hero-title-blend', linkedValue: 'normal' },
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
        { key: 'card-hover-scale', name: 'Hover Scale', auto: 'How much cards lift on hover (1.0 = none, 1.06 = dramatic)', brandPrefix: true, inputType: 'slider', sliderConfig: { min: 1.0, max: 1.06, step: 0.005, unit: 'x' } },
        { key: 'card-image-hover-scale', name: 'Image Zoom', auto: 'How much card images zoom on hover', brandPrefix: true, inputType: 'slider', sliderConfig: { min: 1.0, max: 1.15, step: 0.01, unit: 'x' } },
      ],
    },
    {
      label: 'Typography Style',
      description: 'Label text casing',
      tokens: [
        { key: 'text-transform-label', name: 'Label Case', auto: 'Uppercase for badges, nav labels, stat labels', brandPrefix: true, inputType: 'select', selectOptions: [{ value: '', label: 'Default (UPPERCASE)' }, { value: 'capitalize', label: 'Title Case' }, { value: 'none', label: 'Sentence case' }] },
      ],
    },
  ];

  let expandedGroup = $state<string | null>(null);

  function getOverride(key: string): string | null {
    const overrides = brandEditor.pending?.tokenOverrides ?? {};
    return overrides[key] ?? null;
  }

  function setOverride(key: string, hex: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    current[key] = hex;
    brandEditor.updateField('tokenOverrides', current);
  }

  function findTokenDef(key: string): TokenDef | undefined {
    for (const group of TOKEN_GROUPS) {
      const found = group.tokens.find((t) => t.key === key);
      if (found) return found;
    }
    return undefined;
  }

  function clearOverride(key: string) {
    const token = findTokenDef(key);
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    delete current[key];
    if (token?.linkedKey) {
      delete current[token.linkedKey];
    }
    brandEditor.updateField('tokenOverrides', current);
  }

  /** Read the resolved color for a CSS custom property from the org layout element.
   *  Uses a canvas to convert any CSS color format (rgb, oklch, etc.) to hex. */
  function readComputedColor(key: string): string | null {
    const orgLayout = document.querySelector('.org-layout');
    if (!orgLayout) return null;

    const token = findTokenDef(key);
    const prefix = token?.brandPrefix ? '--brand-' : '--color-';
    const probe = document.createElement('div');
    probe.style.color = `var(${prefix}${key})`;
    orgLayout.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    if (!computed || computed === 'none') return null;

    // Try rgb() match first (fastest path)
    const rgbMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) return srgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]);

    // Fallback: use canvas to convert any CSS color (oklch, lab, etc.) to RGB
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return srgbToHex(r, g, b);
    } catch {
      return null;
    }
  }

  /** Switch a token from auto to custom: read current computed color as starting value. */
  function enableCustomize(key: string) {
    const token = findTokenDef(key);
    const hex = readComputedColor(key);
    if (hex) {
      setOverride(key, hex);
    } else if (token?.defaultSeed) {
      setOverride(key, token.defaultSeed);
    }
    if (token?.linkedKey && token?.linkedValue) {
      const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
      current[token.linkedKey] = token.linkedValue;
      brandEditor.updateField('tokenOverrides', current);
    }
  }
</script>

<div class="fine-tune">
  {#each TOKEN_GROUPS as group}
    {@const isExpanded = expandedGroup === group.label}
    {@const overrideCount = group.tokens.filter((t) => getOverride(t.key) != null).length}
    <section class="fine-tune__group">
      <button
        class="fine-tune__group-header"
        class:fine-tune__group-header--expanded={isExpanded}
        onclick={() => { expandedGroup = isExpanded ? null : group.label; }}
      >
        <h3 class="fine-tune__group-label">{group.label}</h3>
        {#if overrideCount > 0}
          <span class="fine-tune__group-badge">{overrideCount}</span>
        {/if}
        <span class="fine-tune__group-count">{group.tokens.length}</span>
        <span class="fine-tune__group-chevron" class:fine-tune__group-chevron--open={isExpanded}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </button>

      {#if isExpanded}
        <div class="fine-tune__group-body">
          {#if group.description}
            <p class="fine-tune__group-desc">{group.description}</p>
          {/if}

          {#each group.tokens as token}
            {@const override = getOverride(token.key)}

            {#if token.inputType === 'slider' && token.sliderConfig}
              {@const current = parseFloat(override ?? String(token.sliderConfig.min === 1 ? 1.02 : token.sliderConfig.min))}
              <div class="fine-tune__token">
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
                    const numVal = parseFloat(v);
                    if (numVal === 1 || numVal <= token.sliderConfig!.min) {
                      clearOverride(token.key);
                    } else {
                      setOverride(token.key, v);
                    }
                  }}
                />
                {#if override}
                  <button class="fine-tune__auto-btn fine-tune__auto-btn--small" onclick={() => clearOverride(token.key)}>
                    Reset
                  </button>
                {/if}
              </div>

            {:else if token.inputType === 'select' && token.selectOptions}
              <div class="fine-tune__token">
                <div class="fine-tune__token-header">
                  <span class="fine-tune__token-name">{token.name}</span>
                </div>
                <select
                  class="fine-tune__select"
                  value={override ?? ''}
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
              </div>

            {:else if token.blendControl}
              {@const blendMode = getOverride('hero-title-blend')}
              {@const titleColor = getOverride('hero-title-color')}
              <div class="fine-tune__token">
                <div class="fine-tune__token-header">
                  <span class="fine-tune__token-name">{token.name}</span>
                </div>
                <p class="fine-tune__auto-hint">{token.auto}</p>
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
                    class:fine-tune__blend-option--active={!!titleColor && titleColor !== '#ffffff'}
                    onclick={() => { setOverride('hero-title-color', titleColor && titleColor !== '#ffffff' ? titleColor : '#1a1a2e'); setOverride('hero-title-blend', 'normal'); }}
                  >Custom</button>
                </div>
                {#if titleColor && titleColor !== '#ffffff'}
                  <OklchColorPicker value={titleColor} onchange={(hex) => setOverride('hero-title-color', hex)} />
                {/if}
              </div>

            {:else}
              <div class="fine-tune__token">
                <div class="fine-tune__token-header">
                  <span class="fine-tune__token-name">{token.name}</span>
                  {#if override}
                    <button class="fine-tune__auto-btn" onclick={() => clearOverride(token.key)}>
                      {m.brand_editor_auto()}
                    </button>
                  {:else}
                    <button class="fine-tune__customize-btn" onclick={() => enableCustomize(token.key)}>
                      {m.brand_editor_customize()}
                    </button>
                  {/if}
                </div>

                {#if override}
                  <OklchColorPicker value={override} onchange={(hex) => setOverride(token.key, hex)} />
                {:else}
                  <p class="fine-tune__auto-hint">{token.auto}</p>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .fine-tune {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .fine-tune__group {
    display: flex;
    flex-direction: column;
  }

  .fine-tune__group-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) 0;
    background: none;
    border: none;
    cursor: pointer;
    border-bottom: var(--border-width) solid var(--color-border-subtle);
    transition: var(--transition-colors);
  }

  .fine-tune__group-header:hover {
    border-color: var(--color-border);
  }

  .fine-tune__group-header--expanded {
    border-color: var(--color-interactive);
  }

  .fine-tune__group-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .fine-tune__group-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .fine-tune__group-badge {
    font-size: calc(var(--text-xs) * 0.8);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border-radius: var(--radius-full);
    padding: 0 var(--space-1-5);
    min-width: var(--space-4);
    text-align: center;
    line-height: var(--leading-snug);
  }

  .fine-tune__group-chevron {
    color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-default);
    display: flex;
  }

  .fine-tune__group-chevron--open {
    transform: rotate(180deg);
  }

  .fine-tune__group-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .fine-tune__group-desc {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin: calc(-1 * var(--space-1)) 0 0 0;
  }

  .fine-tune__token {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .fine-tune__token-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .fine-tune__token-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .fine-tune__auto-btn {
    font-size: var(--text-xs);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .fine-tune__auto-btn:hover {
    background: var(--color-interactive-subtle);
  }

  .fine-tune__auto-btn--small {
    font-size: var(--text-xs);
    padding: 0;
    margin-top: calc(-1 * var(--space-1));
  }

  .fine-tune__customize-btn {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .fine-tune__customize-btn:hover {
    color: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  .fine-tune__auto-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .fine-tune__blend-options {
    display: flex;
    gap: var(--space-1);
    border-radius: var(--radius-md);
    overflow: hidden;
    border: var(--border-width) solid var(--color-border);
  }

  .fine-tune__blend-option {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .fine-tune__blend-option:hover {
    background: var(--color-surface-secondary);
  }

  .fine-tune__blend-option--active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .fine-tune__select {
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .fine-tune__select:hover {
    border-color: var(--color-border-hover);
  }

  .fine-tune__select:focus {
    outline: none;
    border-color: var(--color-focus);
    box-shadow: 0 0 0 var(--space-0-5) var(--color-focus-ring);
  }
</style>
