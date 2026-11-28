// The Copy last week result stays on screen after the week reloads (src/apps/meals/web/index.ts copyLastWeek).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the copy result is set after the reload, so the reload does not clear it', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const result = added \? `Copied \$\{added\} dinner\$\{added === 1 \? '' : 's'\} from last week\.` : 'Couldn’t copy the dinners\. Try again\.';\s*await load\(c\);\s*setStatus\(c, result\);/);
});
