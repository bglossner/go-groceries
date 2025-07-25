import Dexie, { type Table } from 'dexie';
import { z } from 'zod';

export const ingredientSchema = z.object({
  name: z.string().optional().default(''),
  quantity: z.number().min(1, 'Quantity must be at least 1').optional().default(1),
});

export type Ingredient = z.infer<typeof ingredientSchema>;

export interface Meal {
  id?: number;
  name: string;
  recipe?: string;
  ingredients: Ingredient[];
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

export class MySubClassedDexie extends Dexie {
  meals!: Table<Meal>;
  groceryLists!: Table<GroceryList>;
  groceryListStates!: Table<GroceryListState>;

  constructor() {
    super('groceriesHelper');
    this.version(4).stores({
      meals: '++id, name, createdAt, updatedAt',
      groceryLists: '++id, name, createdAt',
      groceryListStates: '++id, groceryListId',
    });
  }
}

export const db = new MySubClassedDexie();