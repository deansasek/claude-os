// Shapes of the Recipes app's server answers. Imported by both sides.
import type { Recipe } from './web/recipe.ts';

export type MealsResult =
  | { status: 'ok'; recipes: Recipe[] }
  | { status: 'error'; recipes: Recipe[]; error: string };
