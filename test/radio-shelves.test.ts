// The Home shelves' order, counts and empty states, and the category tiles' warm colour. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Facet } from '../src/apps/radio/api.ts';
import { FACET_COUNT, TOP_COUNT, TOP_ERROR, WARM_HUES, homeShelves, tileHue, topFacets, type HomeInput } from '../src/apps/radio/web/shelves.ts';

const full: HomeInput = { favs: 3, recent: 4, top: 'ok', topCount: 100, genres: 'ok', genreCount: 40, countries: 'ok', countryCount: 30 };
const plan = (over: Partial<HomeInput>) => homeShelves({ ...full, ...over });
const f = (name: string, count: number): Facet => ({ name, code: '', count });

test('the shelves come in order: Favourites, Recently played, Top stations, Genres, Countries', () => {
  assert.deepEqual(plan({}).map(p => p.id), ['favs', 'recent', 'top', 'genres', 'countries']);
});

test('the shelves cap their cards: Top at 20, Genres and Countries at 12', () => {
  const p = plan({});
  assert.equal(p.find(s => s.id === 'top')!.count, TOP_COUNT);
  assert.equal(p.find(s => s.id === 'genres')!.count, FACET_COUNT);
  assert.equal(p.find(s => s.id === 'countries')!.count, FACET_COUNT);
  assert.equal(p.find(s => s.id === 'favs')!.count, 3);
  assert.equal(plan({ topCount: 5 }).find(s => s.id === 'top')!.count, 5);
});

test('Favourites stays with an empty card; Recently played hides when empty', () => {
  const none = plan({ favs: 0, recent: 0 });
  assert.equal(none.find(s => s.id === 'favs')!.hidden, false);
  assert.equal(none.find(s => s.id === 'recent')!.hidden, true);
});

test('Top stations shows skeletons while it loads and an error line on failure', () => {
  const loading = plan({ top: 'loading', topCount: 0 }).find(s => s.id === 'top')!;
  assert.equal(loading.loading, true);
  assert.equal(loading.hidden, false);
  const failed = plan({ top: 'error', topCount: 0 }).find(s => s.id === 'top')!;
  assert.equal(failed.error, TOP_ERROR);
  assert.equal(failed.hidden, false);
  assert.equal(plan({ top: 'ok', topCount: 0 }).find(s => s.id === 'top')!.hidden, true);
});

test('Genres and Countries hide on error, while loading and when empty', () => {
  assert.equal(plan({ genres: 'error' }).find(s => s.id === 'genres')!.hidden, true);
  assert.equal(plan({ genres: 'loading' }).find(s => s.id === 'genres')!.hidden, true);
  assert.equal(plan({ countries: 'ok', countryCount: 0 }).find(s => s.id === 'countries')!.hidden, true);
  assert.equal(plan({}).find(s => s.id === 'countries')!.showAll, true);
});

test('the top twelve facets by count, most first', () => {
  const list = Array.from({ length: 15 }, (_, i) => f(`g${i}`, i));
  const top = topFacets(list);
  assert.equal(top.length, FACET_COUNT);
  assert.equal(top[0].name, 'g14');
  assert.equal(top[FACET_COUNT - 1].name, 'g3');
});

test('a category tile has a steady warm hue from the warm set', () => {
  assert.equal(tileHue('Jazz'), tileHue('Jazz'));
  for (const name of ['Jazz', 'News', 'Pop', 'Classical', 'Talk']) assert.ok((WARM_HUES as readonly number[]).includes(tileHue(name)));
});
