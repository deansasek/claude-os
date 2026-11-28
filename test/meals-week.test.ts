// The Meals week and dinner titles (src/apps/meals/web/week.ts). Pure logic, so it is tested directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dinnerOn, dinnerTitle, dinnersIn, isoDay, mondayOf, weekDays } from '../src/apps/meals/web/week.ts';

test('the week starts on the Monday of the day given, at local midnight', () => {
  const wed = new Date(2026, 10, 25);   // Wednesday 25 November 2026
  const mon = mondayOf(wed);
  assert.equal(isoDay(mon), '2026-11-23');
  assert.equal(mon.getHours(), 0);
  assert.equal(isoDay(mondayOf(new Date(2026, 10, 29))), '2026-11-23');   // a Sunday belongs to the week before it starts
});

test('the seven days run Monday to Sunday, each ending at the next midnight', () => {
  const days = weekDays(new Date(2026, 10, 23));
  assert.equal(days.length, 7);
  assert.equal(days[0].iso, '2026-11-23');
  assert.equal(days[6].iso, '2026-11-29');
  assert.equal(days[0].end, days[1].start);
});

test('a dinner is titled with its text, and read back from the events', () => {
  assert.equal(dinnerTitle('  Tacos  '), 'Dinner: Tacos');
  const day = weekDays(new Date(2026, 10, 23))[2];
  const events = [
    { id: 'a', title: 'Dinner: Pasta', start: day.start, allDay: true },
    { id: 'b', title: 'Dentist', start: day.start, allDay: true },
  ];
  const dinners = dinnersIn(events);
  assert.deepEqual(dinners, [{ id: 'a', text: 'Pasta', start: day.start }]);
  assert.equal(dinnerOn(dinners, day)?.text, 'Pasta');
  assert.equal(dinnerOn(dinners, weekDays(new Date(2026, 10, 23))[3]), null);
});

test('a long dinner name is kept to a short line', () => {
  assert.equal(dinnerTitle('x'.repeat(200)).length, 'Dinner: '.length + 60);
});
