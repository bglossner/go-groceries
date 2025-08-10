import { type MealForm } from '../types/meals';
import { type RecipeForm } from '../types/recipe';
import type { ErrorResponse } from './response';

export type MealGenerationDataInput = Pick<MealForm, 'name' | 'ingredients'> & {
  tags?: string[];
  recipe?: Partial<Pick<RecipeForm, 'notes' | 'url'>> & {
    images?: string[];
  };
};

export type MealGenerationDataResponse = {
  data: MealGenerationDataInput;
  modelUsed?: string;
} | ErrorResponse;
