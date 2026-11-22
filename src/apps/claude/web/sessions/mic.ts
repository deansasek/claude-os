// The composer's microphone button (#svMic, class "voice") — a hook for voice input.
//
// This file does not do voice itself. The voice feature takes the button over with:
//
//   import { setMicHandler } from './sessions/mic.ts';
//   setMicHandler(target => { … start listening; target says where the words should go … });
//
// `target` is what the composer is pointed at when the mic is tapped:
//   { kind: 'session', sessionId }  → a reply to the open session (only offered when it can take one)
//   { kind: 'new', projectId }      → the first message of a new session in that folder
// Call setMicHandler(null) to hand the button back. Call refreshMic() if availability changes.
//
// With no handler set, the button shows only when the tablet app has voice (core `voice.available`,
// i.e. window.HubDevice.voiceListen exists); tapping it then calls voice.listen(), and what you
// say arrives as the usual 'final' voice event (handled by voice.ts). Elsewhere it stays hidden.
import { voice } from '../../../../core/web/device.ts';

export type MicTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; projectId: string | null };
type MicHandler = (target: MicTarget) => void;

let handler: MicHandler | null = null;
let repaint: () => void = () => {};

export function setMicHandler(fn: MicHandler | null): void { handler = fn; repaint(); }
const refreshMic = (): void => repaint();

/** Is there anything for the mic button to do on this device? */
export const micAvailable = (): boolean => !!handler || voice.available;

/** Tapped: give it to the handler, or just start listening on the tablet. */
export function micTap(target: MicTarget): void {
  if (handler) { handler(target); return; }
  if (voice.available) { try { voice.listen(8000); } catch { /* no microphone permission */ } }
}

/** Internal: the screen registers how to repaint the button when availability changes. */
export function onMicChange(fn: () => void): void { repaint = fn; }
