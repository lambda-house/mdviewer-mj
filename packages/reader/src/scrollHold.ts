/**
 * Keep a scroll position while the document's layout settles: syntax
 * highlighting, Mermaid and images change the height after the first paint.
 *
 * Starting a hold ends any other hold on the same container, so a find jump
 * and a scroll restore never fight over the offset.
 */

/** Dispatched on the scroll container when a new hold takes it over. */
const HOLD_EVENT = 'mdviewer:scroll-hold';
const USER_EVENTS = ['wheel', 'keydown', 'mousedown', 'touchstart'] as const;

/** Running holds, by start time. */
const activeHolds = new Map<() => void, number>();
let listening = false;

/**
 * The user taking over ends every hold that started before the event. The
 * listeners are added once and never removed: in WebKitGTK adding or removing
 * a wheel listener forces a full layout on the next geometry read (~120ms on
 * a long document), which made every find jump slow.
 */
function listenForUser(): void {
  if (listening) return;
  listening = true;
  const handleUserEvent = (event: Event) => {
    // The key press or click that started a hold may still be on its way to window
    activeHolds.forEach((started, stop) => {
      if (event.timeStamp >= started) stop();
    });
  };
  USER_EVENTS.forEach((name) => window.addEventListener(name, handleUserEvent, { passive: true }));
}

/**
 * Call `apply` now and whenever `content` resizes, until `duration` ms pass,
 * the user scrolls or types, or another hold starts. Returns a stop function.
 */
export function holdScroll(
  container: HTMLElement,
  content: Element | null,
  apply: () => void,
  duration: number,
  onStop?: () => void
): () => void {
  container.dispatchEvent(new Event(HOLD_EVENT));
  listenForUser();

  const observer = typeof ResizeObserver !== 'undefined' && content
    ? new ResizeObserver(apply)
    : null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
    activeHolds.delete(stop);
    container.removeEventListener(HOLD_EVENT, stop);
    onStop?.();
  };

  const timer = setTimeout(stop, duration);
  activeHolds.set(stop, performance.now());
  container.addEventListener(HOLD_EVENT, stop);

  apply();
  if (content) observer?.observe(content);
  return stop;
}
