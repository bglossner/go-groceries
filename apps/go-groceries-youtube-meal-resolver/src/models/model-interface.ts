import { Model, ModelInterfaceOptions, ModelResponse, ModelSelector } from "@go-groceries/backend/models";
import { GenerateMealDataYoutubeRequestInput, ModelSelection } from "@go-groceries/frontend/meals";
import { ErrorWrapper } from "../endpoints/generate-meal-data";
import { AppContext } from "../types";

export type RequestContentOptions = Pick<GenerateMealDataYoutubeRequestInput, 'availableTags'> & {
  videoTitle?: string;
  videoDescription?: string;
  videoTags: string[];
  comments: string[];
  language?: string;
};

const commentDelimiter = '|---|';

export abstract class YouTubeModel extends Model {
  abstract makeRequest(c: AppContext, request: string, options: ModelInterfaceOptions): Promise<ModelResponse>;
}

export type ModelClient = ModelSelection['client'];

export class YouTubeModelSelector extends ModelSelector<ModelClient, YouTubeModel> {}


type GenerateMealDataYouTubeModelOptions = {
  videoId: string;
  logModelRequest: boolean;
  client?: ModelClient;
  modelName?: string;
  skipAnyCaching?: boolean;
}

export class ModelYouTubeDataExtractor {
  private modelSelector: YouTubeModelSelector;

  constructor(modelSelector: YouTubeModelSelector) {
    this.modelSelector = modelSelector;
  }

  private async getModel(options: GenerateMealDataYouTubeModelOptions): Promise<YouTubeModel> {
    let model: YouTubeModel | undefined;
    if (options.client) {
      model = await this.modelSelector.getModel(options.client);
      if (!model) {
        throw new ErrorWrapper({ message: `Could not resolve given model client '${options.client}'`, statusCode: 404 });
      }
    } else {
      model = await this.modelSelector.getDefaultModel();
    }

    if (!model) {
      throw new Error('Could not resolve default model!');
    }

    return model;
  }

  async generateMealData(c: AppContext, options: Omit<RequestContentOptions, 'identifier'> & GenerateMealDataYouTubeModelOptions): Promise<ModelResponse> {
    const requestContent = this.generateRequestContent(options);
    if (options.logModelRequest) {
      console.log('Request to model:\n----------\n' + requestContent + '\n----------\n')
    }
    const model = await this.getModel(options);
    console.log(`Using model ${model.getModelName()}. Client: ${options.client ?? 'Default'}`);
    return await model.makeRequest(c, requestContent, { modelName: options.modelName, identifier: options.videoId, skipAnyCaching: options.skipAnyCaching });
  }

  private generateRequestContent(options: RequestContentOptions): string {
    return `
You're given data about a YouTube video. Attempt to extract the following:

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
