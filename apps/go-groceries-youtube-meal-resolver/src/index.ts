import { Hono } from "hono";
import { GenerateMealDataInput, AppContext } from "./types";
// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.post('/youtube/generate-meal-data', async (c: AppContext) => {
  const { url } = await c.req.json<GenerateMealDataInput>();

  if (!url) {
    return c.json({ error: 'URL is required' }, 400);
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
  if (!youtubeRegex.test(url)) {
    return c.json({ error: 'Invalid YouTube URL' }, 400);
  }

  const youtubeApiKey = c.env.YOUTUBE_API_KEY; // Access the API key

  if (!youtubeApiKey) {
    return c.json({ error: 'YouTube API key is not configured.' }, 500);
  }

  return c.json({});
});

// Export the Hono app
export default app;
