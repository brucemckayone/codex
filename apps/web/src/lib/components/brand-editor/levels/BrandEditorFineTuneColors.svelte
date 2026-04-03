<!--
  @component BrandEditorFineTuneColors
  Level 2 — Per-token color overrides with auto-derive reset.
  Depends on tokenOverrides DB column (Codex-r7il, now complete).
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import ColorInput from '../color-picker/ColorInput.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';

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
                Auto
              </button>
            {:else}
              <span class="fine-tune__auto-tag">Auto</span>
            {/if}
          </div>

          {#if override}
            <ColorInput value={override} onchange={(hex) => setOverride(token.key, hex)} />
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

  .fine-tune__auto-tag {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    padding: var(--space-0-5) var(--space-2);
  }

  .fine-tune__auto-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }
</style>
