// Recipes in the mock page (no hub): one sample recipe for search and random, a short ingredient list, and a
// pantry match, so the app shows a recipe with the hub stopped. The shapes are the ones in ../api.ts and web/recipe.ts.
// The recipe is made up.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { IngredientsResult, MealsResult, PantryResult } from '../api.ts';
import type { Recipe } from '../web/recipe.ts';

const recipe: Recipe = {
  name: 'Sample pasta',
  serves: '2',
  time: '20 min',
  ingredients: [
    { amount: '200 g', item: 'pasta' },
    { amount: '1', item: 'onion' },
    { amount: '2 tbsp', item: 'olive oil' },
  ],
  steps: ['Boil the pasta in salted water.', 'Fry the onion in the oil until soft.', 'Toss the pasta with the onion and serve.'],
  tag: 'Sample · Pasta',
};

defineMock({
  'GET /api/recipes/search': (): MealsResult => ({ status: 'ok', recipes: [recipe] }),
  'GET /api/recipes/random': (): Recipe => recipe,
  'GET /api/recipes/ingredients': (): IngredientsResult => ({ status: 'ok', names: ['olive oil', 'onion', 'pasta'] }),
  'GET /api/recipes/pantry': (): PantryResult => ({
    status: 'ok',
    recipes: [{ ...recipe, missing: [], matched: 3 }],
  }),
});
