import type { createDropdownMenu } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const NAME = 'dropdown-menu';

export const setCtx = (builder: ReturnType<typeof createDropdownMenu>) => {
  setContext(NAME, builder);
};

export const getCtx = () => {
  return getContext<ReturnType<typeof createDropdownMenu>>(NAME);
};

const DISABLED = 'dropdown-menu-disabled';

/** The Root's `disabled`, read by its Trigger. */
export const setDisabledCtx = (disabled: () => boolean) => {
  setContext(DISABLED, disabled);
};

export const getDisabledCtx = (): (() => boolean) => {
  return getContext<(() => boolean) | undefined>(DISABLED) ?? (() => false);
};
