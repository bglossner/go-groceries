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

// Transport types must not pull browser form schemas or database code into Workers.
export type MealGenerationDataInput = {
  name: string;
  ingredients: { name: string; quantity?: number }[];
  tags?: string[];
  recipe?: {
    notes?: string;
    url?: string;
    images?: MealRecipeImage[];
  };
};

export type GroqModelName = 'moonshotai/kimi-k2-instruct-0905' | 'moonshotai/kimi-k2-instruct' | 'llama-3.3-70b-versatile' | 'openai/gpt-oss-120b' | 'llama3-70b-8192' | 'gemma2-9b-it' | 'llama3-8b-8192';

export type ModelSelection = {
  client: 'Groq';
  model?: GroqModelName;
};

export type GenerateMealDataRequestAdditionalInput = {
  logModelResponse?: boolean;
  logModelRequestInput?: boolean;
  modelSelection?: ModelSelection;
  skipAnyCaching?: boolean;
} & ({
  type: 'youtube';
  logYouTubeResponse?: boolean;
} | {
  type: 'images';
});

export type GenerateMealDataBaseRequest = {
  availableTags?: string[];
  pass: string;
  additionalInput?: GenerateMealDataRequestAdditionalInput;
};

export interface GenerateMealDataYoutubeRequestInput extends GenerateMealDataBaseRequest {
  url: string;
}

export interface GenerateMealDataImagesRequestInput extends GenerateMealDataBaseRequest {
  url: string;
}

export type MealGenerationDataResponseData = {
  data: MealGenerationDataInput;
  modelUsed?: string;
};

export type MealGenerationDataResponse = MealGenerationDataResponseData | ErrorResponse;
