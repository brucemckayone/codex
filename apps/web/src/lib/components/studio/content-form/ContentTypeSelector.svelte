<!--
  @component ContentTypeSelector

  Visual card-based content type picker for create mode,
  read-only badge for edit mode.

  @prop {typeof createContentForm | typeof updateContentForm} form - The active form instance
  @prop {boolean} isEdit - Whether in edit mode
  @prop {string} [currentType] - Current content type value (for edit badge)
-->
<script lang="ts">
  import { VideoIcon, MusicIcon, FileTextIcon } from '$lib/components/ui/Icon';
  import { Badge } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    form: any;
    isEdit: boolean;
    currentType?: string;
  }

  const { form, isEdit, currentType }: Props = $props();

  const types = [
    {
      value: 'video' as const,
      label: () => m.studio_content_form_type_video(),
      description: 'Upload or link a video',
      icon: VideoIcon,
    },
    {
      value: 'audio' as const,
      label: () => m.studio_content_form_type_audio(),
      description: 'Upload or link audio',
      icon: MusicIcon,
    },
    {
      value: 'written' as const,
      label: () => m.studio_content_form_type_article(),
      description: 'Write an article',
      icon: FileTextIcon,
    },
  ] as const;

  const selectedType = $derived(form.fields.contentType.value() ?? currentType ?? 'video');
</script>

{#if isEdit}
  <div class="type-badge-row">
    <span class="type-label">{m.studio_content_form_content_type_label()}</span>
    <Badge>{types.find((t) => t.value === currentType)?.label() ?? currentType}</Badge>
  </div>
  <input {...form.fields.contentType.as('hidden', currentType)} />
{:else}
  <fieldset class="type-selector">
    <legend class="type-legend">{m.studio_content_form_content_type_label()}</legend>
    <div class="type-cards">
      {#each types as type}
        <label class="type-card" data-selected={selectedType === type.value || undefined}>
          <input
            {...form.fields.contentType.as('radio', type.value)}
            class="sr-only"
          />
          <svelte:component this={type.icon} size={24} />
          <span class="type-card-label">{type.label()}</span>
          <span class="type-card-desc">{type.description}</span>
        </label>
      {/each}
    </div>
  </fieldset>
{/if}

<style>
  .type-badge-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .type-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .type-selector {
    border: none;
    padding: 0;
    margin: 0;
  }

  .type-legend {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin-bottom: var(--space-3);
  }

  .type-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  @media (max-width: 480px) {
    .type-cards {
      grid-template-columns: 1fr;
    }
  }

  .type-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-3);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: center;
  }

  .type-card:hover {
    border-color: var(--color-brand-primary-subtle);
    background-color: var(--color-interactive-subtle);
  }

  .type-card[data-selected] {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
  }

  .type-card-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .type-card-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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

  :global([data-theme='dark']) .type-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .type-card:hover {
    border-color: var(--color-focus);
    background-color: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface-dark));
  }

  :global([data-theme='dark']) .type-card[data-selected] {
    border-color: var(--color-interactive);
    background-color: color-mix(in srgb, var(--color-interactive) 15%, var(--color-surface-dark));
  }
</style>
