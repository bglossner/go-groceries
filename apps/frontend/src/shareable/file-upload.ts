export const ALLOWED_CONTENT_TYPES = [
  // application/octet-stream for blob
  'application/json', 'image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'
] as const;

export type FileUploadType = 'R2';

export interface FileUploadRequest {
  pass: string;
  fileUploadType: FileUploadType;
  fileName: string;
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];
}

export interface FileUploadResponse {
  url: string
}
