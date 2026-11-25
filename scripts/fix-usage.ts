// Write the Claude run usage line to the job summary and to usage-line.txt. Run with Node 22 type stripping:
//   node fix-usage.ts
// Reads $RUNNER_TEMP/claude-execution-output.json. Always exits 0, so a usage line never fails the job.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NO_DATA = 'No usage data was recorded for this run.';
export const FAILED = 'Usage summary could not be written.';

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object';
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v: unknown): string => Math.round(num(v)).toLocaleString('en-US');

/** Return the usage line for the parsed execution output. undefined means no output file. */
export function formatUsage(raw: unknown): { line: string } {
  if (raw === undefined) return { line: NO_DATA };
  try {
    const list: unknown[] = Array.isArray(raw) ? raw : [raw];
    // The last object that has usage (or a cost) wins.
    const r: Obj = [...list].reverse().find((x): x is Obj => isObj(x) && ('usage' in x || 'total_cost_usd' in x)) ?? {};
    const u: Obj = isObj(r.usage) ? r.usage : {};
    const [i, o, cw, cr] = [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(num);
    const cost = num(r.total_cost_usd);
    const denom = i + cw + cr;
    const hit = denom ? Math.round((cr / denom) * 100) : 0;
    return {
      line: `Usage: ${fmt(i + o + cw + cr)} tokens (input ${fmt(i)}, output ${fmt(o)}, cache written ${fmt(cw)}, cache read ${fmt(cr)}, ${hit}% cache hit) · ${fmt(r.num_turns)} turn(s) · $${cost.toFixed(2)}`,
    };
  } catch {
    return { line: FAILED };
  }
}

function main(): void {
  let line: string;
  try {
    const file = join(process.env.RUNNER_TEMP || '', 'claude-execution-output.json');
    line = formatUsage(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined).line;
  } catch {
    line = FAILED;
  }
  // Also keep the line for the Claude comment step. Never fail here.
  if (process.env.RUNNER_TEMP) {
    try { writeFileSync(join(process.env.RUNNER_TEMP, 'usage-line.txt'), line + '\n'); } catch {}
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
  else console.log(line);
}

// Run only as a script. Tests import this file and skip main().
if (process.argv[1]?.endsWith('fix-usage.ts')) {
  try {
    main();
  } catch {
    // Ignored on purpose: the usage step never fails the job.
  }
  process.exit(0);
}
