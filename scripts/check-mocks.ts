// Every feature is mockable (CLAUDE.md): each app route and each Bridge.java method has a mock. This script checks it.
//   - Routes: every { method, path } an app declares in src/apps/<id>/server/ needs a "METHOD /api/<id>/<path>" key in a
//     defineMock table (src/apps/<id>/web/mock.ts or src/core/web/mock.ts).
//   - Bridge: every @JavascriptInterface method in android/src/hub/kiosk/Bridge.java needs a key in the HubDevice
//     object of src/core/web/mock-device.ts.
// A bridge method that only the tablet has (the camera, the browser, app launch) stays listed on purpose. device.ts
// turns a feature on when its method exists (for example typeof api.cameraOpen === 'function'), so a mock for it
// would switch that feature on in the mock page and break the fallback there. Keep those listed.
// newsFetch is one of these: News reads the tablet's own feed when the method exists (news/web/index.ts, nativeHas).
// Gaps that exist today are listed in scripts/mock-gaps.json. A new gap fails the check. A gap that is now mocked
// also fails, so the list shrinks with each mock. Run with: npm run check:mocks. Refresh the list after a mock lands
// (not for a new gap): npm run check:mocks -- --update
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAPS = path.join(ROOT, 'scripts', 'mock-gaps.json');
const UPDATE = process.argv.includes('--update');

interface Gaps { routes: string[]; bridge: string[] }

/** Every file under a folder, recursively, as a path. */
function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map(p => path.join(dir, String(p)))
    .filter(p => p.endsWith('.ts') && fs.statSync(p).isFile());
}

const appIds = fs.readdirSync(path.join(ROOT, 'src', 'apps'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

// Routes an app declares: { method: 'GET', path: 'status' } under src/apps/<id>/server/.
const routes = new Set<string>();
for (const id of appIds) {
  for (const f of files(path.join(ROOT, 'src', 'apps', id, 'server'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/method: '([A-Z]+)', path: '([^']*)'/g)) {
      routes.add(`${m[1]} /api/${id}/${m[2]}`);
    }
  }
}

// Mocked routes: the keys of every defineMock table ("GET /api/<id>/<path>").
const mockedRoutes = new Set<string>();
const isMockFile = (f: string): boolean => /mock.*\.ts$/.test(path.basename(f));
const mockFiles = [path.join(ROOT, 'src', 'core', 'web', 'mock.ts'), ...appIds.flatMap(id => files(path.join(ROOT, 'src', 'apps', id, 'web')).filter(isMockFile))];
for (const f of mockFiles) {
  if (!fs.existsSync(f)) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/'([A-Z]+ \/api\/[^']+)'\s*:/g)) mockedRoutes.add(m[1]);
}

// Bridge methods: public methods after @JavascriptInterface.
const bridgeFile = path.join(ROOT, 'android', 'src', 'hub', 'kiosk', 'Bridge.java');
const bridge = new Set<string>();
for (const m of fs.readFileSync(bridgeFile, 'utf8').matchAll(/@JavascriptInterface\s+public\s+\S+\s+(\w+)\s*\(/g)) bridge.add(m[1]);

// Mocked bridge methods: the keys of the HubDevice object (four-space indent) in mock-device.ts.
const devFile = path.join(ROOT, 'src', 'core', 'web', 'mock-device.ts');
const dev = fs.readFileSync(devFile, 'utf8');
const start = dev.indexOf('const HubDevice = {');
const end = dev.indexOf('\n  };', start);
const mockedBridge = new Set<string>();
for (const m of dev.slice(start, end).matchAll(/^ {4}(\w+)\s*[:(]/gm)) mockedBridge.add(m[1]);

const gapRoutes = [...routes].filter(r => !mockedRoutes.has(r)).sort();
const gapBridge = [...bridge].filter(b => !mockedBridge.has(b)).sort();

if (UPDATE) {
  const out: Gaps = { routes: gapRoutes, bridge: gapBridge };
  fs.writeFileSync(GAPS, JSON.stringify(out, null, 2) + '\n');
  console.log(`mock gaps written: ${gapRoutes.length} routes, ${gapBridge.length} bridge methods`);
  process.exit(0);
}

const allowed: Gaps = JSON.parse(fs.readFileSync(GAPS, 'utf8')) as Gaps;
const problems: string[] = [];
const check = (kind: string, now: string[], listed: string[], known: Set<string>, mocked: Set<string>) => {
  const allow = new Set(listed);
  for (const g of now) if (!allow.has(g)) problems.push(`${kind} has no mock: ${g}`);
  for (const a of listed) {
    if (!known.has(a)) problems.push(`${kind} gap list names something that no longer exists: ${a}`);
    else if (mocked.has(a)) problems.push(`${kind} is now mocked, remove it from scripts/mock-gaps.json: ${a}`);
  }
};
check('route', gapRoutes, allowed.routes, routes, mockedRoutes);
check('bridge method', gapBridge, allowed.bridge, bridge, mockedBridge);

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} mock problem(s). Add a mock in the app's web/mock.ts (or the HubDevice object).`);
  process.exit(1);
}
console.log(`mocks ok: ${routes.size - gapRoutes.length}/${routes.size} routes and ${bridge.size - gapBridge.length}/${bridge.size} bridge methods mocked; ${gapRoutes.length} routes and ${gapBridge.length} bridge methods listed as gaps`);
