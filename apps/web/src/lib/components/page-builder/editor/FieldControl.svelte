<!--
  @component FieldControl

  One `BlockField`, drawn with the control it declares. Text is written as
  the creator types (blank = the key is removed, exactly as the canvas's
  inline edit commits), so the inspector and inline editing are two views of
  one value: whichever is typed in, the other follows. `mediaBaseUrl` is
  only for `image` fields, which preview the stored image against it. An
  `image` field with `focalLayouts` offers its focal point under it (03 X64),
  live in those layouts; an `action` field is a Button's destination. A
  `choice` presses one of its options, the first being the absent key. A
  `mark` presses one of the kit's marks; pressing the chosen one again takes
  it away (Codex-61zsk.58).
-->
<script lang="ts">
  import Select from '$lib/components/ui/Select/Select.svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import type { BlockField } from '$lib/page-builder/kit';
  import { MARKS, type MarkId } from '$lib/page-builder/kit/model/marks';
  import Mark from '$lib/page-builder/kit/primitives/Mark.svelte';
  import { isImageRef } from '$lib/page-builder/page-images';
  import { safeHref } from '$lib/page-builder/render/safe-href';
  import * as m from '$paraglide/messages';
  import ButtonActionField from './ButtonActionField.svelte';
  import FocalPointField from './FocalPointField.svelte';
  import ImageField from './ImageField.svelte';
  import ItemsField from './ItemsField.svelte';
  import ListField from './ListField.svelte';
  import MediaField from './MediaField.svelte';

  interface Props {
    field: BlockField;
    value: unknown;
    onChange: (value: unknown) => void;
    mediaBaseUrl?: string | null;
    /** The section's resolved layout, for a field that depends on it (a focal point). */
    layout?: string;
    /** The section this field belongs to (a Button never targets itself). */
    sectionId?: string;
    /** `items` only: the entry the layout draws larger, tagged "Leads". */
    leading?: number | null;
  }

  const {
    field,
    value,
    onChange,
    mediaBaseUrl = null,
    layout,
    sectionId = '',
    leading = null,
  }: Props = $props();

  const id = $props.id();
  const text = $derived(typeof value === 'string' ? value : '');
  const nearLimit = $derived(
    field.maxLength !== undefined && text.length >= field.maxLength * 0.9
  );

  /**
   * A link that `safeHref` would collapse to `#` is refused on the page; one
   * with no scheme that is not an anchor or a path would go nowhere useful.
   */
  const linkProblem = $derived.by(() => {
    const href = text.trim();
    if (field.control !== 'url' || !href) return null;
    if (safeHref(href) === '#' && href !== '#') return m.studio_page_editor_url_unsafe();
    if (!/^(https?:\/\/|mailto:|#|\/)/i.test(href)) return m.studio_page_editor_url_incomplete();
    return null;
  });

  function writeText(next: string): void {
    onChange(next.trim() ? next : undefined);
  }

  const options = $derived(field.options ?? []);
  // A value the options don't hold reads as the default, as the block reads it.
  const chosen = $derived(
    options.find((option) => option.value === value)?.value ?? options[0]?.value
  );

  function choose(next: string): void {
    onChange(next === options[0]?.value ? undefined : next);
  }

  // A mark the kit cannot draw reads as none, as the block reads it.
  const isMark = (option: string): option is MarkId => (MARKS as readonly string[]).includes(option);
  const marks = $derived(
    options.filter((option): option is { value: MarkId; label: string } => isMark(option.value))
  );

  function mark(next: string): void {
    onChange(next === value ? undefined : next);
  }
</script>

{#if field.control === 'list'}
  <ListField {field} {value} {onChange} />
{:else if field.control === 'items'}
  <ItemsField {field} {value} {onChange} {mediaBaseUrl} {layout} {leading} />
{:else if field.control === 'media'}
  <MediaField {field} />
{:else if field.control === 'image'}
  <ImageField
    {field}
    {value}
    {onChange}
    {mediaBaseUrl}
    decorative={field.decorative}
  />
  {#if field.focalLayouts && isImageRef(value)}
    <FocalPointField
      image={value}
      {mediaBaseUrl}
      crops={(layout !== undefined && field.focalLayouts[layout]) || []}
      onChange={(next) => onChange(next)}
    />
  {/if}
{:else if field.control === 'action'}
  <ButtonActionField {field} {value} {onChange} {sectionId} />
{:else if field.control === 'toggle'}
  <div class="field field--toggle">
    <span class="field__label" id="{id}-label">{field.label}</span>
    <Switch
      checked={value === true}
      aria-labelledby="{id}-label"
      aria-describedby={field.hint ? `${id}-hint` : undefined}
      onCheckedChange={(checked) => onChange(checked ? true : undefined)}
    />
    {#if field.hint}<p class="field__hint" id="{id}-hint">{field.hint}</p>{/if}
  </div>
{:else if field.control === 'choice'}
  <div class="field">
    <span class="field__label" id="{id}-label">{field.label}</span>
    <div
      class="field__choices"
      role="group"
      aria-labelledby="{id}-label"
      aria-describedby={field.hint ? `${id}-hint` : undefined}
      style:--_count={options.length}
    >
      {#each options as option (option.value)}
        <button
          type="button"
          class="field__choice"
          aria-pressed={chosen === option.value}
          onclick={() => choose(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    {#if field.hint}<p class="field__hint" id="{id}-hint">{field.hint}</p>{/if}
  </div>
{:else if field.control === 'mark'}
  <div class="field">
    <span class="field__label" id="{id}-label">{field.label}</span>
    <div
      class="field__marks"
      role="group"
      aria-labelledby="{id}-label"
      aria-describedby={field.hint ? `${id}-hint` : undefined}
    >
      {#each marks as option (option.value)}
        <button
          type="button"
          class="field__mark"
          aria-label={option.label}
          aria-pressed={value === option.value}
          onclick={() => mark(option.value)}
        >
          <Mark mark={option.value} size="1.25rem" />
        </button>
      {/each}
    </div>
    {#if field.hint}<p class="field__hint" id="{id}-hint">{field.hint}</p>{/if}
  </div>
{:else if field.control === 'select'}
  <div class="field">
    <Select
      id="{id}-select"
      label={field.label}
      options={[...(field.options ?? [])]}
      value={typeof value === 'string' ? value : field.options?.[0]?.value}
      onValueChange={(next) => onChange(next)}
    />
    {#if field.hint}<p class="field__hint">{field.hint}</p>{/if}
  </div>
{:else}
  <div class="field">
    <label class="field__label" for="{id}-input">{field.label}</label>
    {#if field.control === 'textarea'}
      <textarea
        id="{id}-input"
        class="field__input field__input--area"
        value={text}
        maxlength={field.maxLength}
        placeholder={field.placeholder}
        aria-describedby="{id}-meta"
        rows={(field.maxLength ?? 0) > 400 ? 5 : 3}
        oninput={(event) => writeText(event.currentTarget.value)}
      ></textarea>
    {:else}
      <input
        id="{id}-input"
        class="field__input"
        type="text"
        inputmode={field.control === 'url' ? 'url' : undefined}
        autocomplete="off"
        spellcheck={field.control === 'url' ? false : undefined}
        value={text}
        maxlength={field.maxLength}
        placeholder={field.placeholder}
        aria-describedby="{id}-meta"
        aria-invalid={linkProblem ? true : undefined}
        oninput={(event) => writeText(event.currentTarget.value)}
      />
    {/if}
    <div class="field__meta" id="{id}-meta">
      {#if linkProblem}
        <p class="field__error">{linkProblem}</p>
      {:else if field.hint}
        <p class="field__hint">{field.hint}</p>
      {/if}
      {#if field.maxLength !== undefined}
        <span class="field__count" data-near={nearLimit ? '' : undefined}>
          {m.studio_page_editor_char_count({
            count: String(text.length),
            max: String(field.maxLength),
          })}
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }

  .field--toggle {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
  }

  .field--toggle .field__hint {
    grid-column: 1 / -1;
  }

  .field__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* The spacing control's group (SpacingControl): a well, the pressed option
     raised on it. */
  .field__choices {
    display: grid;
    grid-template-columns: repeat(var(--_count), minmax(0, 1fr));
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .field__choice {
    min-block-size: var(--tap-target-min);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .field__choice:hover {
    color: var(--color-text);
  }

  .field__choice[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    font-weight: var(--font-medium);
    box-shadow: var(--shadow-xs);
  }

  .field__choice:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  /* The marks: as many tap-sized cells as fit, the chosen one raised. */
  .field__marks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tap-target-min), 1fr));
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .field__mark {
    display: grid;
    place-items: center;
    min-block-size: var(--tap-target-min);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .field__mark:hover {
    color: var(--color-text);
  }

  .field__mark[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-xs);
  }

  .field__mark:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .field__input {
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .field__input--area {
    resize: vertical;
    field-sizing: content;
    min-block-size: 4lh;
    max-block-size: 16lh;
    line-height: var(--leading-normal);
  }

  .field__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  .field__input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  .field__meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .field__hint,
  .field__error {
    flex: 1;
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .field__error {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .field__error::before {
    content: '';
    display: inline-block;
    inline-size: var(--space-2);
    block-size: var(--space-2);
    margin-inline-end: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-error);
  }

  .field__count {
    flex: none;
    margin-inline-start: auto;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }

  .field__count[data-near] {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }
</style>
