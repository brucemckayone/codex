<script lang="ts">
  interface Props {
    /** Current hex color value (e.g., "#6366F1"). */
    value?: string;
    /** Called when a valid hex color is entered. */
    onchange?: (hex: string) => void;
    /** Optional class forwarded to root — composition seam per R13 inverse. */
    class?: string;
  }

  let {
    value = $bindable('#000000'),
    onchange,
    class: className,
  }: Props = $props();

  let inputRef: HTMLInputElement | undefined = $state();
  let inputValue = $state(value);
  let isValid = $state(true);

  // Stable IDs for aria-describedby wiring (05-accessibility.md §7 forms).
  const inputId = $props.id();
  const errorId = `${inputId}-error`;

  // Sync external value changes to input — but only when the user isn't actively typing
  // (fixes $effect race: handleHex → parent → effect → clobber in-progress edit — 3yco7).
  $effect(() => {
    if (typeof document !== 'undefined' && document.activeElement === inputRef) return;
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
    // Live validation feedback.
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

  // Let the browser do its default paste, then run normalise+validate on the resulting
  // value. Previous impl preventDefault'd and committed immediately, trapping the user in
  // an invalid state on accidental paste (4w2vr).
  function handlePaste() {
    // Defer one tick so inputRef.value reflects the pasted content.
    queueMicrotask(() => {
      if (!inputRef) return;
      inputValue = inputRef.value;
      const normalized = normalize(inputValue);
      isValid = inputValue.length < 4 || HEX_REGEX.test(normalized);
    });
  }
</script>

<div class="color-input {className ?? ''}" class:color-input--invalid={!isValid}>
  <div class="color-input__swatch" style="background-color: {value}"></div>
  <input
    bind:this={inputRef}
    id={inputId}
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
    aria-describedby={isValid ? undefined : errorId}
  />
  <!-- Error hint is sr-only — visible state is the red border. aria-describedby announces
       the specific problem to screen readers (wbpqs; 05-accessibility.md §7). -->
  <span id={errorId} class="sr-only" aria-live="polite">
    {#if !isValid}Invalid hex color — must be # followed by 6 hex digits{/if}
  </span>
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
    width: var(--space-5); /* 20px */
    height: var(--space-5);
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
