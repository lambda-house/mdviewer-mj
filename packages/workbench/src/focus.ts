import type { PaneContext } from './LayoutView';

// The focused pane of the window (shared UI spec §5.3, §5.5): the innermost
// pane that was last pointed at or focused, in whichever layout. Commands
// act on it: split, close, zoom. Each LayoutView registers itself, so a pane
// is looked up as it is now, not as it was when it took the focus.

interface View {
  /** The pane of a leaf, as the layout draws it now. */
  resolve: (leaf: string) => PaneContext | null;
  /** Back to the owner's first layout, if it has one. */
  reset?: () => void;
}

const views = new Map<string, View>();
let focused: { view: string; leaf: string } | null = null;
const listeners = new Set<() => void>();
let version = 0;

const notify = () => { version++; listeners.forEach((listener) => listener()); };

export function registerLayoutView(id: string, view: View): () => void {
  views.set(id, view);
  return () => {
    if (views.get(id) === view) views.delete(id);
    if (focused?.view === id) { focused = null; notify(); }
  };
}

/** A leaf took the focus; inner layouts call this after outer ones, so the innermost pane wins. */
export function setFocusedPane(view: string, leaf: string): void {
  if (focused?.view === view && focused.leaf === leaf) return;
  focused = { view, leaf };
  notify();
}

export function subscribeFocusedPane(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const focusedPaneVersion = (): number => version;

const leafSelector = (view: string, leaf: string) => `[data-layout="${view}"][data-leaf="${leaf.replace(/"/g, '\\"')}"]`;
/** Drawn and not in a hidden surface or view. */
const isShown = (element: Element | null): element is HTMLElement => !!element && element.isConnected && !element.closest('[hidden]');

/** The focused pane, if it is still shown. */
export function focusedPane(): PaneContext | null {
  if (!focused) return null;
  const element = document.querySelector(leafSelector(focused.view, focused.leaf));
  if (!isShown(element)) return null;
  return views.get(focused.view)?.resolve(focused.leaf) ?? null;
}

/** The focused pane's zoom, or null when it doesn't zoom. */
export function focusedZoom() {
  return focusedPane()?.actions.zoom ?? null;
}

/** The layouts around the focused pane, innermost first. */
function layoutsAround(): View[] {
  if (!focused) return [];
  const result: View[] = [];
  let element = document.querySelector(leafSelector(focused.view, focused.leaf));
  if (!isShown(element)) return [];
  for (; element; element = element.parentElement) {
    const id = element.getAttribute('data-view');
    const view = id ? views.get(id) : undefined;
    if (view) result.push(view);
  }
  return result;
}

/** Whether the layout around the focused pane (or one around it) can go back to its first form. */
export const canResetLayout = (): boolean => layoutsAround().some((view) => view.reset);

export function resetLayout(): boolean {
  const view = layoutsAround().find((v) => v.reset);
  view?.reset?.();
  return !!view;
}

/**
 * Move the focus to the next (1) or previous (-1) pane shown, in the order
 * they are drawn: its first control, or the pane itself.
 */
export function focusNextPane(direction: 1 | -1): boolean {
  const all = [...document.querySelectorAll<HTMLElement>('.wb-leaf')].filter((leaf) => isShown(leaf) && !leaf.classList.contains('is-collapsed'));
  // Only the innermost: a pane that holds a layout gives the focus to its panes
  const panes = all.filter((leaf) => !all.some((other) => other !== leaf && leaf.contains(other)));
  if (panes.length === 0) return false;
  const current = focused ? panes.findIndex((leaf) => leaf.matches(leafSelector(focused!.view, focused!.leaf))) : -1;
  const from = current !== -1 ? current : panes.findIndex((leaf) => leaf.contains(document.activeElement));
  const next = panes[from === -1 ? (direction > 0 ? 0 : panes.length - 1) : (from + direction + panes.length) % panes.length];
  const control = next.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  if (control && isShown(control)) {
    control.focus();
  } else {
    if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
    next.focus();
  }
  const view = next.getAttribute('data-layout');
  const leaf = next.getAttribute('data-leaf');
  if (view && leaf) setFocusedPane(view, leaf);
  return true;
}
