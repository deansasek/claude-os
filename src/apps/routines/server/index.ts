// Routines app routes (all under /api/routines/). Every answer is a RoutinesResult: {ok, routines, error?, id?}.
//   GET  list     all the routines (the two built-ins are made the first time, when there is no file)
//   POST save     {routine} (or the routine itself): {id?, name, phrases, steps}; no id or a new one adds it
//   POST delete   {id}
//   POST restore  {routines}  the tablet's copy, only when the PC has no routines file
// The tablet keeps the routines and sends its changes here (web/sync.ts); Claude's tools change them here too.
// Kept in .routines.json on the PC (server/store.ts), where everything is checked again, scenes against Home.
// Running a routine happens on the tablet (web/run.ts), through the existing routes and the Clock.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { deleteRoutine, readRoutines, restoreRoutines, saveRoutine } from './store.ts';

const b = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' ? body as Record<string, unknown> : {});

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'list', handle: () => readRoutines() },
    { method: 'POST', path: 'save', handle: ({ body }) => saveRoutine('routine' in b(body) ? b(body).routine : body) },
    { method: 'POST', path: 'delete', handle: ({ body }) => deleteRoutine(b(body).id) },
    { method: 'POST', path: 'restore', handle: ({ body }) => restoreRoutines(b(body).routines) },
  ],
};
export default app;
