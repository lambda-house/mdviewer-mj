/**
 * The value a poll brings, or the one held when it says the same (Agent MCR's
 * MCR-139). Pollers that set every answer as a fresh object made React render
 * whole panels every few seconds when nothing had changed; with this a state
 * setter gets the held value back and React leaves the tree alone.
 *
 * Answers come from the same serialiser each time, so their JSON is the same
 * text when their content is.
 */
export function keepSame<T>(held: T, next: T): T {
  if (Object.is(held, next)) return held;
  try {
    return JSON.stringify(held) === JSON.stringify(next) ? held : next;
  } catch {
    return next;
  }
}
