/** V2 uses the shared writer pass in JSON, or a read capability in Authorization: Bearer. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export const IMAGE_LIMITS = {
  byteLength: 4 * 1024 * 1024,
  pixels: 16 * 1024 * 1024,
  dimension: 8192,
  batch: 16,
  transferSeconds: 300,
  completionSeconds: 3600,
} as const;

export type ImageRef =
  | { kind: 'externalUrl'; url: string }
  | { kind: 'asset'; assetId: string; name?: string; lastModified?: number };

/** assetId and sha256 are the same lowercase 64-character hex digest. */
export type ImageAsset = {
  assetId: string;
  sha256: string;
  mimeType: ImageMimeType;
  byteLength: number;
  location: { provider: 'r2'; key: string };
};
export type ImageUploadInput = Pick<ImageAsset, 'sha256' | 'mimeType' | 'byteLength'>;
export type SignedImageTransfer = {
  key: string;
  url: string;
  /** UTC ISO date; temporary URLs must never be persisted as asset identity. */
  expiresAt: string;
};
export type ImagePrepareRequest = { pass: string; collectionId: string; images: ImageUploadInput[] };
export type ImagePrepareResponse = {
  images: (
    | { status: 'existing'; asset: ImageAsset }
    | { status: 'upload'; asset: ImageAsset; uploadToken: string;
        transfer: SignedImageTransfer; headers: { 'Content-Type': ImageMimeType } }
  )[];
};
export type ImageCompleteRequest = { pass: string; uploadToken: string };
export type ImageCompleteResponse = { asset: ImageAsset };
export type ImageDownloadRequest = {
  pass?: string;
  collectionId: string;
  /** Required for recipient capabilities; writers may omit it. */
  snapshotId?: string;
  assetIds: string[];
};
export type ImageDownloadResponse = { images: (SignedImageTransfer & { asset: ImageAsset })[] };
