import { z } from 'zod';
import { IMAGE_LIMITS, IMAGE_MIME_TYPES } from '@go-groceries/frontend/image-assets';
import { SNAPSHOT_LIMITS, SNAPSHOT_TABLES } from '@go-groceries/frontend/snapshot';
import type { ImageAsset, ImageUploadInput } from '@go-groceries/frontend/image-assets';
import type { Snapshot } from '@go-groceries/frontend/snapshot';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const uploadInput = z.object({
  sha256: digest, mimeType: z.enum(IMAGE_MIME_TYPES),
  byteLength: z.number().int().min(1).max(IMAGE_LIMITS.byteLength),
}).strict();
export const assetSchema = uploadInput.extend({
  assetId: digest, location: z.object({ provider: z.literal('r2'), key: z.string().max(200) }).strict(),
}).strict();
export const imageKey = (collectionId: string, sha256: string) => `collections/${collectionId}/images/sha256/${sha256}`;
export const snapshotKey = (collectionId: string, snapshotId: string) => `collections/${collectionId}/snapshots/${snapshotId}.json`;
export const headKey = (collectionId: string) => `collections/${collectionId}/latest.json`;
export const stagingKey = (collectionId: string, uploadId: string) => `collections/${collectionId}/staging/${uploadId}`;
export function makeAsset(collectionId: string, input: ImageUploadInput): ImageAsset {
  return { ...input, assetId: input.sha256, location: { provider: 'r2', key: imageKey(collectionId, input.sha256) } };
}

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(256 * 1024);
const date = z.string().max(30).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, 'Expected ISO UTC date');
const externalUrl = z.string().max(4096).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !Array.from(url.searchParams.keys()).some(name => /^x-amz-(signature|credential|security-token|algorithm)$/i.test(name));
  } catch { return false; }
}, 'Expected external HTTP(S) URL without credentials');
const optionalUrl = z.union([z.literal(''), externalUrl]);
const externalRef = z.object({ kind: z.literal('externalUrl'), url: externalUrl }).strict();
const assetRef = z.object({ kind: z.literal('asset'), assetId: digest,
  name: z.string().max(255).optional(), lastModified: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const ref = z.union([externalRef, assetRef]);
const mealRef = z.union([
  externalRef.extend({ isThumbnail: z.boolean().optional() }),
  assetRef.extend({ isThumbnail: z.boolean().optional() }),
  z.object({ kind: z.literal('recipeImage'), recipeId: id, imageIndex: z.number().int().min(0).max(SNAPSHOT_LIMITS.imagesPerRecord - 1),
    isThumbnail: z.boolean().optional() }).strict(),
]);
const ingredient = z.object({ name: z.string().max(4096), quantity: z.number().finite().nonnegative().optional() }).strict();
const rowArray = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(SNAPSHOT_LIMITS.records);
const ids = z.array(id).max(SNAPSHOT_LIMITS.records);
const strings = z.array(z.string().max(4096)).max(SNAPSHOT_LIMITS.records);
const imageRefs = z.array(ref).max(SNAPSHOT_LIMITS.imagesPerRecord);
export const snapshotSchema = z.object({
  format: z.literal('go-groceries-snapshot'), version: z.literal(2), collectionId: uuid, snapshotId: uuid,
  assets: z.array(assetSchema).max(SNAPSHOT_LIMITS.assets),
  data: z.object({ schemaVersion: z.literal(15), adapterVersion: z.literal(1), tables: z.object({
    meals: rowArray(z.object({ id, name: text, recipe: text.optional(), ingredients: rowArray(ingredient),
      tags: ids.optional(), createdAt: date, updatedAt: date, pendingRecipeId: uuid.optional(),
      images: z.array(mealRef).max(SNAPSHOT_LIMITS.imagesPerRecord).optional() }).strict()),
    groceryLists: rowArray(z.object({ id, name: text, meals: ids, customIngredients: rowArray(ingredient).optional(), createdAt: date }).strict()),
    groceryListStates: rowArray(z.object({ id, groceryListId: id, checkedIngredients: strings }).strict()),
    recipes: rowArray(z.object({ id, mealId: id, images: imageRefs, url: optionalUrl, notes: text }).strict()),
    tags: rowArray(z.object({ id, name: text }).strict()),
    customIngredients: rowArray(z.object({ id, name: text, usageCount: z.number().int().nonnegative().optional() }).strict()),
    pendingRecipes: rowArray(z.object({ id: uuid, content: text.optional(), sourceUrl: optionalUrl, createdAt: date, images: imageRefs.optional() }).strict()),
    stores: rowArray(z.object({ id, name: text, color: z.string().max(100).optional() }).strict()),
    ingredientStores: rowArray(z.object({ id, ingredientName: text, storeId: id }).strict()),
  }).strict() }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  const assets = new Set<string>();
  for (const asset of snapshot.assets) {
    if (asset.assetId !== asset.sha256 || asset.location.key !== imageKey(snapshot.collectionId, asset.sha256) || assets.has(asset.assetId)) {
      ctx.addIssue({ code: 'custom', message: 'Noncanonical or duplicate asset' });
    }
    assets.add(asset.assetId);
  }
  let count = 0;
  for (const table of SNAPSHOT_TABLES) {
    const rows = snapshot.data.tables[table];
    count += rows.length;
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate row ID' });
  }
  if (count > SNAPSHOT_LIMITS.records) ctx.addIssue({ code: 'custom', message: 'Too many records' });
  for (const row of [...snapshot.data.tables.meals, ...snapshot.data.tables.recipes, ...snapshot.data.tables.pendingRecipes]) {
    for (const image of row.images ?? []) {
      if (image.kind === 'asset' && !assets.has(image.assetId)) ctx.addIssue({ code: 'custom', message: 'Unregistered asset reference' });
    }
  }
});
export function parseSnapshot(value: unknown): Snapshot { return snapshotSchema.parse(value) as Snapshot; }

/** Canonical JSON makes retry comparison independent of object property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
