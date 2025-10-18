import { GenerateMealDataImagesRequestInput } from "@go-groceries/frontend/meals";
import { ErrorWrapper as SharedErrorWrapper } from "@go-groceries/backend/endpoints/error";
import type { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ALLOWED_CONTENT_TYPES,
  type FileUploadType,
  type FileUploadRequest,
  type FileUploadResponse,
} from "@go-groceries/frontend/file-upload";
import {
  type FileRetrievalRequest,
  type FileRetrievalResponse,
} from "@go-groceries/frontend/file-retrieval";

export type AppContext = Context<{ Bindings: Env }>;

export type GenerateMealDataInput = GenerateMealDataImagesRequestInput;

export class ErrorWrapper extends SharedErrorWrapper<ContentfulStatusCode> {}

export const R2_FILE_UPLOAD_TYPE = 'R2';

export {
  ALLOWED_CONTENT_TYPES,
  type FileUploadType,
  type FileUploadRequest,
  type FileUploadResponse,
  type FileRetrievalRequest,
  type FileRetrievalResponse,
};
