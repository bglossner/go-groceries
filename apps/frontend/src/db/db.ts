import Dexie, { type Table } from 'dexie';
import { type MealRecipeImage } from '../shareable/meals';
import type { Ingredient } from '../types/ingredients';
import { useMutationQueueStore } from '../store/mutationQueueStore';
import { addDateConverterHooks } from './date-converter';
import type { ImageRef } from '../shareable/image-assets';

export type MealImage = { isThumbnail?: boolean; } & ({
  type: 'url';
  url: string;
} | {
  type: 'file';
  file: File;
} | ({ type: 'asset' } & Extract<ImageRef, { kind: 'asset' }>) | {
  type: 'recipeImage';
  recipeId: number;
  imageIndex: number;
});

export interface Meal {
  id?: number;
  name: string;
  recipe?: string;
  ingredients: Ingredient[];
  tags?: number[];
  createdAt: Date;
  updatedAt: Date;
  pendingRecipeId?: string;
  images?: MealImage[];
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

// Legacy alternatives stay readable while resumable conversion is incomplete.
export type RecipeImage = Blob | string | Extract<ImageRef, { kind: 'asset' }>;
export type PendingImage = MealRecipeImage | Extract<ImageRef, { kind: 'asset' }>;

export interface LocalImageAsset {
  assetId: string;
  sha256: string;
  blob: Blob;
  mimeType: string;
  byteLength: number;
  cachedAt: string;
  verifiedAt: string;
}

export interface ImageMigrationJob {
  id: string;
  tableIndex?: number;
  cursor?: number | string;
  issues: string[];
  updatedAt: string;
}

// An inventory for stage 3, independent of the in-memory mutation hooks.
// Remote completion must be tracked per collection, not by deleting this inventory.
export interface ImageUploadJob {
  assetId: string;
  createdAt: string;
}

export interface Recipe {
  id?: number;
  mealId: number;
  images: RecipeImage[];
  url: string;
  notes: string;
}

export interface PendingRecipe {
  id: string;      // A UUID generated on the client
  content?: string; // The recipe text from the API
  sourceUrl: string;
  createdAt: Date;
  images?: PendingImage[];
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

export interface Store {
  id?: number;
  name: string;
  color?: string;
}

export interface IngredientStore {
  id?: number;
  ingredientName: string;
  storeId: number;
}

export interface Sync {
  id?: number;
  type: 'to' | 'from';
  filename: string;
  uploadType: 'manual';
  createdAt: Date;
  url?: string;
  automatic?: boolean;
  lastSyncedAt?: Date;
  expiresAt?: Date;
  alias?: string;
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
  stores!: Table<Store>;
  ingredientStores!: Table<IngredientStore>;
  syncs!: Table<Sync>;
  imageAssets!: Table<LocalImageAsset, string>;
  imageMigrationJobs!: Table<ImageMigrationJob, string>;
  imageUploadJobs!: Table<ImageUploadJob, string>;

  constructor(isTempVersion: boolean = false) {
    super('groceriesHelper' + (isTempVersion ? crypto.randomUUID() : ''));
    this.version(12).stores({
      meals: '++id, name, createdAt, updatedAt, *tags, pendingRecipeId',
      groceryLists: '++id, name, createdAt',
      groceryListStates: '++id, groceryListId',
      recipes: '++id, mealId',
      tags: '++id, name',
      customIngredients: '++id, name, usageCount',
      pendingRecipes: '&id, createdAt',
      settings: '&id',
      stores: '++id, name, &color',
      ingredientStores: '++id, &[ingredientName+storeId], storeId',
      syncs: '++id, type, createdAt',
    });
    this.version(14).stores({
      meals: '++id, name, createdAt, updatedAt, *tags, pendingRecipeId',
      groceryLists: '++id, name, createdAt',
      groceryListStates: '++id, groceryListId',
      recipes: '++id, mealId',
      tags: '++id, name',
      customIngredients: '++id, name, usageCount',
      pendingRecipes: '&id, createdAt',
      settings: '&id',
      stores: '++id, name, &color',
      ingredientStores: '++id, &[ingredientName+storeId], storeId',
      syncs: '++id, type, createdAt',
    }).upgrade(tx => {
      const toIsoString = (date: string | number | Date | null | undefined) => {
        if (!date) return date;
        return new Date(date).toISOString();
      }

      return Promise.all([
        tx.table('meals').toCollection().modify(meal => {
          meal.createdAt = toIsoString(meal.createdAt);
          meal.updatedAt = toIsoString(meal.updatedAt);
        }),
        tx.table('groceryLists').toCollection().modify(list => {
          list.createdAt = toIsoString(list.createdAt);
        }),
        tx.table('pendingRecipes').toCollection().modify(recipe => {
          recipe.createdAt = toIsoString(recipe.createdAt);
        }),
        tx.table('syncs').toCollection().modify(sync => {
          sync.createdAt = toIsoString(sync.createdAt);
          sync.lastSyncedAt = toIsoString(sync.lastSyncedAt);
          sync.expiresAt = toIsoString(sync.expiresAt);
        })
      ]);
    });
    // Schema upgrade only adds stores. Binary work runs after open in bounded batches.
    this.version(15).stores({
      imageAssets: '&assetId',
      imageMigrationJobs: '&id',
      imageUploadJobs: '&assetId',
    }).upgrade(tx => tx.table('imageMigrationJobs').put({
      id: 'scan', issues: [], updatedAt: new Date().toISOString(),
    }));
  }
}

export type OnMutationArgs = {
  method: string;
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
};

const db = new MySubClassedDexie();
addDateConverterHooks(db);

export const INCLUDE_TABLES =  [
  db.meals.name,
  db.groceryLists.name,
  db.groceryListStates.name,
  db.recipes.name,
  db.tags.name,
  db.customIngredients.name,
  db.pendingRecipes.name,
  db.stores.name,
  db.ingredientStores.name,
  db.imageAssets.name,
] as const;

const ADDITIONAL_EXCLUDE_TABLES = [db.groceryListStates.name, db.imageAssets.name];
const attachGlobalMutationHooks = (db: Dexie) => {
  const methodsToHook = ['put', 'add', 'delete', 'update'] as const satisfies (keyof Table)[];

  db.tables.forEach(table => {
    if (!INCLUDE_TABLES.includes(table.name) || ADDITIONAL_EXCLUDE_TABLES.includes(table.name)) {
      return;
    }

    methodsToHook.forEach(methodName => {
      const originalMethod = table[methodName].bind(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalNonTableMethod = (db as any)[table.name][methodName].bind((db as any)[table.name]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      const getMethodOverload = (originalMethod: Function) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (originalMethod as any)(...args);
          useMutationQueueStore.getState().mutationHooks.forEach((hook) => {
            hook({
              method: methodName,
              table: table.name,
              args,
              result
            } satisfies OnMutationArgs);
          })
          return result;
        };
      }

      table[methodName] = getMethodOverload(originalMethod);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)[table.name][methodName] = getMethodOverload(originalNonTableMethod);
    });
  });
}

attachGlobalMutationHooks(db);
useMutationQueueStore.getState().addDbMutationHook((mutation) => {
  useMutationQueueStore.getState().addMutation(mutation);
});

export {
  db,
};
