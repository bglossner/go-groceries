import { db, type Meal, type PendingRecipe } from './db';
import { normalizeMealImage, normalizePendingImages, normalizeRecipeImages } from './image-cache';

export type GeneratedRecipe = Omit<PendingRecipe, 'createdAt'> & { createRecipe: boolean };

// Prepare verified copies before writing metadata; generation and its meal commit together.
export const saveMeal = async (meal: Meal, generated?: GeneratedRecipe | null): Promise<number> => {
  const normalizedMeal = { ...meal, images: await Promise.all((meal.images ?? []).map(image => normalizeMealImage(image))) };
  const recipeImages = generated?.createRecipe ? await normalizeRecipeImages(generated.images) : undefined;
  const pendingImages = generated && !generated.createRecipe ? await normalizePendingImages(generated.images) : undefined;
  return db.transaction('rw', db.meals, db.recipes, db.pendingRecipes, async () => {
    if (generated && !generated.createRecipe) {
      await db.pendingRecipes.put({ id: generated.id, sourceUrl: generated.sourceUrl,
        content: generated.content, createdAt: meal.updatedAt, images: pendingImages });
      normalizedMeal.pendingRecipeId = generated.id;
    }
    const mealId = meal.id ? await db.meals.put(normalizedMeal) : await db.meals.add(normalizedMeal);
    if (generated?.createRecipe) {
      const recipeId = await db.recipes.add({ mealId: mealId as number, url: generated.sourceUrl,
        notes: generated.content ?? '', images: recipeImages! });
      if (recipeImages?.length === 1 && !normalizedMeal.images.length) {
        await db.meals.update(mealId, { images: [{ type: 'recipeImage', recipeId: recipeId as number,
          imageIndex: 0, isThumbnail: true }] });
      }
    }
    return mealId as number;
  });
};
