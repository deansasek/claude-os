// The settings plugins mock: a custom MCP server is added for the session, switched and removed; the marketplace
// reads as not there. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/settings/web/plugins-mock.ts';
import { MARKETPLACE, markInstalled, PLUGIN_OFF_MAX, removeRefusal, toggleRefusal, type MarketPlugin, type MarketView } from '../src/apps/settings/api.ts';

test('a custom MCP server is added, switched, and removed for the session', () => {
  assert.equal((answerMock('POST', '/api/settings/plugins/mcp', { name: 'demo', type: 'stdio', command: 'node' }).body as { ok: boolean }).ok, true);
  const find = () => (answerMock('GET', '/api/settings/plugins').body as { items: { key: string; on: boolean }[] }).items.find(i => i.key === 'mcp:demo');
  assert.equal(find()?.on, true);
  assert.equal((answerMock('POST', '/api/settings/plugins/toggle', { key: 'mcp:demo', on: false }).body as { ok: boolean }).ok, true);
  assert.equal(find()?.on, false);
  answerMock('POST', '/api/settings/plugins/mcp/remove', { name: 'demo' });
  assert.equal(find(), undefined);
});

test('a refused switch names the reason, and only a dropped connection blames the PC', () => {
  assert.equal(toggleRefusal('too_many'), `ClaudeOS keeps up to ${PLUGIN_OFF_MAX} switched off. Switch one back on first.`);
  assert.equal(toggleRefusal('bad_key'), 'Couldn’t save that switch.');
  assert.equal(toggleRefusal('something_new'), 'Couldn’t save that switch.');
  assert.ok(!toggleRefusal('too_many').includes('PC'));
});

test('a remove the PC refuses names the server as gone, and never blames the connection', () => {
  assert.equal(removeRefusal(), 'It isn’t on your PC any more.');
  assert.ok(!removeRefusal().includes('connection'));
  assert.ok(!removeRefusal().includes('Check'));
  assert.equal((answerMock('POST', '/api/settings/plugins/mcp', { name: 'gone', type: 'stdio', command: 'node' }).body as { ok: boolean }).ok, true);
  assert.equal((answerMock('POST', '/api/settings/plugins/mcp/remove', { name: 'gone' }).body as { ok: boolean }).ok, true);
  assert.equal((answerMock('POST', '/api/settings/plugins/mcp/remove', { name: 'gone' }).body as { ok: boolean }).ok, false);
});

const plugin = (name: string, installed: boolean): MarketPlugin => ({
  name, description: '', author: '', category: '', keywords: [], version: null, homepage: null, from: null, parts: [], installed,
});

test('markInstalled sets one plugin on or off, leaves the others alone, and does not change its input', () => {
  const view: MarketView = { marketplace: MARKETPLACE, updatedAt: null, error: null, plugins: [plugin('a', false), plugin('b', true)] };
  const before = JSON.stringify(view);
  const added = markInstalled(view, 'a', true);
  assert.equal(added.plugins[0].installed, true);
  assert.equal(added.plugins[1], view.plugins[1]);   // the other plugin is the same object
  const removed = markInstalled(added, 'b', false);
  assert.equal(removed.plugins[0].installed, true);
  assert.equal(removed.plugins[1].installed, false);
  assert.equal(markInstalled(view, 'missing', true).plugins[0].installed, false);   // an unknown name changes nothing
  assert.equal(JSON.stringify(view), before);
  assert.notEqual(added, view);
});

test('the marketplace reads as not there, and installing says the CLI is missing', () => {
  assert.equal((answerMock('GET', '/api/settings/plugins/market').body as { error: string }).error, 'no_marketplace');
  assert.equal((answerMock('POST', '/api/settings/plugins/market/install', { name: 'x' }).body as { error: string }).error, 'no_cli');
});
