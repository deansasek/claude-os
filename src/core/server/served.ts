// The bytes the hub serves for one browser file. Shared by the server (serveStatic in index.ts) and the page bundle
// (scripts/build-page.ts), so both send the same bytes. Keep this module free of side effects: the bundle script imports it.
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Only browser-side code is served from src/: never anything in a server/ folder.
export const WEB_FILE = /^\/src\/(main\.web\.ts|core\/web\/[\w./-]+\.(ts|html)|apps\/[\w-]+\/(web\/[\w./-]+\.ts|view\.html|app\.css|manifest\.ts|api\.ts))$/;

/** A .ts file is stripped to plain JS (the browser gets plain JS); every other file is sent as its bytes. */
export function servedBytes(file: string): Buffer | string {
  return path.extname(file) === '.ts'
    ? stripTypeScriptTypes(fs.readFileSync(file, 'utf8'))
    : fs.readFileSync(file);
}
