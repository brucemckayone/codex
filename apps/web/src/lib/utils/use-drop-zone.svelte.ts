/**
 * Shared drag-and-drop handler for upload zones.
 *
 * Provides reactive `isDragging` state and event handlers for
 * dragenter, dragover, dragleave, and drop events.
 *
 * @param onDrop - Callback that receives the dropped files
 * @returns Reactive state and event handler functions
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDropZone } from '$lib/utils/use-drop-zone.svelte';
 *   const { isDragging, handlers } = useDropZone({
 *     onDrop: (files) => handleFiles(files),
 *   });
 * </script>
 *
 * <div
 *   class:dragging={isDragging}
 *   ondragover={handlers.dragover}
 *   ondragleave={handlers.dragleave}
 *   ondrop={handlers.drop}
 * >
 *   Drop files here
 * </div>
 * ```
 */

interface UseDropZoneOptions {
  /** Called when files are dropped. Receives a FileList. */
  onDrop: (files: FileList) => void;
}

interface DropZoneHandlers {
  dragover: (e: DragEvent) => void;
  dragleave: (e: DragEvent) => void;
  drop: (e: DragEvent) => void;
}

interface UseDropZoneReturn {
  /** Whether the user is currently dragging over the zone */
  readonly isDragging: boolean;
  /** Event handlers to spread onto the drop zone element */
  handlers: DropZoneHandlers;
}

export function useDropZone(options: UseDropZoneOptions): UseDropZoneReturn {
  let isDragging = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      options.onDrop(e.dataTransfer.files);
    }
  }

  return {
    get isDragging() {
      return isDragging;
    },
    handlers: {
      dragover: handleDragOver,
      dragleave: handleDragLeave,
      drop: handleDrop,
    },
  };
}
