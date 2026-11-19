import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ImageAsset } from '@go-groceries/frontend/image-assets';
import { AppContext, ErrorWrapper } from '../types';
import { getS3Client } from '../file-upload/s3-client';

export type StorageDependencies = {
  client: (c: AppContext) => S3Client;
  sign: typeof getSignedUrl;
  now: () => number;
};
export const defaultDependencies: StorageDependencies = { client: getS3Client, sign: getSignedUrl, now: Date.now };
export function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === status;
}
export const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Read a stream with an actual-byte bound, independent of untrusted Content-Length. */
export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ErrorWrapper({ message: 'Body exceeds size limit', statusCode: 413 });
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export class ObjectStorage {
  private client: S3Client;
  constructor(private c: AppContext, private deps: StorageDependencies) { this.client = deps.client(c); }
  async head(key: string) {
    try { return await this.client.send(new HeadObjectCommand({ Bucket: this.c.env.R2_BUCKET_NAME, Key: key })); }
    catch (error) { if (hasStatus(error, 404)) return null; throw error; }
  }
  async get(key: string, limit: number) {
    return (await this.getWithRevision(key, limit))?.bytes ?? null;
  }
  async getWithRevision(key: string, limit: number) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.c.env.R2_BUCKET_NAME, Key: key }));
      if (!result.Body) throw new Error('Missing upstream body');
      const stream = result.Body.transformToWebStream();
      if (result.ContentLength !== undefined && result.ContentLength > limit) {
        await stream.cancel();
        throw new ErrorWrapper({ message: 'Object exceeds size limit', statusCode: 413 });
      }
      return { bytes: await readBounded(stream, limit), revision: result.ETag };
    } catch (error) { if (hasStatus(error, 404)) return null; throw error; }
  }
  async put(key: string, bytes: Uint8Array, options: Partial<PutObjectCommandInput>) {
    return this.client.send(new PutObjectCommand({
      Bucket: this.c.env.R2_BUCKET_NAME, Key: key, Body: bytes,
      CacheControl: 'private, no-store', ...options,
    }));
  }
  async removeStaging(key: string) {
    // Cleanup is best effort: a confirmed immutable object makes completion retryable.
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.c.env.R2_BUCKET_NAME, Key: key })); }
    catch { /* Abandoned staging retention is an operational follow-up, never final-image GC. */ }
  }
  async verifiedAsset(asset: ImageAsset): Promise<boolean> {
    const head = await this.head(asset.location.key);
    if (!head) return false;
    if (head.Metadata?.['verified-sha256'] !== asset.sha256 || head.ContentLength !== asset.byteLength || head.ContentType !== asset.mimeType) {
      throw new ErrorWrapper({ message: 'Asset descriptor conflicts with stored object', statusCode: 409 });
    }
    return true;
  }
  async sign(key: string, method: 'GET' | 'PUT', seconds: number, mimeType?: string) {
    const input = { Bucket: this.c.env.R2_BUCKET_NAME, Key: key };
    const command = method === 'GET' ? new GetObjectCommand(input) : new PutObjectCommand({ ...input, ContentType: mimeType });
    const started = this.deps.now();
    // Disable metadata hoisting and sign the requested PUT Content-Type explicitly.
    const url = await this.deps.sign(this.client, command, {
      expiresIn: seconds, signingDate: new Date(started),
      ...(method === 'PUT' ? { signableHeaders: new Set(['content-type']) } : {}),
    });
    return { key, url, expiresAt: new Date(started + seconds * 1000).toISOString() };
  }
}
