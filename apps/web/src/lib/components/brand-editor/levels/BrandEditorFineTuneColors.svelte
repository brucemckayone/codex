<!--
  @component BrandEditorFineTuneColors
  Level 2 — Per-token color overrides with auto-derive reset.
  Depends on tokenOverrides DB column (Codex-r7il, now complete).
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { srgbToHex } from '$lib/brand-editor/oklch-math';
  import OklchColorPicker from '../color-picker/OklchColorPicker.svelte';
  import * as m from '$paraglide/messages';

  // Token override entries — each can be null (auto) or a hex string
  const TOKEN_GROUPS = [
    {
      label: 'Interactive',
      tokens: [
        { key: 'interactive', name: 'Default', auto: 'Derived from primary' },
        { key: 'interactive-hover', name: 'Hover', auto: 'Primary - 8% lightness' },
        { key: 'interactive-active', name: 'Active', auto: 'Primary - 15% lightness' },
      ],
    },
    {
      label: 'Focus',
      tokens: [
        { key: 'focus', name: 'Ring Color', auto: 'Same as primary' },
        { key: 'focus-ring', name: 'Ring Glow', auto: 'Primary + 15% lightness' },
      ],
    },
    {
      label: 'Text',
      tokens: [
        { key: 'text-on-brand', name: 'On Brand', auto: 'Auto contrast (black/white)' },
      ],
    },
  ];

  function getOverride(key: string): string | null {
    const overrides = brandEditor.pending?.tokenOverrides ?? {};
    return overrides[key] ?? null;
  }

  function setOverride(key: string, hex: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    current[key] = hex;
    brandEditor.updateField('tokenOverrides', current);
  }

  function clearOverride(key: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    delete current[key];
    brandEditor.updateField('tokenOverrides', current);
  }

  /** Read the resolved color for a CSS custom property from the org layout element.
   *  Uses a canvas to convert any CSS color format (rgb, oklch, etc.) to hex. */
  function readComputedColor(key: string): string | null {
    const orgLayout = document.querySelector('.org-layout');
    if (!orgLayout) return null;

    // Probe element — set its color to the CSS var, read the resolved value
    const probe = document.createElement('div');
    probe.style.color = `var(--color-${key})`;
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
    const hex = readComputedColor(key);
    if (hex) setOverride(key, hex);
  }
</script>

<div class="fine-tune">
  {#each TOKEN_GROUPS as group}
    <section class="fine-tune__group">
      <h3 class="fine-tune__group-label">{group.label}</h3>

      {#each group.tokens as token}
        {@const override = getOverride(token.key)}
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
      {/each}
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
    gap: var(--space-3);
  }

  .fine-tune__group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
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
</style>
