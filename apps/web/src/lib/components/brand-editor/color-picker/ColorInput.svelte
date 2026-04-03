<script lang="ts">
  interface Props {
    /** Current hex color value (e.g., "#6366F1"). */
    value?: string;
    /** Called when a valid hex color is entered. */
    onchange?: (hex: string) => void;
  }

  const {
    value = $bindable('#000000'),
    onchange,
  }: Props = $props();

  let inputValue = $state(value);
  let isValid = $state(true);

  // Sync external value changes to input
  $effect(() => {
    inputValue = value;
    isValid = true;
  });

  const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

  function normalize(raw: string): string {
    let cleaned = raw.trim().replace(/\s/g, '');
    if (!cleaned.startsWith('#')) cleaned = `#${cleaned}`;
    return cleaned.toUpperCase();
  }

  function apply() {
    const normalized = normalize(inputValue);
    if (HEX_REGEX.test(normalized)) {
      isValid = true;
      inputValue = normalized;
      value = normalized;
      onchange?.(normalized);
    } else {
      isValid = false;
    }
  }

  function handleInput(e: Event) {
    inputValue = (e.target as HTMLInputElement).value;
    // Live validation feedback
    const normalized = normalize(inputValue);
    isValid = inputValue.length < 4 || HEX_REGEX.test(normalized);
  }

  function handleBlur() {
    apply();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      apply();
      (e.target as HTMLInputElement).blur();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text') ?? '';
    inputValue = normalize(text);
    apply();
  }
</script>

<div class="color-input" class:color-input--invalid={!isValid}>
  <div class="color-input__swatch" style="background-color: {value}"></div>
  <input
    type="text"
    class="color-input__field"
    value={inputValue}
    oninput={handleInput}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    onpaste={handlePaste}
    maxlength="7"
    spellcheck="false"
    autocomplete="off"
    aria-label="Hex color value"
    aria-invalid={!isValid}
  />
</div>

<style>
  .color-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface);
    transition: var(--transition-colors);
  }

  .color-input:focus-within {
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-focus-ring);
  }

  .color-input--invalid {
    border-color: var(--color-error);
  }

  .color-input--invalid:focus-within {
    box-shadow: var(--shadow-focus-ring-error);
  }

  .color-input__swatch {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  .color-input__field {
    border: none;
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    width: 100%;
    outline: none;
    padding: var(--space-1) 0;
  }
</style>
