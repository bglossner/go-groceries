import type { Meal, MealImage, Recipe, RecipeImage } from './db';

type MealRecipeImage = Extract<MealImage, { type: 'recipeImage' }>;
export type RecipeImageIssue = 'no_owning_recipe' | 'multiple_owning_recipes' |
  'recipe_id_meal_id_mismatch' | 'image_index_out_of_range';

// The old editor stored the meal id instead of the recipe id. Ownership must be unique
// even for an explicit reference: neither migration nor rendering guesses between recipes.
export const resolveMealRecipeImage = (mealId: number | undefined, image: MealRecipeImage, recipes: Recipe[]):
  { status: 'resolved'; recipe: Recipe } | { status: 'blocked'; issue: RecipeImageIssue } => {
  const owned = recipes.filter(recipe => recipe.mealId === mealId);
  if (!owned.length) return { status: 'blocked', issue: 'no_owning_recipe' };
  if (owned.length !== 1) return { status: 'blocked', issue: 'multiple_owning_recipes' };
  const recipe = owned[0];
  if (recipe.id === undefined || (image.recipeId !== recipe.id && image.recipeId !== mealId)) {
    return { status: 'blocked', issue: 'recipe_id_meal_id_mismatch' };
  }
  if (!Number.isInteger(image.imageIndex) || image.imageIndex < 0 || !Array.isArray(recipe.images) ||
      image.imageIndex >= recipe.images.length || recipe.images[image.imageIndex] === undefined) {
    return { status: 'blocked', issue: 'image_index_out_of_range' };
  }
  return { status: 'resolved', recipe };
};

export const mealThumbnail = (meal: Meal, recipes: Recipe[] | undefined): RecipeImage | undefined => {
  const image = meal.images?.find(image => image.isThumbnail);
  if (!image) return;
  if (image.type === 'url') return image.url;
  if (image.type === 'file') return image.file;
  if (image.type === 'asset') return image;
  const resolved = resolveMealRecipeImage(meal.id, image, recipes ?? []);
  return resolved.status === 'resolved' ? resolved.recipe.images[image.imageIndex] : undefined;
};
