import { AppContext, GenerateMealDataInput } from "../types";

export type ModelResponse = {
  data: {
    mealName: string;
    ingredients: {
      name: string;
      quantity: number;
    }[];
    tags: string[];
    recipe: string;
  };
  modelUsed?: string;
};

export type RequestContentOptions = Pick<GenerateMealDataInput, 'availableTags'> & {
  videoTitle?: string;
  videoDescription?: string;
  videoTags: string[];
  comments: string[];
  language?: string;
};

const commentDelimiter = '|---|';

export abstract class Model {
  abstract makeRequest(c: AppContext, identifier: string, request: string): Promise<ModelResponse>;
}

export class ModelYouTubeDataExtractor {
  private model: Model;

  constructor(model: Model) {
    this.model = model;
  }

  async generateMealData(c: AppContext, options: Omit<RequestContentOptions, 'identifier'> & { videoId: string }): Promise<ModelResponse> {
    const requestContent = this.generateRequestContent(options);
    return await this.model.makeRequest(c, options.videoId, requestContent);
  }

  private generateRequestContent(options: RequestContentOptions): string {
    return `
      You're given data about a YouTube video. Attempt to extra the following:

      - Meal Name: This should be a concise name for the meal.

      - Ingredients and Quantity: Attempt to find a recipe or ingredient list in the data given and extract the ingredient name and quantity of it. Make the ingredient name concise ("Broccoli Crowns" -> "Broccoli"). For quantity, choose a numerical amount between 1 and 10. If unsure, just select 1 for the quantity. For any measurements, just choose 1 as the quantity.

      - Tags: These are descriptive labels. Return any possible applicable tags from this list: [${options.availableTags?.join(', ') ?? ''}]. This may be empty if no tags apply.

      - Recipe: This is text describing the recipe to make the meal. It should be as concise as possible but include all details, ingredients, and steps required to make the meal. This may be empty if no recipe can be found. Separate the recipe instructions by newlines and place a hyphen before each instruction ("- Instruction 1\n").

      The output of this should be JSON in the following format:
      {
        mealName: string;
        ingredients: {
          name: string;
          quantity: number;
        }[];
        tags: string[];
        recipe: string;
      }

      Where possible, ALL data given back should be in ${options.language  ?? 'English'}.

      Here is the data:

      --
      Video title: ${options.videoTitle ?? 'Unknown'}
      --

      --
      Video description: ${options.videoDescription ?? 'Not Given'}
      --

      --
      Video tags: [${options.videoTags?.join(', ') ?? ''}]

      --
      Interesting Comments (comments separated by ${commentDelimiter}):

      [${options.comments.map((comment) => `"${comment}"`).join(commentDelimiter + '\n')}]

      Return ONLY JSON with no commentary.
    `
  }
}
