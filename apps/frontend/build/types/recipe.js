import { z } from 'zod';
export const recipeSchema = z.object({
    url: z.string().max(500).optional().or(z.literal('')),
    notes: z.string().max(10000).optional(),
    images: z.array(z.union([z.instanceof(File), z.string()])).max(10).optional(),
});
