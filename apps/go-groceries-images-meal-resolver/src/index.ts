import { Hono } from 'hono';
import { corsEndpoint, corsHandlerMiddleware } from './endpoints/cors';
import { generateMealData } from './endpoints/generate-meal-data-from-images';
import { fileUploadEndpoint } from './endpoints/file-upload';
import { fileRetrievalEndpoint } from './endpoints/file-retrieval';
import { imageStorageEndpoints } from './endpoints/image-storage';
import type { StorageDependencies } from './image-storage/storage';

export type AppType = Hono<{ Bindings: Env }>;
/** Dependency seam supports offline app.fetch verification without storage accounts. */
export function createApp(dependencies?: StorageDependencies) {
  const app: AppType = new Hono<{ Bindings: Env }>();
  app.options('*', corsEndpoint);
  app.all('*', corsHandlerMiddleware);
  app.post('/images/generate-meal-data', generateMealData);
  fileUploadEndpoint(app);
  fileRetrievalEndpoint(app);
  imageStorageEndpoints(app, dependencies);
  return app;
}
export default createApp();
