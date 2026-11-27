// The Settings default model and folder reads give up on a PC that does not answer, and a late older repaint does not undo a newer
// folder list (src/apps/settings/web/index.ts paintSessions; src/apps/claude/web/sessions/controls.ts loadModels). The modules talk to
// the tablet at load, so this reads their source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = readFileSync(path.join(root, 'src/apps/settings/web/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const controls = readFileSync(path.join(root, 'src/apps/claude/web/sessions/controls.ts'), 'utf8').replace(/\r\n/g, '\n');
const start = settings.indexOf('async function paintSessions(');
const body = settings.slice(start, settings.indexOf('\n}\n', start));

test('both reads carry a timeout', () => {
  assert.match(settings, /const SESSIONS_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<Project\[\]>\('\/api\/claude\/projects', SESSIONS_TIMEOUT_MS\)/);
  assert.match(controls, /const MODELS_TIMEOUT_MS = 20e3;/);
  assert.match(controls, /getJson<ModelList>\('\/api\/claude\/models', MODELS_TIMEOUT_MS\)/);
});

test('each repaint takes the next number, and both paths drop a repaint that is no longer the newest', () => {
  assert.match(body, /const seq = \+\+foldersSeq;/);
  const guards = body.match(/if \(seq !== foldersSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(body.indexOf('if (seq !== foldersSeq) return;') < body.indexOf('projects = p;'), 'the check comes before the folder list is set');
});
