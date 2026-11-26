// The saved rail pins, and the order the rail is dragged into. A pin that is hidden now (a focus mode hides it) is not
// in the list the drag shows, so a drag must not drop it from the saved order. Pure: no imports, no DOM.

/**
 * shownOrder: the new order of the pins the rail shows. Each pin that is not shown keeps its place: it goes back right
 * after the pin that came before it in the old list (first if it was first).
 */
export function reorderPins(pins: string[], shownOrder: string[]): string[] {
  const out = [...shownOrder];
  pins.forEach((pin, i) => {
    if (out.includes(pin)) return;
    const at = i === 0 ? 0 : out.indexOf(pins[i - 1]) + 1;   // the previous pin is already in `out`
    out.splice(at, 0, pin);
  });
  return out;
}
