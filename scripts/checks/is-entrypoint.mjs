/**
 * Whether the module at `moduleUrl` (the caller's own `import.meta.url`) is
 * the process's entry, so a gate's test suite can import the gate without
 * running its main(). Every check script ends with
 * `if (isEntrypoint(import.meta.url)) main();`.
 *
 * Compared as real paths: Node resolves import.meta.url through symlinks but
 * not argv[1], so a plain comparison skipped main() under a symlinked path
 * (macOS /tmp, a symlinked checkout) and exited 0 having checked nothing
 * (Codex-noyrq). Each gate's own test runs it through a symlink.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isEntrypoint(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}
