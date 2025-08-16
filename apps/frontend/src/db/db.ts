import Dexie, { type Table } from 'dexie';
import { type MealRecipeImage } from '../shareable/meals';
import type { Ingredient } from '../types/ingredients';

export interface Meal {
  id?: number;
  name: string;
  recipe?: string;
  ingredients: Ingredient[];
  tags?: number[];
  createdAt: Date;
  updatedAt: Date;
  pendingRecipeId?: string;
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
  images: (File | string)[];
  url: string;
  notes: string;
}

export interface PendingRecipe {
  id: string;      // A UUID generated on the client
  content?: string; // The recipe text from the API
  sourceUrl: string;
  createdAt: Date;
  images?: MealRecipeImage[];
}

export interface Tag {
  id?: number;
  name: string;
}

export interface CustomIngredient {
  id?: number;
  name: string;
  usageCount?: number;
}

export interface GenerateMealDataOutput {
  mealName: string;
  ingredients: Ingredient[];
  recipe: string;
  tags: Tag[];
}

export interface Setting {
  id: string;
  value: string;
}

export class MySubClassedDexie extends Dexie {
  meals!: Table<Meal>;
  groceryLists!: Table<GroceryList>;
  groceryListStates!: Table<GroceryListState>;
  recipes!: Table<Recipe>;
  tags!: Table<Tag>;
  customIngredients!: Table<CustomIngredient>;
  pendingRecipes!: Table<PendingRecipe>;
  settings!: Table<Setting>;

  constructor() {
    super('groceriesHelper');
    this.version(9).stores({
      meals: '++id, name, createdAt, updatedAt, *tags, pendingRecipeId',
      groceryLists: '++id, name, createdAt',
      groceryListStates: '++id, groceryListId',
      recipes: '++id, mealId',
      tags: '++id, name',
      customIngredients: '++id, name, usageCount',
      pendingRecipes: '&id, createdAt',
      settings: '&id',
    });
  }
}

export const db = new MySubClassedDexie();
