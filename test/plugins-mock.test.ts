// The settings plugins mock: a custom MCP server is added for the session, switched and removed; the marketplace
// reads as not there. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/settings/web/plugins-mock.ts';

test('a custom MCP server is added, switched, and removed for the session', () => {
  assert.equal((answerMock('POST', '/api/settings/plugins/mcp', { name: 'demo', type: 'stdio', command: 'node' }).body as { ok: boolean }).ok, true);
  const find = () => (answerMock('GET', '/api/settings/plugins').body as { items: { key: string; on: boolean }[] }).items.find(i => i.key === 'mcp:demo');
  assert.equal(find()?.on, true);
  answerMock('POST', '/api/settings/plugins/toggle', { key: 'mcp:demo', on: false });
  assert.equal(find()?.on, false);
  answerMock('POST', '/api/settings/plugins/mcp/remove', { name: 'demo' });
  assert.equal(find(), undefined);
});

test('the marketplace reads as not there, and installing says the CLI is missing', () => {
  assert.equal((answerMock('GET', '/api/settings/plugins/market').body as { error: string }).error, 'no_marketplace');
  assert.equal((answerMock('POST', '/api/settings/plugins/market/install', { name: 'x' }).body as { error: string }).error, 'no_cli');
});
