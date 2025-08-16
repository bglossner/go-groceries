import { GenerateMealDataInput, AppContext } from "../types";
import { youtube_v3 } from '@googleapis/youtube';
import { ContentfulStatusCode } from "hono/utils/http-status";
import { ModelSelector, ModelYouTubeDataExtractor } from "../models/model-interface";
import { GroqModel } from "../models/groq";
import type { MealRecipeImage, MealGenerationDataResponse as Response } from '@go-groceries/frontend/meals';

export class ErrorWrapper extends Error {
  statusCode: ContentfulStatusCode;

  constructor({ message, statusCode }: { message: string, statusCode: ContentfulStatusCode }) {
    super(message);
    this.name = 'ErrorWrapper';
    this.statusCode = statusCode;
  };
}

let youtubes: { [apiKey: string]: youtube_v3.Youtube } = {};

const getYouTubeInstance = (c: AppContext) => {
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!youtubes[apiKey]) {
    console.log('Creating new YouTube instance!');
    youtubes[apiKey] = new youtube_v3.Youtube({
      auth: apiKey,
    });
  } else {
    console.log('Using cached YouTube instance!');
  }
  return youtubes[apiKey];
};

type VideoResponseDetails = {
  title: string | undefined;
  description: string | undefined;
  channelId: string;
  thumbnailUrl: string | undefined;
  tags: string[] | undefined;
  videoId: string;
};

type VideoAndCommentsResponseDetails = VideoResponseDetails & {
  commentsByChannel: string[];
};

const makeCallToYoutube = async (c: AppContext, url: string): Promise<VideoAndCommentsResponseDetails> => {
  const youtube = getYouTubeInstance(c);
  const videoId = getVideoIdFromUrl(url);
  if (!videoId) {
    throw new ErrorWrapper({
      statusCode: 400,
      message: 'Invalid YouTube URL'
    });
  }
  const response = await youtube.videos.list({
    part: ['snippet'],
    id: [videoId],
    maxResults: 1,
  });

  const responseItem = response.data.items?.[0]?.snippet;
  if (!responseItem) {
    throw new ErrorWrapper({
      statusCode: 400,
      message: 'YouTube URL could not be resolved to an actual video'
    });
  }

  const videoDetails = {
    title: responseItem.title,
    description: responseItem.description,
    channelId: responseItem.channelId,
    thumbnailUrl: responseItem.thumbnails?.standard?.url,
    tags: responseItem.tags,
    videoId,
  } satisfies VideoResponseDetails;

  const commentsByChannel: string[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const commentsResponse = await youtube.commentThreads.list({
      part: ['snippet'],
      videoId: videoId,
      textFormat: 'plainText',
      maxResults: 250,
      pageToken: pageToken,
    });

    for (const item of (commentsResponse.data.items ?? [])) {
      const topLevelComment = item.snippet?.topLevelComment;
      if (topLevelComment?.snippet?.authorChannelId?.value === videoDetails.channelId && topLevelComment.snippet.textDisplay) {
        commentsByChannel.push(topLevelComment.snippet.textDisplay);
      }
    }
    pageToken = commentsResponse.data.nextPageToken || undefined;
  } while (pageToken);

  return {
    ...videoDetails,
    commentsByChannel,
  };
};

const getVideoIdFromUrl = (url: string): string | undefined => {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
  const match = url.match(regex);
  return match ? match[1] : undefined;
};

const getModel = (): ModelYouTubeDataExtractor => {
  return new ModelYouTubeDataExtractor(
    new ModelSelector({
      defaultClientModel: 'Groq',
      modelLoader: async (client) => {
        if (client === 'Groq') {
          return new GroqModel();
        }
      },
    })
  );
};

export default async (c: AppContext) => {
  let body: GenerateMealDataInput;
  try {
    body = await c.req.json<GenerateMealDataInput>();
  } catch (err) {
    return c.json({ error: 'Invalid or missing JSON body' }, 400);
  }
  const { url, availableTags, pass, additionalInput } = body;

  if (c.env.ENABLE_PASS !== 'false' && (!pass || pass !== c.env.PASS)) {
    return c.json({ error: 'Invalid pass provided' } satisfies Response, 403);
  }

  if (!url) {
    return c.json({ error: 'URL is required' } satisfies Response, 400);
  }

  const youtubeApiKey = c.env.YOUTUBE_API_KEY; // Access the API key

  if (!youtubeApiKey) {
    return c.json({ error: 'YouTube API key is not configured.' } satisfies Response, 500);
  }

  let youtubeResponse: Awaited<ReturnType<typeof makeCallToYoutube>>;
  try {
    youtubeResponse = await makeCallToYoutube(c, url);
    // youtubeResponse = { title: 'd', description: 'd', channelId: 'd', thumbnailUrl: 'd', tags: ['d'], videoId: 'd', commentsByChannel: ['d'] };
  } catch (error: any) {
    if (error instanceof ErrorWrapper) {
      return c.json({ error: error.message } satisfies Response, error.statusCode);
    } else {
      console.error('Unexpected error', error);
      return c.json({ error: 'An unexpected error occurred.' } satisfies Response, 500);
    }
  }

  if (additionalInput && additionalInput.type === 'youtube' && additionalInput.logYouTubeResponse) {
    console.log('Logging youtubeResponse:', JSON.stringify(youtubeResponse, null, 2));
  }

  if (!youtubeResponse.channelId) {
    return c.json({ error: 'No channel ID provided for video...' } satisfies Response, 400);
  }

  if (!youtubeResponse.description && (!youtubeResponse.commentsByChannel || youtubeResponse.commentsByChannel.length === 0)) {
    return c.json({ error: 'No description or comments provided for video...' } satisfies Response, 400);
  }

  const model = getModel();
  const [modelOutput, error] = await model.generateMealData(c, {
    videoTitle: youtubeResponse.title,
    videoDescription: youtubeResponse.description,
    videoTags: youtubeResponse.tags,
    comments: youtubeResponse.commentsByChannel,
    availableTags,
    videoId: youtubeResponse.videoId,
    logModelRequest: additionalInput?.logModelRequestInput ?? false,
    client: additionalInput?.modelSelection?.client,
    modelName: additionalInput?.modelSelection?.model,
  }).then((data) => [data, undefined]).catch((e: any) => [undefined, e]);

  if (error) {
    if (error instanceof ErrorWrapper) {
      return c.json({ error: error.message } satisfies Response, error.statusCode);
    } else {
      console.error('Unexpected error', error);
      return c.json({ error: 'An unexpected error occurred.' } satisfies Response, 500);
    }
  }

  if (additionalInput?.logModelResponse) {
    console.log('Model response:', JSON.stringify(modelOutput, null, 2));
  }

  const recipeImages: MealRecipeImage[] = [];
  if (youtubeResponse.thumbnailUrl) {
    recipeImages.push({ type: 'url', url: youtubeResponse.thumbnailUrl });
  }

  return c.json({
    data: {
      name: modelOutput.data.mealName,
      ingredients: modelOutput.data.ingredients,
      tags: modelOutput.data.tags,
      recipe: {
        url,
        notes: modelOutput.data.recipe,
        images: recipeImages,
      },
    },
    modelUsed: modelOutput.modelUsed,
  } satisfies Response);
};
