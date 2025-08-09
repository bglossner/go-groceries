import Dexie, { type Table } from 'dexie';
import { z } from 'zod';

const quantitySchema = z
  .preprocess((val) => {
    // Convert empty string to undefined
    if (val === '') return undefined;

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

export type Ingredient = z.infer<typeof ingredientSchema>;

export interface Meal {
  id?: number;
  name: string;
  recipe?: string;
  ingredients: Ingredient[];
  tags?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GroceryList {
  id?: number;
  name: string;
  meals: number[];
  customIngredients?: Ingredient[];
  createdAt: Date;
}

export interface GroceryListState {
  id?: number;
  groceryListId: number;
  checkedIngredients: string[];
}

export interface Recipe {
  id?: number;
  mealId: number;
  images: File[];
  url: string;
  notes: string;
}

export interface Tag {
  id?: number;
  name: string;
}

export class MySubClassedDexie extends Dexie {
  meals!: Table<Meal>;
  groceryLists!: Table<GroceryList>;
  groceryListStates!: Table<GroceryListState>;
  recipes!: Table<Recipe>;
  tags!: Table<Tag>;

  constructor() {
    super('groceriesHelper');
    this.version(6).stores({
      meals: '++id, name, createdAt, updatedAt, *tags',
      groceryLists: '++id, name, createdAt',
      groceryListStates: '++id, groceryListId',
      recipes: '++id, mealId',
      tags: '++id, name',
    });
  }
}

export const db = new MySubClassedDexie();