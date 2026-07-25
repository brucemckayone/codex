<!--
  @component SectionRenderer

  Renders ONE {@link PageSection} via the type→component registry, resolving its
  variant and threading the edit seam (Codex-2pryk · WP-3/WP-5). Unknown types
  render nothing (forward-compatible). Shared by the WYSIWYG builder canvas
  (`editable`) and the public journey page (read-only).
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import { resolveVariant } from '../section-catalog';
  import './journey-sections.css';
  import { componentForType } from './section-registry';
  import type { JourneyStagePreview } from './section-render';

  interface Props {
    section: PageSection;
    /** True inside the builder canvas — enables contenteditable text. */
    editable?: boolean;
    /** Write one prop key of a section (in-canvas inline edit → store). */
    onEditProp?: (sectionId: string, key: string, value: string) => void;
    /** Curriculum stages for the map/descent section. */
    stages?: readonly JourneyStagePreview[];
  }

  let { section, editable = false, onEditProp, stages }: Props = $props();

  const Component = $derived(componentForType(section.type));
  const variant = $derived(resolveVariant(section));
  const onEdit = (key: string, value: string): void =>
    onEditProp?.(section.id, key, value);
</script>

{#if Component}
  <Component props={section.props} {variant} {editable} {onEdit} {stages} />
{/if}
