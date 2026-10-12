<!--
  @component ButtonActionField

  Where a Button section goes (03 X64): one of the proven set, never a script.

    join    — the default, stored as no action at all
    section — a section on this page, picked from the page's own list
    preview — the page's preview film, offered only once the journey has one
    link    — an https address, written only once it is one

  Nothing invalid is ever written: a link is kept in this field until it is a
  full https address (the write boundary, `@codex/validation`, would refuse
  anything else and the save would fail), and a section is written only when
  there is one to pick. The canvas shows the label each action starts with
  until the creator writes their own.
-->
<script lang="ts">
  import Select from '$lib/components/ui/Select/Select.svelte';
  import {
    BUTTON_ACTION_IDS,
    type BlockField,
    type ButtonActionId,
    DEFINITIONS,
    isButtonHref,
    readButtonAction,
  } from '$lib/page-builder/kit';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    field: BlockField;
    value: unknown;
    onChange: (value: unknown) => void;
    /** The Button's own section, never a target of itself. */
    sectionId: string;
  }

  const { field, value, onChange, sectionId }: Props = $props();

  const id = $props.id();
  const stored = $derived(readButtonAction(value));
  // A kind picked here and not yet writable (a link still being typed).
  let picked = $state<ButtonActionId | null>(null);
  const kind = $derived<ButtonActionId>(picked ?? stored?.kind ?? 'join');

  const hasFilm = $derived(sellMedia.slot('previewVideoMediaId') !== null);
  const targets = $derived(
    pageBuilder.sections
      .filter((s) => s.id !== sectionId)
      .map((s) => {
        const name = s.name?.trim() || DEFINITIONS[s.type]?.label || s.type;
        return {
          value: s.id,
          label:
            s.enabled === false
              ? m.studio_page_editor_button_section_hidden({ section: name })
              : name,
        };
      })
  );

  const NAMES: Record<ButtonActionId, () => string> = {
    join: m.studio_page_editor_button_action_join,
    section: m.studio_page_editor_button_action_section,
    preview: m.studio_page_editor_button_action_preview,
    link: m.studio_page_editor_button_action_link,
  };
  // Preview is offered only once there is a film to play; a stored preview
  // stays listed so the creator can see what it is and change it.
  const options = $derived(
    BUTTON_ACTION_IDS.filter(
      (action) => action !== 'preview' || hasFilm || stored?.kind === 'preview'
    ).map((action) => ({ value: action, label: NAMES[action]() }))
  );

  let href = $state(untrackedHref());
  const hrefProblem = $derived(
    href.trim() && !isButtonHref(href.trim()) ? m.studio_page_editor_button_link_invalid() : null
  );

  function untrackedHref(): string {
    const action = readButtonAction(value);
    return action?.kind === 'link' ? action.href : '';
  }

  function choose(next: string | undefined): void {
    if (next === 'join') {
      picked = null;
      onChange(undefined);
    } else if (next === 'section') {
      const first = targets[0]?.value;
      picked = first ? null : 'section';
      if (first) onChange({ kind: 'section', target: first });
    } else if (next === 'preview') {
      picked = null;
      onChange({ kind: 'preview' });
    } else if (next === 'link') {
      const ready = isButtonHref(href.trim());
      picked = ready ? null : 'link';
      if (ready) onChange({ kind: 'link', href: href.trim() });
    }
  }

  function writeHref(next: string): void {
    href = next;
    if (isButtonHref(next.trim())) {
      picked = null;
      onChange({ kind: 'link', href: next.trim() });
    }
  }
</script>

<div class="action">
  <Select
    id="{id}-kind"
    label={field.label}
    options={options}
    value={kind}
    onValueChange={choose}
  />

  {#if kind === 'join'}
    <p class="action__hint">{m.studio_page_editor_button_action_join_hint()}</p>
  {:else if kind === 'section'}
    {#if targets.length > 0}
      <Select
        id="{id}-target"
        label={m.studio_page_editor_button_section_label()}
        options={targets}
        value={stored?.kind === 'section' ? stored.target : targets[0]?.value}
        onValueChange={(target) => {
          if (target) onChange({ kind: 'section', target });
        }}
      />
    {:else}
      <p class="action__hint" role="status">{m.studio_page_editor_button_section_none()}</p>
    {/if}
  {:else if kind === 'link'}
    <label class="action__label" for="{id}-href">{m.studio_page_editor_button_link_label()}</label>
    <input
      id="{id}-href"
      class="action__input"
      type="url"
      inputmode="url"
      autocomplete="off"
      spellcheck="false"
      placeholder="https://"
      value={href}
      aria-invalid={hrefProblem ? true : undefined}
      aria-describedby="{id}-href-meta"
      oninput={(event) => writeHref(event.currentTarget.value)}
    />
    <p class="action__hint" id="{id}-href-meta" data-problem={hrefProblem ? '' : undefined}>
      {hrefProblem ?? m.studio_page_editor_button_link_hint()}
    </p>
  {/if}
  {#if !hasFilm && stored?.kind !== 'preview'}
    <p class="action__hint">{m.studio_page_editor_button_action_preview_missing()}</p>
  {/if}
</div>

<style>
  .action {
    display: grid;
    gap: var(--space-2);
  }

  .action__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .action__input {
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

  .action__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  .action__input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  .action__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .action__hint[data-problem] {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }
</style>
