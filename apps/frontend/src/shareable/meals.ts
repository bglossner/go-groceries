import { type MealForm } from '../types/meals';
import { type RecipeForm } from '../types/recipe';
import type { ErrorResponse } from './response';

export type MealRecipeImage = {
  type: 'url';
  url: string;
} | {
  type: 'file';
  file: File;
} | {
  type: 'blob';
  blob: Blob;
} | {
  type: 'base64';
  base64: string;
};

export type MealGenerationDataInput = Pick<MealForm, 'name' | 'ingredients'> & {
  tags?: string[];
  recipe?: Partial<Pick<RecipeForm, 'notes' | 'url'>> & {
    images?: MealRecipeImage[];
  };
};

export interface GenerateMealDataRequestInput {
  url: string;
  availableTags?: string[];
  pass: string;
}

export type MealGenerationDataResponseData = {
  data: MealGenerationDataInput;
  modelUsed?: string;
};

export type MealGenerationDataResponse = MealGenerationDataResponseData | ErrorResponse;
