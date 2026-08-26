<script lang="ts">
  import { type CreateDialogProps, createDialog } from '@melt-ui/svelte';
  import { type Snippet, setContext } from 'svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * Where focus goes when the dialog closes.
     *
     * Melt restores focus to the element it recorded as `activeTrigger`, and it
     * records that ONLY inside its own trigger element's click handler. This
     * wrapper never renders that element — there is no `Dialog.Trigger` in the
     * barrel and no `DialogTrigger.svelte` in this directory — so every dialog
     * in the app is opened programmatically (`open = true` from a list row, a
     * toolbar button, a menu item) and `activeTrigger` is permanently null.
     *
     * The consequence is uniform: on close Melt calls
     * `handleFocus({ prop: undefined, defaultEl: null })`, which is a no-op, the
     * panel unmounts, and `document.activeElement` falls back to `<body>` — so a
     * keyboard user is dumped to the top of the tab order (WCAG 2.4.3). Passing
     * `closeFocus` is currently the ONLY way a dialog here restores focus.
     *
     * Pass an element, a selector, or a function returning either. Prefer the
     * function form whenever one dialog instance serves many rows: it is
     * evaluated at close time, whereas an element passed here is read once per
     * close against whatever the prop holds then.
     *
     * Omitting it is byte-for-byte the current behaviour — see the resolver
     * below, which reproduces Melt's own default branch.
     */
    closeFocus?: CreateDialogProps['closeFocus'];
    children: Snippet;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    closeFocus,
    children
  }: Props = $props();

  const dialog = createDialog({
    // We omit the 'open' property from the initial options to avoid type errors with runes
    // and instead sync it via the states object and $effect.
    onOpenChange: ({ next }) => {
      open = next;
      onOpenChange?.(next);
      return next;
    },
    // Always a function, never the prop itself. `createDialog` reads its options
    // once into stores, so handing it the raw prop would freeze whatever
    // `closeFocus` held at construction. Resolving inside the closure makes the
    // prop live, which is what one drawer serving many rows needs.
    //
    // The `undefined` branch reproduces Melt's own default branch exactly: its
    // `handleFocus` does `defaultEl?.focus()` when no prop is given, and returning
    // `defaultEl` here routes into `isHTMLElement(returned) && returned.focus()`,
    // which is the same call. Since nothing in this app renders Melt's trigger,
    // `defaultEl` is in practice always null and both spellings are a no-op — so
    // omitting the prop cannot regress an existing consumer.
    closeFocus: (defaultEl) => {
      const target = closeFocus;
      if (target === undefined) return defaultEl ?? null;
      return typeof target === 'function' ? target(defaultEl) : target;
    },
    forceVisible: true
  });

  const {
    states: { open: meltOpen }
  } = dialog;

  // Sync prop to melt state
  $effect(() => {
    meltOpen.set(open);
  });

  setContext('DIALOG', dialog);
</script>

{@render children()}
