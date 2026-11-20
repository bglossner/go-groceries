import { z } from 'zod';
import { isAssetRef } from '../db/image-cache';
import type { AssetRef } from '../db/image-cache';

export const recipeSchema = z.object({
  url: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(10000).optional(),
  images: z.array(z.union([z.instanceof(Blob), z.string(), z.custom<AssetRef>(isAssetRef)])).max(10).optional(),
});

export type RecipeForm = z.infer<typeof recipeSchema>;
