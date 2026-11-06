<script lang="ts">
  import { type CreateDialogProps, createDialog } from '@melt-ui/svelte';
  import { type Snippet, setContext } from 'svelte';
  import { lockScroll } from '$lib/utils/scroll-lock';

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
    /**
     * False while a request the dialog started is running: Escape, a click
     * outside and the close button do nothing, so the answer always lands in
     * the dialog that asked. Closing from code (`open = false`) still works.
     * Defaults to true, so every existing dialog is unchanged.
     */
    dismissible?: boolean;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    closeFocus,
    dismissible = true,
    children
  }: Props = $props();

  const dialog = createDialog({
    // We omit the 'open' property from the initial options to avoid type errors with runes
    // and instead sync it via the states object and $effect.
    onOpenChange: ({ curr, next }) => {
      // Only a real change is one. Melt calls this on every `set` of its
      // store, false to false included, and the sync effect below sets it on
      // mount and again after each change it reports. Passed on, a closed
      // dialog said "closed" on mount and a close said it twice; a consumer
      // whose close writes the URL then navigated in a loop (the media
      // drawer, Codex-a6ofh.1.7: 9.8 GB in Chrome).
      if (next === curr) return next;
      // Melt closing on its own (Escape, a press outside, the close button)
      // while not dismissible: refused. Our own `open = false` has already
      // set the prop, so it passes. This is the one guard for every path, and
      // it rebuilds nothing: toggling Melt's `closeOnOutsideClick` store
      // instead re-created the focus trap, which moved focus to the first
      // tabbable element and off the answer the dialog had just shown
      // (Codex-2hxff.28, R2-L3).
      if (!next && open && !dismissible) return true;
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
    // The page's scroll lock is ours, below, not Melt's: under forceVisible
    // Melt let go only when the panel left the DOM, so a dialog reopened
    // during its close animation lost the release and the page stayed
    // locked (Codex-vlphc review H1).
    preventScroll: false,
    forceVisible: true
  });

  const {
    states: { open: meltOpen }
  } = dialog;

  // Sync prop to melt state
  $effect(() => {
    meltOpen.set(open);
  });

  // The page holds still from open to close, and is let go at the close
  // even while the panel animates out. Counted, so a dialog over a dialog
  // keeps it until the last one closes.
  $effect(() => {
    if (open) return lockScroll();
  });

  // Escape is ignored outright too. Its behaviour is a store the key handler
  // reads, so changing it rebuilds nothing.
  $effect(() => {
    dialog.options.escapeBehavior.set(dismissible ? 'close' : 'ignore');
  });

  setContext('DIALOG', dialog);
  // DialogContent disables its close button with it.
  setContext('DIALOG_DISMISSIBLE', {
    get current() {
      return dismissible;
    }
  });
</script>

{@render children()}
