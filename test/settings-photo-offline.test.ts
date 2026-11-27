// The profile photo sheet must blame the connection when the PC cannot be reached, and the photo only
// when the tablet cannot read it (src/apps/settings/web/index.ts, usePhoto, photoErrorText).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const CONNECTION = 'Check the connection to your PC, then try again.';
const PHOTO = 'Try another photo, or try again.';

type Answer = { json: () => Promise<unknown> };
type Setup = {
  decodeFails?: boolean;     // the tablet cannot decode the photo
  blobFails?: boolean;       // the canvas gives no JPEG
  fetchThrows?: boolean;     // the PC cannot be reached
  answer?: unknown;          // the parsed JSON answer
  badJson?: boolean;         // the answer is not JSON
};

// Load usePhoto and photoErrorText from the source, with stubs for the page globals.
function loadUsePhoto(setup: Setup) {
  const start = src.indexOf('function photoErrorText(error: unknown): string {');
  const mid = src.indexOf('\n}\n', start) + 3;
  const usePhotoStart = src.indexOf('async function usePhoto(url: string): Promise<void> {');
  const usePhotoEnd = src.indexOf('\n}\n', usePhotoStart) + 3;
  const code = stripTypeScriptTypes(`${src.slice(start, mid)}\n${src.slice(usePhotoStart, usePhotoEnd)}`);

  const calls = { sheet: [] as [string, string][], applied: [] as unknown[], reported: [] as string[], fetched: 0 };
  const sheet = { hidden: false };
  class FakeImage {
    naturalWidth = 400;
    naturalHeight = 300;
    src = '';
    async decode(): Promise<void> { if (setup.decodeFails) throw new Error('decode'); }
  }
  const doc = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toBlob: (cb: (b: unknown) => void) => cb(setup.blobFails ? null : { size: 1 }),
    }),
  };
  const fakeFetch = async (): Promise<Answer> => {
    calls.fetched += 1;
    if (setup.fetchThrows) throw new TypeError('fetch failed');
    return {
      json: async () => {
        if (setup.badJson) throw new SyntaxError('Unexpected token <');
        return setup.answer;
      },
    };
  };
  const confirmSheet = (title: string, body: string) => { calls.sheet.push([title, body]); };
  const applyProfile = (p: unknown) => { calls.applied.push(p); };
  const report = (id: string) => { calls.reported.push(id); };
  const dollar = (id: string) => { assert.equal(id, 'stPhotoSheet'); return sheet; };

  const usePhoto = new Function('$', 'Image', 'document', 'fetch', 'confirmSheet', 'applyProfile', 'report',
    `let photoSheetSeq = 0;\n${code}\nreturn usePhoto;`)(dollar, FakeImage, doc, fakeFetch, confirmSheet, applyProfile, report) as (url: string) => Promise<void>;
  return { usePhoto, calls, sheet };
}

test('usePhoto says Try another photo when the tablet cannot decode the photo', async () => {
  const { usePhoto, calls, sheet } = loadUsePhoto({ decodeFails: true });
  await usePhoto('/thumb/1');
  assert.equal(sheet.hidden, true);
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', PHOTO]]);
  assert.equal(calls.fetched, 0);
});

test('usePhoto says Try another photo when the canvas gives no JPEG', async () => {
  const { usePhoto, calls } = loadUsePhoto({ blobFails: true });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', PHOTO]]);
  assert.equal(calls.fetched, 0);
});

test('usePhoto says Check the connection when the fetch throws', async () => {
  const { usePhoto, calls } = loadUsePhoto({ fetchThrows: true });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', CONNECTION]]);
  assert.deepEqual(calls.applied, []);
});

test('usePhoto says Check the connection when the answer is not JSON', async () => {
  const { usePhoto, calls } = loadUsePhoto({ badJson: true });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', CONNECTION]]);
});

test('usePhoto maps the PC error codes to plain sentences', async () => {
  const cases: [string, string][] = [
    ['too_big', 'That photo is too big. Try another photo.'],
    ['not_jpeg', 'That photo isn’t a JPEG. Try another photo.'],
    ['no_photo', 'No photo reached your PC. Try again.'],
  ];
  for (const [error, text] of cases) {
    const { usePhoto, calls } = loadUsePhoto({ answer: { ok: false, error } });
    await usePhoto('/thumb/1');
    assert.deepEqual(calls.sheet, [['Couldn’t use that photo', text]], error);
    assert.doesNotMatch(calls.sheet[0][1], new RegExp(error));
  }
});

