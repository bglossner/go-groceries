import { db } from '../db/db';

export class CustomIngredientInUse extends Error {
  constructor() {
    super('This ingredient is still used in a saved grocery list or meal.');
  }
}

export function deleteCustomIngredient(name: string) {
  return db.transaction('rw', [db.customIngredients, db.ingredientStores, db.groceryLists, db.meals], async () => {
    const catalogEntries = db.customIngredients.filter(row => row.name.toLowerCase() === name);
    if (!(await catalogEntries.count())) throw new Error('Custom ingredient no longer exists');

    const meal = await db.meals.filter(row =>
      row.ingredients.some(ingredient => ingredient.name.toLowerCase() === name),
    ).first();
    const list = await db.groceryLists.filter(row =>
      row.customIngredients?.some(ingredient => ingredient.name.toLowerCase() === name) ?? false,
    ).first();
    if (meal || list) throw new CustomIngredientInUse();

    await db.ingredientStores.filter(link => link.ingredientName.toLowerCase() === name).delete();
    await catalogEntries.delete();
  });
}
