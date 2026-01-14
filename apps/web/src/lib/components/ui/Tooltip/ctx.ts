import type { createTooltip } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const CTX_KEY = 'tooltip-ctx';

export function setCtx(builder: ReturnType<typeof createTooltip>) {
  setContext(CTX_KEY, builder);
}

export function getCtx() {
  return getContext<ReturnType<typeof createTooltip>>(CTX_KEY);
}
