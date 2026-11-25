// The address that npm run host reports (host/host.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, hostUrl } from '../host/host.ts';

test('hostUrl takes the port and host from the extra arguments first', () => {
  assert.equal(hostUrl(['--port', '8001'], { host: '10.0.0.246', port: 8000 }), 'http://10.0.0.246:8001');
  assert.equal(hostUrl(['--host', '10.0.0.5'], { host: '10.0.0.246', port: 8000 }), 'http://10.0.0.5:8000');
});

test('hostUrl reads config.json when no argument is given', () => {
  assert.equal(hostUrl([], { host: '10.0.0.246', port: 8000 }), 'http://10.0.0.246:8000');
});

test('hostUrl answers on 127.0.0.1 when the server listens on every address', () => {
  assert.equal(hostUrl([], { host: '0.0.0.0', port: 8000 }), 'http://127.0.0.1:8000');
  assert.deepEqual(DEFAULTS, { host: '0.0.0.0', port: 8000 });
});
