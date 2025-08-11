import { Hono } from "hono";
import generateMealData from "./endpoints/generate-meal-data";
import { corsHandlerMiddleware, corsEndpoint } from "./endpoints/cors";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();



app.options('*', corsEndpoint);

app.all('*', corsHandlerMiddleware);

app.post('/youtube/generate-meal-data', generateMealData);

// Export the Hono app
export default app;
