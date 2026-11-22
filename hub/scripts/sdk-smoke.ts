// Smoke test for the Agent SDK on a throwaway session (never touches real sessions).
//   node scripts/sdk-smoke.ts <scratch-folder>
// 1) starts a new session there, 2) resumes it by id, 3) asks for a shell command and denies it.
import fs from 'node:fs';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const cwd = process.argv[2];
if (!cwd || !fs.existsSync(cwd)) throw new Error('pass an existing scratch folder');
const MODEL = 'claude-haiku-5-5';   // smallest model: this only checks plumbing

function summarise(m: SDKMessage): string {
  if (m.type === 'assistant') {
    return 'assistant: ' + m.message.content.map(b => b.type === 'text' ? `text(${b.text.slice(0, 60)})` : b.type === 'tool_use' ? `tool_use(${b.name})` : b.type).join(', ');
  }
  if (m.type === 'result') return `result: ${m.subtype} session=${m.session_id}` + ('result' in m ? ` text=${String(m.result).slice(0, 60)}` : '');
  if (m.type === 'system') return `system: ${m.subtype} session=${m.session_id}`;
  return m.type;
}

async function run(label: string, prompt: string, resume?: string) {
  console.log(`\n=== ${label}${resume ? ` (resume ${resume})` : ''}`);
  let session = '';
  const q = query({
    prompt,
    options: {
      cwd, resume, model: MODEL, permissionMode: 'default', maxTurns: 4,
      canUseTool: async (toolName, input, opts) => {
        console.log(`  canUseTool: ${toolName} title=${JSON.stringify(opts.title)} input=${JSON.stringify(input).slice(0, 100)}`);
        return { behavior: 'deny', message: 'Denied by the Hub smoke test.' };
      },
    },
  });
  for await (const m of q) {
    console.log('  ' + summarise(m));
    if ('session_id' in m && m.session_id) session = m.session_id;
  }
  return session;
}

if (process.argv[3]) {   // resume an existing scratch session and ask for something that needs approval
  await run('permission', 'Create a file named hub-approval-test.txt containing the word hello. Then tell me what happened.', process.argv[3]);
} else {
  const first = await run('new session', 'Reply with exactly: hub smoke test one');
  const second = await run('resume', 'Reply with exactly: hub smoke test two', first);
  console.log(`\nsame session id after resume: ${first === second} (${first} → ${second})`);
}
