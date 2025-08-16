import Groq, { APIError } from 'groq-sdk';
import { AppContext } from '../types';
import { Model, ModelInterfaceOptions, ModelResponse } from './model-interface';
import { ErrorWrapper } from '../endpoints/generate-meal-data';
import { CompletionCreateParams } from 'groq-sdk/src/resources/chat.js';
import { GroqModelName } from '@go-groceries/frontend/meals';

let groqs: { [apiKey: string]: Groq } = {};

const getGroqInstance = (c: AppContext) => {
  const apiKey = c.env.GROQ_API_KEY;
  if (!groqs[apiKey]) {
    groqs[apiKey] = new Groq({
      apiKey,
    });
  }
  return groqs[apiKey];
};

const TEMP_CACHED_RESPONSE_MESSAGE = `
 Here's the extracted data in JSON format:

\`\`\`
{
  "mealName": "Sheng Jian Bao (Shanghai Buns)",
  "ingredients": [
    {
      "name": "Tempeh or Tofu",
      "quantity": 1
    },
    {
      "name": "Scallions",
      "quantity": 1
    },
    {
      "name": "Garlic",
      "quantity": 1
    },
    {
      "name": "Carrots",
      "quantity": 1
    },
    {
      "name": "Ginger",
      "quantity": 1
    },
    {
      "name": "Soy Sauce",
      "quantity": 1
    },
    {
      "name": "Sweet Soy Sauce",
      "quantity": 1
    },
    {
      "name": "White Vinegar",
      "quantity": 2
    },
    {
      "name": "Corn Starch",
      "quantity": 3
    },
    {
      "name": "Salt",
      "quantity": 1
    },
    {
      "name": "Agave",
      "quantity": 3
    },
    {
      "name": "Chili Powder",
      "quantity": 1
    }
  ],
  "tags": ["dumplings"],
  "recipe": "Recipe:\nDough:\n-2/3 cup lukewarm water\n-1 Tsp instant yeast\n-1 Tsp sugar\n-1 Tbsp oil\nMIX\n-2 cups flour\n-3 Tbsp corn starch\n-a pinch of salt\nKnead well and let the dough rest for 1h.\nDivide in 26 pieces and roll them out on a floured working surface.\nFilling:\n-250g tempeh or tofu, crumbled\n-2 scallions, chopped\n-2 cloves garlic, chopped\n-2 carrots, shredded\n-a thumbsize piece of ginger, minced\n-1 Tbsp soy sauce\n-1 Tbsp sweet soy sauce\n-2 Tsp white vinegar\nKnead 2-3mins and add 1-2 TSp to a dough circle.\nFold and seal. Heat up oil in a pan and fry until browned on medium heat.\nAdd water and let the buns steam covered for about 10mins.\nThen they're done.\nDipping sauce:\n-3 TSp agave\n-3 Tbsp white vinegar\n-1 TSp chili powder\nMix and serve with the dumplings."
}
\`\`\`
`;
const CACHED_RESPONSES = new Map<string, ModelResponse>();

/* const JSON_SCHEMA = {
  name: 'Meal Input',
  description: 'Input for a Meal form to fill out the data',
  schema: {
    mealName: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number', minimum: 1, maximum: 10 }
        },
        required: ['name', 'quantity']
      }
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    recipe: { type: 'string' }
  }
}; */

type ModelProps = {
  name: GroqModelName;
  responseFormat: CompletionCreateParams.ResponseFormatJsonObject | CompletionCreateParams.ResponseFormatJsonSchema
};

const MODELS_BY_DESIRE = [
  { name: 'moonshotai/kimi-k2-instruct', responseFormat: { type: 'json_object' } },
  { name: 'llama-3.3-70b-versatile', responseFormat: { type: 'json_object' } },
  { name: 'openai/gpt-oss-120b', responseFormat: { type: 'json_object' } },
  { name: 'llama3-70b-8192', responseFormat: { type: 'json_object' } },
  { name: 'gemma2-9b-it', responseFormat: { type: 'json_object' } },
  { name: 'llama3-8b-8192', responseFormat: { type: 'json_object' } },
] as const satisfies ModelProps[];