test('usePhoto shows any other PC error text as it is', async () => {
  const { usePhoto, calls } = loadUsePhoto({ answer: { ok: false, error: 'A profile photo can’t be saved on the mock page.' } });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', 'A profile photo can’t be saved on the mock page.']]);
});

test('usePhoto shows Try another photo when the PC gives no reason', async () => {
  const { usePhoto, calls } = loadUsePhoto({ answer: { ok: false } });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.sheet, [['Couldn’t use that photo', PHOTO]]);
});

test('usePhoto applies the profile and shows no sheet when the PC saves the photo', async () => {
  const profile = { name: 'Dean', photoAt: 1 };
  const { usePhoto, calls, sheet } = loadUsePhoto({ answer: { ok: true, profile } });
  await usePhoto('/thumb/1');
  assert.deepEqual(calls.applied, [profile]);
  assert.deepEqual(calls.reported, ['settings:profile:photo']);
  assert.deepEqual(calls.sheet, []);
  assert.equal(sheet.hidden, true);
});

test('usePhoto uses the saveProfile connection wording', () => {
  const body = src.slice(src.indexOf('async function usePhoto(url: string): Promise<void> {'), src.indexOf('async function removePhoto'));
  const saveBody = src.slice(src.indexOf('async function saveProfile('), src.indexOf('function paintRoles'));
  assert.ok(saveBody.includes(`'${CONNECTION}'`));
  assert.ok(body.includes(`'${CONNECTION}'`));
});

// Load removePhoto from the source, with stubs for postJson and the page's sheet and profile calls.
function loadRemovePhoto(setup: { throws?: boolean; answer?: unknown }) {
  const start = src.indexOf('async function removePhoto(): Promise<void> {');
  const end = src.indexOf('\n}\n', start) + 3;
  const code = stripTypeScriptTypes(src.slice(start, end));

  const calls = { sheet: [] as [string, string][], applied: [] as unknown[], reported: [] as string[] };
  const postJson = async (url: string): Promise<unknown> => {
    assert.equal(url, '/api/settings/photo/remove');
    if (setup.throws) throw new TypeError('fetch failed');
    return setup.answer;
  };
  const confirmSheet = (title: string, body: string) => { calls.sheet.push([title, body]); };
  const applyProfile = (p: unknown) => { calls.applied.push(p); };
  const report = (id: string) => { calls.reported.push(id); };

  const removePhoto = new Function('postJson', 'confirmSheet', 'applyProfile', 'report',
    `${code}\nreturn removePhoto;`)(postJson, confirmSheet, applyProfile, report) as () => Promise<void>;
  return { removePhoto, calls };
}

test('removePhoto applies no profile and shows the PC reason when the PC says no', async () => {
  const { removePhoto, calls } = loadRemovePhoto({ answer: { ok: false, error: 'The photo is still in use.' } });
  await removePhoto();
  assert.deepEqual(calls.sheet, [['Couldn’t remove it', 'The photo is still in use.']]);
  assert.deepEqual(calls.applied, []);
  assert.deepEqual(calls.reported, []);
});

test('removePhoto says Try again when the PC gives no reason', async () => {
  for (const answer of [{ ok: true }, { ok: false }, null]) {
    const { removePhoto, calls } = loadRemovePhoto({ answer });
    await removePhoto();
    assert.deepEqual(calls.sheet, [['Couldn’t remove it', 'The PC did not remove the photo. Try again.']], JSON.stringify(answer));
    assert.deepEqual(calls.applied, []);
  }
});

test('removePhoto says Check the connection when the fetch throws', async () => {
  const { removePhoto, calls } = loadRemovePhoto({ throws: true });
  await removePhoto();
  assert.deepEqual(calls.sheet, [['Couldn’t remove it', CONNECTION]]);
  assert.deepEqual(calls.applied, []);
  assert.deepEqual(calls.reported, []);
});

test('removePhoto applies the full profile the PC returns', async () => {
  const profile = { name: 'Dean', nickname: 'D', role: '', photoAt: 0 };
  const { removePhoto, calls } = loadRemovePhoto({ answer: profile });
  await removePhoto();
  assert.deepEqual(calls.applied, [profile]);
  assert.deepEqual(calls.reported, ['settings:profile:photo:remove']);
  assert.deepEqual(calls.sheet, []);
});
