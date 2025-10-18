import { Hono } from "hono";
import { corsEndpoint, corsHandlerMiddleware } from "./endpoints/cors";
import { generateMealData } from "./endpoints/generate-meal-data-from-images";
import { fileUploadEndpoint } from "./endpoints/file-upload";
import { fileRetrievalEndpoint } from "./endpoints/file-retrieval";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();
export type AppType = typeof app;

app.options('*', corsEndpoint);

app.all('*', corsHandlerMiddleware);

app.post('/images/generate-meal-data', generateMealData);

fileUploadEndpoint(app);
fileRetrievalEndpoint(app);

// Export the Hono app
export default app;
