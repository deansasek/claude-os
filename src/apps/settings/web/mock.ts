// Settings in the mock page (no hub): a session profile and "Your Claude" text that are kept until a reload. The PIN is
// not set, so the lock screen opens straight away, as it does on a PC with no PIN. The routes not covered here
// (the photo, the plugins and the backup) still answer "no mock". The shapes are the ones in settings/api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { PinResult, PinStatus } from '../api.ts';

/** The profile, as core/web/profile.ts has it. */
interface Profile { name: string; nickname: string; role: string; photoAt: number }
const profile: Profile = { name: '', nickname: '', role: '', photoAt: 0 };
let instructions = '';
let welcomed = false;

defineMock({
  'GET /api/settings/profile': (): Profile => ({ ...profile }),
  'POST /api/settings/profile': ({ body }): Profile => {
    const b = (body ?? {}) as Record<string, unknown>;
    for (const k of ['name', 'nickname', 'role'] as const) if (typeof b[k] === 'string') profile[k] = (b[k] as string).slice(0, 60);
    return { ...profile };
  },
  'GET /api/settings/instructions': () => ({ text: instructions }),
  'POST /api/settings/instructions': ({ body }) => {
    instructions = String((body as { text?: unknown } | null)?.text ?? '').slice(0, 2000);
    return { text: instructions };
  },
  'POST /api/settings/welcome': ({ body }) => {
    welcomed = (body as { done?: unknown } | null)?.done !== false;
    return { done: welcomed };
  },
  'GET /api/settings/storage': () => ({ photos: 0 }),
  'GET /api/settings/pin': (): PinStatus => ({ set: false, lockedFor: 0, fingerprint: null }),
  'POST /api/settings/pin/check': (): PinResult => ({ ok: false, error: 'no_pin', lockedFor: 0 }),
  'POST /api/settings/pin': (): PinResult => ({ ok: false, error: 'save_failed', lockedFor: 0 }),
  'POST /api/settings/pin/remove': (): PinResult => ({ ok: false, error: 'no_pin', lockedFor: 0 }),
});