type UsageStats = {
  remainingTokens: number;
  remainingRequests: number;
  retryAfterSeconds: number;
  timeUntilResetTokens: number;
};

const getUsageStatsFromError = (error: APIError): UsageStats => {
  return {
    remainingTokens: Number(error.headers['x-ratelimit-remaining-tokens']),
    remainingRequests: Number(error.headers['x-ratelimit-remaining-requests']),
    timeUntilResetTokens: Number(error.headers['x-ratelimit-reset-tokens']),
    retryAfterSeconds: Number(error.headers['Retry-After']),
  };
}

export class GroqModel extends Model {
  getModelName(): string {
    return 'Groq';
  }

  async makeRequest(c: AppContext, request: string, options: ModelInterfaceOptions): Promise<ModelResponse> {
    const { identifier } = options;

    let content: string = '';
    let model: string | undefined;
    if (TEMP_CACHED_RESPONSE_MESSAGE.trim() !== '' && false) {
      console.log('Loading chat content from temp cached response');
      content = TEMP_CACHED_RESPONSE_MESSAGE;
      model = 'TempCachedResponse';
    } else if (identifier in CACHED_RESPONSES) {
      console.log('Loading chat content from actual cached response');
      content = CACHED_RESPONSES[identifier];
      model = 'CachedResponse';
    } else {
      console.log('Loading chat content from model call');
      const output = await this.makeModelRequest(c, request, options);
      content = output.content;
      model = output.model;
      CACHED_RESPONSES[identifier] = content;
    }
    content = content.trim();

    return {
      data: JSON.parse(content),
      modelUsed: model,
    };
  }

  private async makeModelRequest(c: AppContext, request: string, options: ModelInterfaceOptions): Promise<{ content: string, model: string }> {
    const model = getGroqInstance(c);
    const { modelName, identifier } = options;

    if (modelName && MODELS_BY_DESIRE.findIndex(({ name }) => name === modelName) === -1) {
      throw new ErrorWrapper({ message: `Model instance desired '${modelName}' does not exist for given client`, statusCode: 404 });
    } else if (modelName) {
      console.log(`Using model ${modelName} for ${identifier}`);
    }

    let lowestTimeUntilRetry: number | undefined;
    const modelsToTry = options.modelName ? MODELS_BY_DESIRE.filter(({ name }) => name === options.modelName) : MODELS_BY_DESIRE;
    // console.log(modelsToTry);
    for (const { name, responseFormat } of modelsToTry) {
      try {
        const chatCompletion = await model.chat.completions.create({
          messages: [{ role: 'user', content: request }],
          model: name,
          response_format: responseFormat,
        });

        console.log(`Successfully made call to ${name} for ${identifier}`);
        return {
          content: chatCompletion.choices[0].message.content,
          model: name,
        };
      } catch (error: any) {
        console.warn(`Caught error for model ${name} for ${identifier}`);
        console.warn(error);
        if (error instanceof APIError) {
          if (error.status === 429) {
            const usageStats = getUsageStatsFromError(error);
            if (!lowestTimeUntilRetry || usageStats.retryAfterSeconds < lowestTimeUntilRetry) {
              lowestTimeUntilRetry = usageStats.retryAfterSeconds;
            }

            console.warn(`[THROTTLE] Error for ${name} was throttling. Additional info: ${JSON.stringify(usageStats)}`);
          }
        } else {
          console.warn(`Error for ${name} could not be source from Groq API error`);
        }
      }
    }

    throw new ErrorWrapper({
      message: `No models succeeded for input ${identifier}.${lowestTimeUntilRetry ? ` Retryable after ${lowestTimeUntilRetry} seconds` : ''}`,
      statusCode: 500
    });
  }
}
