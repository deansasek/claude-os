// What a Hub app gives the core server. Each app's routes are mounted under /api/<id>/.

import type { IncomingHttpHeaders } from 'node:http';

export interface RouteRequest {
  query: URLSearchParams;
  body: any;              // parsed JSON for POST, {} otherwise
  raw: Buffer | null;     // the body as bytes, for a route with rawMax (e.g. a JPEG); null otherwise
  headers: IncomingHttpHeaders;
  from: string;           // caller's IP
  signal: AbortSignal;    // aborts when the caller goes away before the answer (a long poll ends early)
}

/** A file to send as it is (not as JSON), e.g. a photo. */
export interface Binary {
  binary: true;
  contentType: string;
  body: Buffer;
  status?: number;
  cache?: string;   // Cache-Control for the response; the default is no-cache
}

export interface Route {
  method: 'GET' | 'POST';
  path: string;           // relative to /api/<id>/, e.g. 'usage'
  rawMax?: number;        // POST only: read the body as raw bytes (up to this many) instead of JSON
  handle(req: RouteRequest): unknown | Promise<unknown>;   // returned value is sent as JSON, or as a Binary
}

export interface ServerApp {
  id: string;
  routes: Route[];
  start?(): void;         // background work: polling, file watching, …
}
