import type { ImageAsset, ImageRef } from './image-assets';

export const SNAPSHOT_LIMITS = {
  byteLength: 2 * 1024 * 1024,
  assets: 512,
  records: 10000,
  imagesPerRecord: 100,
  shareSeconds: 7 * 24 * 60 * 60,
} as const;
export const SNAPSHOT_TABLES = [
  'meals', 'groceryLists', 'groceryListStates', 'recipes', 'tags',
  'customIngredients', 'pendingRecipes', 'stores', 'ingredientStores',
] as const;
export type SnapshotIngredient = { name: string; quantity?: number };
export type SnapshotMealImage = (
  | ImageRef
  | { kind: 'recipeImage'; recipeId: number; imageIndex: number }
) & { isThumbnail?: boolean };
/** Dates are ISO UTC strings and IDs are explicit; this is not a Dexie export. */
export type SnapshotRows = {
  meals: { id: number; name: string; recipe?: string; ingredients: SnapshotIngredient[];
    tags?: number[]; createdAt: string; updatedAt: string; pendingRecipeId?: string;
    images?: SnapshotMealImage[] }[];
  groceryLists: { id: number; name: string; meals: number[];
    customIngredients?: SnapshotIngredient[]; createdAt: string }[];
  groceryListStates: { id: number; groceryListId: number; checkedIngredients: string[] }[];
  recipes: { id: number; mealId: number; images: ImageRef[]; url: string; notes: string }[];
  tags: { id: number; name: string }[];
  customIngredients: { id: number; name: string; usageCount?: number }[];
  pendingRecipes: { id: string; content?: string; sourceUrl: string;
    createdAt: string; images?: ImageRef[] }[];
  stores: { id: number; name: string; color?: string }[];
  ingredientStores: { id: number; ingredientName: string; storeId: number }[];
};
export type Snapshot = {
  format: 'go-groceries-snapshot';
  version: 2;
  collectionId: string;
  snapshotId: string;
  assets: ImageAsset[];
  data: { schemaVersion: 15; adapterVersion: 1; tables: SnapshotRows };
};
/** revision is an opaque R2 ETag. Null expectedRevision creates the first head. */
export type SnapshotHead = { snapshotId: string; revision: string };
export type SnapshotCommitRequest = { pass: string; snapshot: Snapshot };
export type SnapshotCommitResponse = { collectionId: string; snapshotId: string; key: string };
export type SnapshotPublishRequest = {
  pass: string; collectionId: string; snapshotId: string; expectedRevision: string | null;
};
export type SnapshotPublishResponse = SnapshotHead;
export type SnapshotReadRequest = { pass?: string; collectionId: string; snapshotId: string };
export type SnapshotReadResponse = { snapshot: Snapshot };
export type SnapshotLatestRequest = { pass: string; collectionId: string };
export type SnapshotLatestResponse = SnapshotHead;
export type SnapshotShareRequest = {
  pass: string; collectionId: string; snapshotId: string; expiresIn: number;
};
export type SnapshotShareResponse = {
  collectionId: string; snapshotId: string; shareToken: string; expiresAt: string;
};
