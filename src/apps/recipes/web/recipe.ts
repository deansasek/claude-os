// Recipes: the recipe shape, the fixed prompt for Claude, reading a recipe out of Claude's reply, and the text of one
// cook-mode step. Pure functions: no DOM, no store. Tested in test/recipes.test.ts.

export interface Ingredient { amount: string; item: string }

export interface Recipe {
  name: string;
  serves: string;          // "4", "4 people"; empty when unknown
  time: string;            // "40 min"; empty when unknown
  ingredients: Ingredient[];
  steps: string[];
  image?: string;          // https photo address (TheMealDB recipes); absent for Claude's recipes
  mealId?: string;         // TheMealDB id; absent for Claude's recipes
  tag?: string;            // "Italian · Pasta"; absent when unknown
}

/** The fixed request sent to the tablet's Claude chat. It carries no private data. */
export const RECIPE_PROMPT = [
  'Give me one recipe. Reply with the recipe as JSON only, in one code block, with exactly these keys:',
  '"name" (text), "serves" (how many people), "time" (total time, like "40 min"),',
  '"ingredients" (a list of objects, each with "amount" and "item"), and "steps" (a list of short text steps, in order).',
  'Write no other text.',
].join(' ');

/** The JSON value in a reply: a fenced code block first, else the text from the first "{" to the last "}". */
export function extractJson(reply: string): unknown {
  const candidates: string[] = [];
  const fence = reply.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(reply.slice(start, end + 1));
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try the next candidate */ }
  }
  return undefined;
}

const clean = (v: unknown, max: number): string => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
};

/** A parsed JSON value as a recipe, or null when it has no name or no steps. */
export function toRecipe(v: any): Recipe | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const name = clean(v.name, 80);
  const steps = (Array.isArray(v.steps) ? v.steps : [])
    .map((s: any) => clean(s && typeof s === 'object' ? (s.text ?? s.step) : s, 400))
    .filter(Boolean)
    .slice(0, 60);
  if (!name || steps.length === 0) return null;
  const ingredients: Ingredient[] = (Array.isArray(v.ingredients) ? v.ingredients : []).flatMap((i: any): Ingredient[] => {
    if (typeof i === 'string') {
      const item = clean(i, 120);
      return item ? [{ amount: '', item }] : [];
    }
    if (i && typeof i === 'object') {
      const item = clean(i.item ?? i.name ?? i.ingredient, 120);
      return item ? [{ amount: clean(i.amount ?? i.quantity, 40), item }] : [];
    }
    return [];
  }).slice(0, 80);
  return { name, serves: clean(v.serves, 20), time: clean(v.time, 40), ingredients, steps };
}

/** A recipe read back from the store or the hub: toRecipe, plus the photo, the TheMealDB id and the tag when valid. */
export function fromStored(v: any): Recipe | null {
  const r = toRecipe(v);
  if (!r) return null;
  const image = typeof v.image === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/.test(v.image) ? v.image : '';
  const mealId = typeof v.mealId === 'string' && /^\d{1,12}$/.test(v.mealId) ? v.mealId : '';
  const tag = clean(v.tag, 60);
  return { ...r, ...(image ? { image } : {}), ...(mealId ? { mealId } : {}), ...(tag ? { tag } : {}) };
}

export type Parsed = { ok: true; recipe: Recipe } | { ok: false };

/** Reads a recipe from Claude's reply. Code fences and text around the JSON are tolerated. */
export function parseRecipe(reply: string): Parsed {
  const recipe = toRecipe(extractJson(reply));
  return recipe ? { ok: true, recipe } : { ok: false };
}

/** A reply that is not a recipe, saved as it is: the first line is the name, the whole text is one step. */
export function textRecipe(reply: string): Recipe {
  const first = reply.split('\n').map(l => l.replace(/^[#*\s>-]+/, '').trim()).find(Boolean) ?? '';
  return {
    name: first.slice(0, 60) || 'Saved reply',
    serves: '',
    time: '',
    ingredients: [],
    steps: [reply.trim().slice(0, 4000) || 'No text.'],
  };
}

/** A count with its noun: "1 step", "2 steps", "0 ingredients". `word` is the singular form. */
export function countWord(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** The text of one cook-mode step. The step number is clamped to the recipe's steps. */
export function cookStep(r: Recipe, i: number): { heading: string; text: string; index: number; first: boolean; last: boolean } {
  const total = r.steps.length;
  const index = Math.min(Math.max(0, Math.floor(i) || 0), total - 1);
  return { heading: `Step ${index + 1} of ${total}`, text: r.steps[index], index, first: index === 0, last: index === total - 1 };
}

// ---------- Claude on top: Adapt with Claude and Suggest for tonight ----------
/** The reply format: the same words RECIPE_PROMPT uses, so parseRecipe reads every reply the same way. */
const FORMAT = RECIPE_PROMPT.replace('Give me one recipe. ', '');

/** The adapted recipe keeps the photo of the recipe it changes. Only the photo: the TheMealDB id would mark it as TheMealDB's. */
export function keepPhoto(adapted: Recipe, source: string | undefined): Recipe {
  return source ? { ...adapted, image: source } : adapted;
}

/** Asks Claude to change a recipe. The recipe goes as JSON without its photo address or id. */
export function adaptPrompt(r: Recipe, change: string): string {
  const plain = { name: r.name, serves: r.serves, time: r.time, ingredients: r.ingredients, steps: r.steps };
  const want = change.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Make it simpler';
  return `Change this recipe: ${want}. The recipe: ${JSON.stringify(plain)} ${FORMAT}`;
}

/** Asks Claude for one dinner tonight, from the names of the saved recipes and the time the user has ('' for no limit). */
export function tonightPrompt(names: string[], time: string): string {
  const limit = time ? ` It must take ${time} or less in total.` : '';
  const saved = names.length
    ? ` My saved recipes are: ${names.slice(0, 30).map(n => n.slice(0, 60)).join('; ')}. Pick one of them or something close to them.`
    : '';
  return `Suggest one dinner for tonight.${limit}${saved} ${FORMAT}`;
}

/** Asks Claude for one recipe from the "have" names: it uses mostly those. The "want" names and the staples may appear too. */
export function pantryPrompt(have: string[], want: string[]): string {
  const list = (xs: string[]): string => xs.map(x => x.replace(/["\\]/g, '').slice(0, 40)).join(', ');
  const buy = want.length ? ` I can also buy: ${list(want)}. The recipe may use them.` : '';
  return `Give me one recipe that uses mostly these ingredients I have: ${list(have)}.${buy}`
    + ` Salt, pepper, water and oil are always fine to use. ${FORMAT}`;
}

// ---------- the recipe of the day ----------
/** The index of today's recipe among `count` saved ones (it changes at local midnight), or -1 when none are saved. */
export function recipeOfDay(count: number, now: Date): number {
  if (count <= 0) return -1;
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
  return day % count;
}

/** The glance line: today's saved recipe, or "Find a recipe" when nothing is saved. */
export function recipeGlance(list: Recipe[], now: Date): string {
  const i = recipeOfDay(list.length, now);
  return i < 0 ? 'Find a recipe' : list[i].name;
}
