/**
 * Whether this browser can show the immersive player: a modal `<dialog>`.
 * Safari before 15.4 has none, so AudioPlayer offers no immersive mode
 * there, as GalleryBlock offers no lightbox.
 *
 * A plain module, not the player's `<script module>`: tsc sees only a
 * component's default export, so a named one breaks `pnpm typecheck`.
 */
export function canShowImmersive(): boolean {
  return (
    typeof HTMLDialogElement === 'function' &&
    typeof HTMLDialogElement.prototype.showModal === 'function'
  );
}
