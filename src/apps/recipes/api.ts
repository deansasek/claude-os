// Shapes of the Recipes app's server answers. Imported by both sides.
import type { PantryRecipe } from './web/pantry.ts';
import type { Recipe } from './web/recipe.ts';

export type MealsResult =
  | { status: 'ok'; recipes: Recipe[] }
  | { status: 'error'; recipes: Recipe[]; error: string };

/** The ingredient names TheMealDB knows, A to Z. */
export type IngredientsResult =
  | { status: 'ok'; names: string[] }
  | { status: 'error'; names: string[]; error: string };

/** The recipes that use the "have" names, ranked (web/pantry.ts). */
export type PantryResult =
  | { status: 'ok'; recipes: PantryRecipe[] }
  | { status: 'error'; recipes: PantryRecipe[]; error: string };
