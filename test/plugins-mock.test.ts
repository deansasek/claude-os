// The settings plugins mock: a custom MCP server is added for the session, switched and removed; the marketplace
// reads as not there. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/settings/web/plugins-mock.ts';
import { PLUGIN_OFF_MAX, toggleRefusal } from '../src/apps/settings/api.ts';

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

test('the marketplace reads as not there, and installing says the CLI is missing', () => {
  assert.equal((answerMock('GET', '/api/settings/plugins/market').body as { error: string }).error, 'no_marketplace');
  assert.equal((answerMock('POST', '/api/settings/plugins/market/install', { name: 'x' }).body as { error: string }).error, 'no_cli');
});
