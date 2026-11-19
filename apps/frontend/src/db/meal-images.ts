import type { Meal, Recipe, RecipeImage } from './db';

// Resolve only unambiguous references. Legacy ambiguous descriptors remain stored for recovery.
export const mealThumbnail = (meal: Meal, recipes: Recipe[] | undefined): RecipeImage | undefined => {
  const image = meal.images?.find(image => image.isThumbnail);
  if (!image) return;
  if (image.type === 'url') return image.url;
  if (image.type === 'file') return image.file;
  if (image.type === 'asset') return image;
  const owned = recipes?.filter(recipe => recipe.mealId === meal.id);
  const recipe = owned?.find(recipe => recipe.id === image.recipeId);
  if (!recipe || owned?.[0]?.id !== recipe.id) return;
  return recipe.images[image.imageIndex];
};
