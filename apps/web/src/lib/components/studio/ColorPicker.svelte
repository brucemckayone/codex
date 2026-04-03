<!--
  @component ColorPicker

  Color picker with HTML5 native color input, hex text input, and live preview swatch.
  Bidirectional sync between the color picker and text input.
  Validates hex format: /^#[0-9A-Fa-f]{6}$/

  @prop {string} [value] - Current hex color value (default: '#3B82F6')
  @prop {(color: string) => void} [onchange] - Callback when color changes
-->
<script lang="ts">
  interface Props {
    value?: string;
    onchange?: (color: string) => void;
  }

  let { value = '#3B82F6', onchange }: Props = $props();

  const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

  /**
   * Local text input tracks user edits independently.
   * Cleared on blur or when user submits a valid color, so the parent value
   * takes precedence again on re-render.
   */
  let localText = $state('');
  let isEditing = $state(false);

  /**
   * The displayed text value: use local edit state when user is actively typing,
   * otherwise show the parent-controlled value.
   */
  const textValue = $derived(isEditing ? localText : value);

  /**
   * Validation is derived from the current text value
   */
  const isValid = $derived(HEX_REGEX.test(textValue));

  /**
   * Handle native color picker input
   */
  function handlePickerInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const color = target.value.toUpperCase();
    isEditing = false;
    onchange?.(color);
  }

  /**
   * Handle text input changes with validation
   */
  function handleTextInput(e: Event) {
    const target = e.target as HTMLInputElement;
    let raw = target.value;

    // Ensure # prefix
    if (raw && !raw.startsWith('#')) {
      raw = '#' + raw;
    }

    localText = raw;
    isEditing = true;

    if (HEX_REGEX.test(raw)) {
      onchange?.(raw.toUpperCase());
    }
  }

  /**
   * Normalize on blur: uppercase valid hex values, exit edit mode
   */
  function handleTextBlur() {
    if (isEditing && HEX_REGEX.test(localText)) {
      onchange?.(localText.toUpperCase());
    }
    isEditing = false;
  }
</script>

<div class="color-picker">
  <div class="picker-row">
    <!-- Native color input -->
    <label class="picker-label">
      <input
        type="color"
        class="color-input"
        value={HEX_REGEX.test(textValue) ? textValue : value}
        oninput={handlePickerInput}
      />
      <span class="sr-only">Pick color</span>
    </label>

    <!-- Hex text input -->
    <div class="text-input-wrapper">
      <input
        type="text"
        class="hex-input"
        class:invalid={!isValid}
        value={textValue}
        oninput={handleTextInput}
        onblur={handleTextBlur}
        maxlength="7"
        placeholder="#3B82F6"
        aria-label="Hex color code"
        aria-invalid={!isValid}
      />
      {#if !isValid}
        <span class="validation-hint">Format: #RRGGBB</span>
      {/if}
    </div>

    <!-- Live preview swatch -->
    <div
      class="swatch"
      style="background-color: {HEX_REGEX.test(textValue) ? textValue : value}"
      aria-hidden="true"
    ></div>
  </div>
</div>

<style>
  .color-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .picker-label {
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .color-input {
    width: 40px;
    height: 40px;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    padding: 2px;
    cursor: pointer;
    background: none;
  }

  .color-input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-input::-webkit-color-swatch {
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
  }

  .color-input::-moz-color-swatch {
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
  }

  .text-input-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    max-width: 160px;
  }

  .hex-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    outline: none;
    transition: border-color var(--transition-duration) var(--transition-timing);
  }

  .hex-input:focus {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 1px var(--color-interactive);
  }

  .hex-input.invalid {
    border-color: var(--color-error-500);
  }

  .hex-input.invalid:focus {
    box-shadow: 0 0 0 1px var(--color-error-500);
  }

  .validation-hint {
    font-size: var(--text-xs);
    color: var(--color-error-700);
  }

  .swatch {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
    transition: background-color var(--transition-duration) var(--transition-timing);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Dark mode */
  :global([data-theme='dark']) .color-input {
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .hex-input {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .swatch {
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .validation-hint {
    color: var(--color-error-400);
  }
</style>
