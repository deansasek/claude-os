// A new place or unit in Weather reaches Home and the ambient screen at once (the hub:weather event). Source checks: the pages are DOM code. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = (rel: string): string => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8').replace(/\r\n/g, '\n');

test('a saved place and a saved unit each dispatch hub:weather, and a failed unit save does not', () => {
  const src = read('src/apps/weather/web/index.ts');
  assert.match(src, /appSettingsChanged\(\);\n  dispatchEvent\(new CustomEvent\('hub:weather'\)\);/);
  assert.match(src, /try \{ await sendLocation\(\{ units: u \}\); dispatchEvent\(new CustomEvent\('hub:weather'\)\); \}/);
});

test('Home and the ambient screen reload the forecast when hub:weather arrives', () => {
  assert.match(read('src/apps/home/web/index.ts'), /addEventListener\('hub:weather', \(\) => \{ void loadWeather\(true\); \}\);/);
  assert.match(read('src/core/web/system.ts'), /addEventListener\('hub:weather', \(\) => \{ void loadWeather\(true\); \}\);/);
});
