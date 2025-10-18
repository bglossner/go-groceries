import { z } from 'zod';
import { ingredientSchema } from './ingredients';
export const mealFormSchema = z.object({
    name: z.string().min(1, 'Meal name is required').transform(name => name.trim()),
    ingredients: z.array(ingredientSchema).transform((ingredients) => {
        return ingredients.filter(ing => ing.name && ing.name.trim() !== '');
    }).refine((ingredients) => ingredients.length > 0, 'Must have at least 1 ingredient'),
    tags: z.array(z.object({ id: z.number().optional(), name: z.string() })).optional(),
});
