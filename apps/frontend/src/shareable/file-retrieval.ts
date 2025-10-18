import type { FileUploadType } from "./file-upload";

export interface FileRetrievalRequest {
  pass: string;
  fileName: string;
  uploadedType: FileUploadType;
}

export interface FileRetrievalResponse {
  url: string;
}
