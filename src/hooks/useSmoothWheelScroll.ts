import { useEffect } from 'react';

// ============================================================
// Tuning
// ============================================================

/** Acceleration while speeding up (px/s²) - how slowly the scroll ramps up. */
const RAMP_UP = 5000;
/** Deceleration used to brake into the end of the pending distance (px/s²). */
const RAMP_DOWN = 4000;
/** Assumed gap before the first notch of a burst (ms) - sets its start speed. */
const FIRST_NOTCH_INTERVAL = 140;
/** Notches further apart than this start a new burst (ms). */
const BURST_GAP = 300;
/** Shortest notch interval taken into account (ms) - caps the target speed. */
const MIN_INTERVAL = 20;
/** Upper bound for the scroll speed (px/s). */
const MAX_SPEED = 9000;
/**
 * Fast spinning also covers more distance: below this notch interval (ms) each
 * notch is scaled up, by at most MAX_DISTANCE_BOOST.
 */
const BOOST_INTERVAL = 60;
const MAX_DISTANCE_BOOST = 2.5;
/** Weight of the newest interval in the running average (0..1). */
const INTERVAL_SMOOTHING = 0.5;
/** Fallback pixels per wheel "line" when deltaMode is DOM_DELTA_LINE. */
const WHEEL_LINE_HEIGHT = 40;

function normalizeWheelDelta(event: WheelEvent, viewportHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_HEIGHT;
  if (event.deltaMode === 2) return event.deltaY * viewportHeight;
  return event.deltaY;
}

/**
 * A notch of a mouse wheel, as opposed to a trackpad or Magic Mouse. Those
 * report precise pixel deltas and already scroll with the system's momentum;
 * animating them again overshoots and keeps the page gliding after the
 * fingers stop. WebKit and Chromium report a notch as a multiple of 120 in
 * the legacy `wheelDeltaY`.
 */
function isWheelNotch(event: WheelEvent): boolean {
  if (event.deltaMode !== 0) return true;
  const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  return typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0;
}

/** True when a nested scroller between `node` and `stop` can absorb the delta. */
function hasScrollableAncestor(node: Element | null, stop: Element, deltaY: number): boolean {
  let current: Element | null = node;

  while (current && current !== stop) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      const atTop = current.scrollTop <= 0;
      const atBottom = current.scrollTop + current.clientHeight >= current.scrollHeight - 1;
      if (!((deltaY < 0 && atTop) || (deltaY > 0 && atBottom))) {
        return true;
      }
    }
    current = current.parentElement;
  }

  return false;
}

/**
 * Animated wheel scrolling with speed that follows the wheel. Only mouse
 * wheel notches are animated (`isWheelNotch`); trackpads scroll natively.
 *
 * Every notch adds its distance to a pending budget, so the total distance
 * stays what the wheel asked for. The time between notches sets the target
 * speed: slow clicks glide, fast spinning races. The actual speed ramps up
 * towards that target at RAMP_UP and is always limited to what can still brake
 * to a stop within the pending distance at RAMP_DOWN - so when the notches
 * stop, the scroll slows down smoothly instead of halting.
 */
export function useSmoothWheelScroll(
  scrollRef: React.RefObject<HTMLElement>,
  enabled: boolean,
  ready = true
): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled || !ready) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let lastFrameTime = 0;
    /** Signed distance still to travel. */
    let pending = 0;
    /** Current speed (px/s, always >= 0, applied in the direction of `pending`). */
    let speed = 0;
    /** Speed the wheel is asking for. */
    let targetSpeed = 0;
    /** Fractional scroll position (scrollTop is rounded by the engine). */
    let position = el.scrollTop;
    let lastNotchTime = 0;
    let interval = FIRST_NOTCH_INTERVAL;

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = 0;
      speed = 0;
    };

    const step = (now: number) => {
      // Cap dt so a stalled frame (tab switch, GC) does not cause a jump
      const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
      lastFrameTime = now;

      // Keyboard, scrollbar drags or a scroll restore moved the element
      if (Math.abs(el.scrollTop - position) > 2) {
        position = el.scrollTop;
      }

      const remaining = Math.abs(pending);
      const brakeLimit = Math.sqrt(2 * RAMP_DOWN * remaining);
      const wanted = Math.min(targetSpeed, brakeLimit);
      speed = speed < wanted
        ? Math.min(wanted, speed + RAMP_UP * dt)
        : wanted; // braking limit is already a smooth deceleration curve

      // Always make a little progress so the last pixels do not crawl
      const move = Math.min(remaining, Math.max(speed * dt, 0.5));
      const direction = Math.sign(pending);
      const max = el.scrollHeight - el.clientHeight;
      const next = Math.max(0, Math.min(max, position + direction * move));

      pending -= direction * move;
      const before = el.scrollTop;
      position = next;
      el.scrollTop = next;

      const hitEdge = (next <= 0 && direction < 0) || (next >= max && direction > 0);
      const stuck = el.scrollTop === before && Math.abs(next - before) >= 1;
      if (Math.abs(pending) < 0.5 || hitEdge || stuck) {
        position = el.scrollTop;
        stop();
        return;
      }

      frame = requestAnimationFrame(step);
    };

    const handleWheel = (event: WheelEvent) => {
      // Ctrl/Cmd + wheel is zoom, and Mermaid viewports handle their own wheel
      if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (event.deltaY === 0) return;
      if (el.scrollHeight - el.clientHeight <= 0) return;
      if (hasScrollableAncestor(event.target as Element | null, el, event.deltaY)) return;

      // Trackpads scroll natively; one taking over ends a running animation
      if (!isWheelNotch(event)) {
        if (frame) {
          stop();
          position = el.scrollTop;
        }
        return;
      }

      event.preventDefault();

      const now = performance.now();
      const gap = now - lastNotchTime;
      lastNotchTime = now;
      interval = gap > BURST_GAP
        ? FIRST_NOTCH_INTERVAL
        : interval * (1 - INTERVAL_SMOOTHING) + Math.max(MIN_INTERVAL, gap) * INTERVAL_SMOOTHING;

      let delta = normalizeWheelDelta(event, el.clientHeight);
      if (interval < BOOST_INTERVAL) {
        delta *= Math.min(MAX_DISTANCE_BOOST, BOOST_INTERVAL / interval);
      }

      if (!frame) {
        position = el.scrollTop;
      }
      // Reversing direction drops what was left of the old direction
      if (pending !== 0 && Math.sign(delta) !== Math.sign(pending)) {
        pending = 0;
        speed = 0;
      }

      pending += delta;
      targetSpeed = Math.min(MAX_SPEED, (Math.abs(delta) / interval) * 1000);

      if (!frame) {
        lastFrameTime = now;
        frame = requestAnimationFrame(step);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      stop();
    };
  }, [scrollRef, enabled, ready]);
}
