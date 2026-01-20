import type { createDropdownMenu } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const NAME = 'dropdown-menu';

export const setCtx = (builder: ReturnType<typeof createDropdownMenu>) => {
  setContext(NAME, builder);
};

export const getCtx = () => {
  return getContext<ReturnType<typeof createDropdownMenu>>(NAME);
};
