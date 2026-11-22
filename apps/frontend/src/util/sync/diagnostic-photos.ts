import type { Snapshot, SnapshotMealImage } from '../../shareable/snapshot';
import type { ImageMimeType } from '../../shareable/image-assets';
import { readImageDimensions, sniffImageType } from './image-container';
import { declaredImageTypes, safePhotoName, type DiagnosticImage, type ImageOwner, type PhotoKind } from './diagnostics-model';

export type ObservedImage = { detected?: ImageMimeType; width?: number; height?: number };

export function photoAttribution(data: Snapshot['data'], pass: string) {
  const { tables } = data;
  const meals = new Map(tables.meals.map(meal => [meal.id, meal]));
  const pending = new Map(tables.meals.map(meal => [meal.pendingRecipeId, meal.name]));
  const recipes = new Map(tables.recipes.map(recipe => [recipe.id, recipe]));
  const firstRecipe = new Map<number, number>();
  for (const recipe of tables.recipes) {
    firstRecipe.set(recipe.mealId, Math.min(recipe.id, firstRecipe.get(recipe.mealId) ?? recipe.id));
  }
  const owners = new Map<string, ImageOwner>();
  function add(images: SnapshotMealImage[] | undefined, kind: PhotoKind, title?: string, mealId?: number) {
    const name = safePhotoName(title, pass);
    for (const ref of images ?? []) {
      const image = ref.kind === 'recipeImage' && mealId !== undefined && firstRecipe.get(mealId) === ref.recipeId
        ? recipes.get(ref.recipeId)?.images[ref.imageIndex] : ref;
      if (image?.kind !== 'asset') continue;
      const existing = owners.get(image.assetId);
      if (existing) {
        existing.additional = (existing.additional ?? 0) + 1;
        if (!existing.name && name) Object.assign(existing, { kind, name });
      } else owners.set(image.assetId, { kind, name });
    }
  }
  for (const meal of tables.meals) add(meal.images, 'meal', meal.name, meal.id);
  for (const recipe of tables.recipes) add(recipe.images, 'recipe', meals.get(recipe.mealId)?.name);
  for (const recipe of tables.pendingRecipes) add(recipe.images, 'draft recipe', pending.get(recipe.id));
  if (data.schemaVersion === 16) {
    for (const restaurant of data.tables.restaurants) add(restaurant.menuImages, 'restaurant', restaurant.name);
    for (const item of data.tables.restaurantItems) add(item.images, 'menu item', item.name);
  }
  return owners;
}

export function diagnosticImage(index: number, total: number, source: { mimeType: string; byteLength: number },
  owner?: ImageOwner, observed?: ObservedImage): DiagnosticImage {
  const { mimeType, byteLength } = source;
  const declared = declaredImageTypes.find(type => type === mimeType);
  return { index, total, declared, owner, detected: observed?.detected, width: safeMeasure(observed?.width),
    height: safeMeasure(observed?.height), bytes: safeMeasure(byteLength) };
}

function safeMeasure(value: number | undefined) {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 2 ** 31 - 1 ? value : undefined;
}

// A resumed publication may lack the current pass's preflight observations.
// Inspect only small local blobs off the upload path, with one reader per run.
export function observeSmallImage(blob: Blob, image: DiagnosticImage) {
  if (!(blob instanceof Blob) || blob.size > 256 * 1024) return;
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    const detected = sniffImageType(bytes);
    if (!detected) return;
    image.detected = detected;
    const { width, height } = readImageDimensions(bytes, detected);
    image.width = safeMeasure(width);
    image.height = safeMeasure(height);
  }).catch(() => undefined);
}
