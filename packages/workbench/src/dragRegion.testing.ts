/**
 * For tests: whether a press on `target` would drag the window, by the rule
 * of Tauri's drag script (tauri 2.12.2, `src/window/scripts/drag.js`,
 * `isDragRegion`), walking from the element up as the event's composed path
 * does. Kept as close to the original as the DOM of happy-dom allows. From
 * Agent MCR (MCR-138).
 */
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);

function isClickableElement(el: HTMLElement): boolean {
  return CLICKABLE_TAGS.has(el.tagName)
    || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
    || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
    || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '');
}

export function dragsWindow(target: Element): boolean {
  const path: Element[] = [];
  for (let el: Element | null = target; el; el = el.parentElement) path.push(el);
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue;
    const attr = el.getAttribute('data-tauri-drag-region');
    if (isClickableElement(el) && attr === null) return false;
    if (attr === null) continue;
    if (attr === 'false') return false;
    if (attr === 'deep') return true;
    if (attr === '' || attr === 'true') return el === path[0];
  }
  return false;
}
