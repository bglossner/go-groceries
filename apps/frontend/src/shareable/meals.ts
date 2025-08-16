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

export type GroqModelName = 'moonshotai/kimi-k2-instruct' | 'llama-3.3-70b-versatile' | 'openai/gpt-oss-120b' | 'llama3-70b-8192' | 'gemma2-9b-it' | 'llama3-8b-8192';

export type ModelSelection = {
  client: 'Groq';
  model?: GroqModelName;
};

export type GenerateMealDataRequestAdditionalInput = {
  logModelResponse?: boolean;
  logModelRequestInput?: boolean;
  modelSelection?: ModelSelection
} & ({
  type: 'youtube';
  logYouTubeResponse?: boolean;
} | {
  type: 'images';
});

export interface GenerateMealDataRequestInput {
  url: string;
  availableTags?: string[];
  pass: string;
  additionalInput?: GenerateMealDataRequestAdditionalInput;
}

export type MealGenerationDataResponseData = {
  data: MealGenerationDataInput;
  modelUsed?: string;
};

export type MealGenerationDataResponse = MealGenerationDataResponseData | ErrorResponse;
