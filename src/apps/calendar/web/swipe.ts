// The calendar's swipe: a sideways move of more than 60px, and more than 1.5 times the vertical move, changes the period.
// Pure: no DOM, so the test runs under node. A left swipe is the next period (1), a right swipe the previous (-1).

export function swipeStep(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx < 0 ? 1 : -1;
  return 0;
}
