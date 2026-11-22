// Claude's Routines tool, as one in-process MCP server (claudeos_routines) that turns.ts adds to each session.
// run_routine is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first. The
// routine is looked up here (server/store.ts) and sent to the tablet through the same relay as the tablet tools
// (claude/server/browser.ts sendJob); the tablet runs its steps (web/run.ts) and answers once it has started.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sendJob } from '../../claude/server/browser.ts';
import { stepLabel } from '../api.ts';
import { routineByName } from './store.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

export const routinesServer = createSdkMcpServer({
  name: 'claudeos_routines',
  version: '1.0.0',
  tools: [
    tool('run_routine',
      'Run one of the user’s routines on the ClaudeOS tablet, by its name (e.g. "Good morning"). A routine is a short list of steps '
        + 'the user set up in the Routines app: say the weather, read today’s calendar, speak a line, set a Home scene, start a timer, pause. '
        + 'The tablet runs the steps aloud, in order; this returns once it has started. Give a wrong name to get the list of routines.',
      { name: z.string().max(80) },
      async ({ name }) => {
        const r = await routineByName(name);
        if (r.error) return text(r.error, true);
        if (!r.routine) {
          const names = r.all.map(x => x.name).join(', ');
          return text(`There’s no routine called “${name}”. ${names ? `The routines are: ${names}.` : 'There are no routines yet.'}`, true);
        }
        const a = await sendJob({ op: 'routine', args: { routine: r.routine } });
        if (!a.ok) return text(a.data || 'The tablet couldn’t run that routine.', true);
        return text(`${a.data || `Started ${r.routine.name}.`} Steps: ${r.routine.steps.map(s => stepLabel(s)).join('; ')}.`);
      }),
  ],
});
