import { z } from 'zod';
const quantitySchema = z
    .preprocess((val) => {
    // Convert empty string to undefined
    if (val === '')
        return undefined;
    // Convert string numbers to actual numbers
    if (typeof val === 'string') {
        const num = Number(val);
        return isNaN(num) ? val : num;
    }
    return val;
}, z.union([z.number(), z.undefined()]))
    .refine((val) => val === undefined || val >= 1, {
    message: 'Quantity must be at least 1',
})
    .optional();
export const ingredientSchema = z.object({
    name: z.string().optional().default('').transform((v) => v?.trim()),
    quantity: quantitySchema,
});
