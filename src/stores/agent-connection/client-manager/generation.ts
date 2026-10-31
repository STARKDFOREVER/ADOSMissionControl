/**
 * Bumped by every connect() and disconnect(). A connect that awaited across a
 * newer connect or a disconnect belongs to a connection the operator already
 * left: it must not write `connected`, a node id, a status or capabilities, or
 * start a poll loop, or the old node's answer is filed under the new node.
 */
let connectGeneration = 0;

/** Start a new connection generation and return its number. */
export function nextGeneration(): number {
  return ++connectGeneration;
}

/** Invalidate every in-flight connect without starting a new one. */
export function bumpGeneration(): void {
  connectGeneration += 1;
}

/** True while {@link generation} is still the latest connect or disconnect. */
export function isCurrent(generation: number): boolean {
  return generation === connectGeneration;
}
