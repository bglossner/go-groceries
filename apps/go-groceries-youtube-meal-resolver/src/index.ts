import { Hono } from "hono";
import generateMealData from "./endpoints/generate-meal-data";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.post('/youtube/generate-meal-data', generateMealData);

// Export the Hono app
export default app;
