// Claude's Recipes tools, as one in-process MCP server (claudeos_recipes) that turns.ts adds to each session.
// Read-only: recipes whose name matches a search, and one recipe in full, from TheMealDB (the same reads the Recipes app makes,
// search in index.ts). Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { search } from './index.ts';
import type { MealsResult } from '../api.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** The recipes_search reply: up to count recipes, each as "Name (tag): main ingredients". read defaults to the Recipes search. */
export async function recipesSearchReply({ q, count }: { q?: string; count?: number }, read: (q: string) => Promise<MealsResult> = search) {
  let r;
  try { r = await read(q ?? ''); } catch { return text('The recipes couldn’t be read just now. Try again in a little while.', true); }
  if (r.status === 'error') return text('The recipes couldn’t be read just now. Try again in a little while.', true);
  if (!r.recipes.length) return text(`No recipes match “${q ?? ''}”.`, true);
  const n = Math.min(count ?? 5, r.recipes.length);
  return text(r.recipes.slice(0, n).map(rc => {
    const items = rc.ingredients.slice(0, 6).map(i => i.item).join(', ');
    return `${rc.name}${rc.tag ? ` (${rc.tag})` : ''}: ${items || 'no ingredients listed'}`;
  }).join('\n'));
}

/** The recipes_get reply: one recipe by its name (an exact name first, else the first match), with every ingredient and its numbered method. */
export async function recipesGetReply({ name }: { name: string }, read: (q: string) => Promise<MealsResult> = search) {
  let r;
  try { r = await read(name); } catch { return text('The recipes couldn’t be read just now. Try again in a little while.', true); }
  if (r.status === 'error') return text('The recipes couldn’t be read just now. Try again in a little while.', true);
  const want = name.trim().toLowerCase();
  const rc = r.recipes.find(x => x.name.trim().toLowerCase() === want) ?? r.recipes[0];
  if (!rc) return text(`No recipe matches “${name}”.`, true);
  const facts = [rc.serves ? `serves ${rc.serves}` : '', rc.time].filter(Boolean).join(', ');
  const items = rc.ingredients.map(i => `${i.amount ? `${i.amount} ` : ''}${i.item}`).join('; ') || 'no ingredients listed';
  const steps = rc.steps.length ? rc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No method is listed.';
  return text(`${rc.name}${facts ? ` (${facts})` : ''}\nIngredients: ${items}.\nMethod:\n${steps}`);
}

export const recipesServer = createSdkMcpServer({
  name: 'claudeos_recipes',
  version: '1.0.0',
  tools: [
    tool('recipes_search',
      'Search recipes on the ClaudeOS Recipes app (TheMealDB) by name, e.g. "lasagne". Read-only. Each recipe comes as its name, its tag '
        + '(for example "Italian · Pasta") and its main ingredients. q: the name to search; empty gives random ideas. '
        + 'count: how many, 1 to 10 (the default is 5).',
      { q: z.string().max(60).optional(), count: z.number().int().min(1).max(10).optional() },
      (args) => recipesSearchReply(args)),
    tool('recipes_get',
      'Get one recipe from the ClaudeOS Recipes app (TheMealDB) by its name, with every ingredient and its numbered method. Read-only. '
        + 'Use it after recipes_search, to say how to cook a dish.',
      { name: z.string().min(1).max(60) },
      (args) => recipesGetReply(args)),
  ],
});
