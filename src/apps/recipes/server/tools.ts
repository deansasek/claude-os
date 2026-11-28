// Claude's Recipes tools, as one in-process MCP server (claudeos_recipes) that turns.ts adds to each session.
// Read-only: recipes whose name matches a search, and one recipe in full, from TheMealDB (the same reads the Recipes app makes,
// search in index.ts). Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pantry, search } from './index.ts';
import type { MealsResult, PantryResult } from '../api.ts';

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

/** The recipes_pantry reply: the recipes that use the ingredients the user has, each with what it is missing (fewest first). read defaults to the Recipes pantry. */
export async function recipesPantryReply({ have, want }: { have: string; want?: string }, read: (h: string, w: string) => Promise<PantryResult> = pantry) {
  let r;
  try { r = await read(have, want ?? ''); } catch { return text('The recipes couldn’t be read just now. Try again in a little while.', true); }
  if (r.status === 'error') return text(r.error, true);
  if (!r.recipes.length) return text('No recipes use those ingredients.', true);
  return text(r.recipes.slice(0, 5).map(rc => `${rc.name}: ${rc.missing.length ? `missing ${rc.missing.join(', ')}` : 'you have everything'}`).join('\n'));
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
    tool('recipes_pantry',
      'Find recipes from the ClaudeOS Recipes app (TheMealDB) that use ingredients the user has. Read-only. have: the ingredients they have, '
        + 'separated by commas, e.g. "chicken, rice". want: optional, ingredients they would like to use, separated by commas. '
        + 'Each recipe comes with what it is missing, the fewest first.',
      { have: z.string().min(1).max(200), want: z.string().max(200).optional() },
      async (args) => recipesPantryReply(args)),
    tool('recipes_get',
      'Get one recipe from the ClaudeOS Recipes app (TheMealDB) by its name, with every ingredient and its numbered method. Read-only. '
        + 'Use it after recipes_search, to say how to cook a dish.',
      { name: z.string().min(1).max(60) },
      (args) => recipesGetReply(args)),
  ],
});
