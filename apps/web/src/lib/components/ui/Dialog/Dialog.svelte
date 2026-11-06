<script module lang="ts">
  /**
   * What a press last landed on, page-wide. WebKit (Safari, every iOS
   * browser) focuses no button on a click or a tap: `activeElement` is
   * <body> as the dialog that press opens records its opener, or, inside an
   * open dialog, the panel itself (it takes focus from any click on it). A
   * key pressed since forgets it: that open came from the keyboard, and the
   * keyboard leaves focus on what opened it.
   *
   * A press names only the open that follows it at once. A dialog a timer,
   * a response or a load opens later must not send focus back to a press
   * minutes old, and scroll the page to it: Melt's focus() does.
   */
  let pressed: Element | null = null;
  let pressedAt = 0;
  const PRESS_OPENS_WITHIN_MS = 500;
  if (typeof document !== 'undefined') {
    const press = (event: Event) => {
      pressed = event.target instanceof Element ? event.target : null;
      pressedAt = performance.now();
    };
    document.addEventListener('pointerdown', press, true);
    // A long press opens on its release: a real click (detail > 0, which a
    // key's synthetic click is not) counts from there.
    document.addEventListener(
      'click',
      (event) => {
        if (event.detail > 0) press(event);
      },
      true
    );
    document.addEventListener(
      'keydown',
      () => {
        pressed = null;
      },
      true
    );
  }

  const FOCUSABLE =
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex], [contenteditable]:not([contenteditable="false"])';

  /** The element opening a dialog now: what was just pressed, unless a key came since, else what has focus. */
  function currentOpener(): HTMLElement | null {
    const recent = performance.now() - pressedAt <= PRESS_OPENS_WITHIN_MS;
    const target = recent ? pressed?.closest(FOCUSABLE) : null;
    if (target instanceof HTMLElement && target.isConnected) return target;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }
</script>

<script lang="ts">
  import { type CreateDialogProps, createDialog } from '@melt-ui/svelte';
  import { type Snippet, setContext, untrack } from 'svelte';
  import { lockScroll } from '$lib/utils/scroll-lock';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * Where focus goes when the dialog closes, over the default.
     *
     * The default is the element that opened it: the focusable element a
     * press landed on (a click or a tap in WebKit focuses no button), or,
     * when a key opened it, what had focus. A dialog opened from the
     * keyboard with nothing focused, or whose opener has left the page,
     * leaves focus where Melt does. Melt's own `activeTrigger` would win, but
     * nothing here renders Melt's trigger, so every dialog is opened from
     * code (`open = true`) and that is always null.
     *
     * Pass an element, a selector, or a function returning either, for a
     * dialog whose focus belongs elsewhere: a row that the action removed, a
     * control that is re-rendered. Prefer the function form whenever one
     * dialog instance serves many rows: it is evaluated at close time,
     * whereas an element passed here is read once per close against
     * whatever the prop holds then.
     */
    closeFocus?: CreateDialogProps['closeFocus'];
    /**
     * False while a request the dialog started is running: Escape, a click
     * outside and the close button do nothing, so the answer always lands in
     * the dialog that asked. Closing from code (`open = false`) still works.
     * Defaults to true, so every existing dialog is unchanged.
     */
    dismissible?: boolean;
    /**
     * The panel's role. `alertdialog` is for a dialog that interrupts to ask
     * for an answer at once; a screen reader announces its message as it
     * opens. Melt puts the role on the panel, so it is set here and never as
     * an attribute on Dialog.Content. Defaults to `dialog`.
     */
    role?: 'dialog' | 'alertdialog';
    children: Snippet;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    closeFocus,
    dismissible = true,
    role = 'dialog',
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
    // With no prop, Melt's own default comes first: `defaultEl` is its
    // `activeTrigger`, which it would focus itself. Never undefined over it.
    // Then the opener recorded as the dialog opened, while it is on the page.
    closeFocus: (defaultEl) => {
      const target = closeFocus;
      if (target === undefined) return defaultEl ?? (opener?.isConnected ? opener : null);
      return typeof target === 'function' ? target(defaultEl) : target;
    },
    // The page's scroll lock is ours, below, not Melt's: under forceVisible
    // Melt let go only when the panel left the DOM, so a dialog reopened
    // during its close animation lost the release and the page stayed
    // locked (Codex-vlphc review H1).
    preventScroll: false,
    // Always a value: an unset option here would replace Melt's default
    // with undefined and leave the panel with no role. Synced below.
    role: untrack(() => role),
    forceVisible: true
  });

  const {
    states: { open: meltOpen }
  } = dialog;

  /** Where focus goes back to at the close, when no `closeFocus` says. */
  let opener: HTMLElement | null = null;

  // Before the open below: Melt reads the role only as the panel's open
  // state changes, so a role set after an open waits for the next one.
  $effect(() => {
    dialog.options.role.set(role);
  });

  // Sync prop to melt state. The opener is read first, while focus is still
  // where the open came from: Melt moves it into the panel after a tick.
  $effect(() => {
    if (open) opener = currentOpener();
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
