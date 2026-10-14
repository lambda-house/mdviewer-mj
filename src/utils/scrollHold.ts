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

  const observer = typeof ResizeObserver !== 'undefined' && content
    ? new ResizeObserver(apply)
    : null;
  let stopped = false;
  const started = performance.now();
  // The key press or click that started this hold may still be on its way to window
  const handleUserEvent = (event: Event) => {
    if (event.timeStamp >= started) stop();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
    USER_EVENTS.forEach((name) => window.removeEventListener(name, handleUserEvent));
    container.removeEventListener(HOLD_EVENT, stop);
    onStop?.();
  };

  const timer = setTimeout(stop, duration);
  USER_EVENTS.forEach((name) => window.addEventListener(name, handleUserEvent, { passive: true }));
  container.addEventListener(HOLD_EVENT, stop);

  apply();
  if (content) observer?.observe(content);
  return stop;
}
