// src/types/grocery-list-types.ts

export interface AggregatedIngredient {
  name: string;
  quantity: number;
  sources: string[];
}

export interface PartitionedIngredients {
  byStore: Map<number, { storeName: string; storeColor?: string; ingredients: AggregatedIngredient[] }>;
  uncategorized: AggregatedIngredient[];
}
