// The raw URL that scripts/attach-image.ts prints. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rawUrl } from '../scripts/attach-image.ts';

test('rawUrl pins the file to a commit under the issue folder', () => {
  assert.equal(rawUrl('deansasek/claude-os', 'abc123', '541', 'home.png'),
    'https://raw.githubusercontent.com/deansasek/claude-os/abc123/541/home.png');
});
