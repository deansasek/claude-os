// Hardware Back in Radio closes Now playing, then goes up one list level, then leaves the app (src/apps/radio/web/index.ts).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('Back closes Now playing first, then goes up one list level, then leaves the app', () => {
  assert.match(src, /import \{ onBack, quietVolumeHud \} from '\.\.\/\.\.\/\.\.\/core\/web\/system\.ts';/);
  assert.match(src, /onBack\(\(\) => \{\s*if \(!ctx\.isVisible\(\)\) return false;\s*if \(nowOpen\) \{ closeNow\(\); return true; \}\s*if \(view\.kind !== 'home'\) \{ back\(\); return true; \}\s*return false;\s*\}, 10\);/);
});
