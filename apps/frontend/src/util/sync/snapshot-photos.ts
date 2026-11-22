import type { ImageRef } from '../../shareable/image-assets';
import type { Snapshot, SnapshotMealImage, SnapshotRows } from '../../shareable/snapshot';
import type { PreparedPhoto } from './image-preflight';

export function photoOwner(kind: string, title?: string) {
  // Labels come from display names only. Remove URL-shaped text and opaque IDs if pasted into a name.
  const name = title?.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/(?:(?:[a-z][a-z\d+.-]*:)?\/\/|www\.|data:|blob:)\S+/gi, '')
    .replace(/\b(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?/gi, '')
    .replace(/\b(?:(?:share|upload|access)[ -]?)?token\s*[:=]\s*\S+|\bBearer\s+\S+|\b(?:pass(?:word)?|secret|api[ -]?key|signature)\s*[:=]\s*\S+/gi, '')
    .replace(/\S*[\\/@?#]\S*|\S+[:=]\S+/g, '')
    .replace(/\b[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\b|\b\d{6,}\b|\b[\w-]{32,}(?:\.[\w-]+)*\b/gi, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return name ? `${kind} “${name}”` : `an untitled ${kind}`;
}

export function photoOwners(data: Snapshot['data']) {
  const { tables } = data;
  const meals = new Map(tables.meals.map(meal => [meal.id, meal]));
  const pendingMeals = new Map(tables.meals.filter(meal => meal.pendingRecipeId).map(meal => [meal.pendingRecipeId, meal.name]));
  const owners = new Map<string, Set<string>>();
  const add = (images: SnapshotMealImage[] | undefined, owner: string) => {
    for (const image of images ?? []) {
      if (image.kind !== 'asset') continue;
      const names = owners.get(image.assetId) ?? new Set<string>();
      names.add(owner);
      owners.set(image.assetId, names);
    }
  };
  for (const meal of tables.meals) add(meal.images, photoOwner('meal', meal.name));
  for (const recipe of tables.recipes) add(recipe.images, photoOwner('recipe', meals.get(recipe.mealId)?.name));
  for (const recipe of tables.pendingRecipes) add(recipe.images, photoOwner('draft recipe', pendingMeals.get(recipe.id)));
  if (data.schemaVersion === 16) {
    for (const entry of data.tables.restaurants) add(entry.menuImages, photoOwner('restaurant', entry.name));
    for (const entry of data.tables.restaurantItems) add(entry.images, photoOwner('menu item', entry.name));
  }
  return owners;
}

export function updatePhotoReferences(tables: SnapshotRows, photos: ReadonlyMap<string, PreparedPhoto>) {
  function replace<T extends ImageRef | SnapshotMealImage>(image: T): T | undefined {
    if (image.kind !== 'asset') return image;
    const photo = photos.get(image.assetId);
    return photo && { ...image, assetId: photo.assetId };
  }
  function remap<T extends ImageRef>(original: T[]) {
    const images: T[] = [];
    const indices = original.map(image => {
      const replacement = replace(image);
      if (replacement === undefined) return undefined;
      return images.push(replacement) - 1;
    });
    return { images, indices };
  }
  const recipeIndices = new Map<number, (number | undefined)[]>();
  const firstRecipe = new Map<number, number>();
  for (const entry of tables.recipes) {
    const { images, indices } = remap(entry.images);
    recipeIndices.set(entry.id, indices);
    firstRecipe.set(entry.mealId, Math.min(entry.id, firstRecipe.get(entry.mealId) ?? entry.id));
    entry.images = images;
  }
  for (const entry of tables.meals) {
    entry.images = entry.images?.flatMap<SnapshotMealImage>(image => {
      if (image.kind === 'recipeImage') {
        const indices = recipeIndices.get(image.recipeId);
        if (image.recipeId !== firstRecipe.get(entry.id) || !indices || !Number.isInteger(image.imageIndex) ||
            image.imageIndex < 0 || image.imageIndex >= indices.length) return [image];
        const imageIndex = indices[image.imageIndex];
        return imageIndex === undefined ? [] : [{ ...image, imageIndex }];
      }
      const replacement = replace(image);
      return replacement ? [replacement] : [];
    });
  }
  for (const entry of tables.pendingRecipes) if (entry.images) entry.images = remap(entry.images).images;
  for (const entry of tables.restaurants) if (entry.menuImages) entry.menuImages = remap(entry.menuImages).images;
  for (const entry of tables.restaurantItems) {
    const { images, indices } = remap(entry.images);
    if (entry.coverImageIndex !== undefined && Number.isInteger(entry.coverImageIndex) &&
        entry.coverImageIndex >= 0 && entry.coverImageIndex < indices.length) {
      entry.coverImageIndex = indices[entry.coverImageIndex];
    }
    entry.images = images;
  }
}
