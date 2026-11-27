// The Weather header pill says "City not found" when the saved city is unknown to the forecast service (src/apps/weather/web/index.ts, paintEmpty).
// The web page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function paintEmpty(): void {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('paintEmpty shows City not found in the pill when the city is not found', () => {
  assert.ok(start > 0, 'paintEmpty exists');
  assert.match(body, /st === 'not_found' \? 'City not found'/);
});

test('paintEmpty keeps Not set up as the pill fallback for no_location', () => {
  assert.match(body, /st === 'not_found' \? 'City not found' : 'Not set up';/);
});

test('paintEmpty gives the warning dot to the City not found pill', () => {
  assert.match(body, /st === 'error' \|\| st === 'not_found' \? 'bad' : ''/);
});

test('paintEmpty does not give the warning dot to no_location', () => {
  const cls = body.match(/wPill'\)\.className = `live \$\{(.+)\}`;/);
  assert.ok(cls, 'pill class expression exists');
  assert.doesNotMatch(cls[1], /no_location/);
});

test('loadWx sets pcDown in its catch when the tablet cannot reach the PC', () => {
  const lstart = src.indexOf('async function loadWx(): Promise<void> {');
  const lbody = src.slice(lstart, src.indexOf('\n}\n', lstart));
  assert.ok(lstart > 0, 'loadWx exists');
  assert.match(lbody, /\} catch \{\n\s+(?:if \(seq !== wxSeq\) return;\n\s+)?pcDown = true;/);
});

test('paintEmpty uses pcDown for the Can’t reach your PC text', () => {
  assert.match(body, /pcDown \? 'Can’t reach your PC'/);
});
