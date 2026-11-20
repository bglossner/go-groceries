import { db } from '../../db/db';
import { SNAPSHOT_LIMITS } from '../../shareable/snapshot';

export class SyncApiError extends Error {
  status: number;
  constructor(status: number) {
    super(status === 409 ? 'Cloud sync conflict. Latest changed; import the latest collection before retrying.' :
      status === 403 ? 'Sync authorization expired or was rejected. Set the writer pass or open a valid shared link.' :
      `Cloud sync request failed (${status}). Retry sync to resume safely.`);
    this.status = status;
  }
}
export type ReadPermission = { pass: string } | { shareToken: string };
export async function writerPermission(): Promise<{ pass: string }> {
  const pass = (await db.settings.get('youtubeApiPass'))?.value;
  if (!pass) throw new Error('API Pass not set. A writer pass is required for this collection.');
  return { pass };
}
export async function boundedJson(response: Response, limit = SNAPSHOT_LIMITS.byteLength + 4096): Promise<unknown> {
  if (!response.body) throw new Error('Empty sync response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new Error('Sync response exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid sync JSON'); }
}
/** Responses/requests may contain credentials: never include them in errors or logs. */
export async function v2Post<T>(path: string, body: object, permission: ReadPermission, retry = true): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/v2/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          ...('shareToken' in permission ? { Authorization: `Bearer ${permission.shareToken}` } : {}) },
        body: JSON.stringify({ ...body, ...('pass' in permission ? { pass: permission.pass } : {}) }),
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new SyncApiError(response.status);
      return await boundedJson(response) as T;
    } catch (error) {
      const transient = !(error instanceof SyncApiError) || [408, 429, 500, 502, 503, 504].includes(error.status);
      if (!retry || !transient || attempt >= 2) {
        if (error instanceof SyncApiError) throw error;
        throw new Error('Cloud sync is unavailable. Retry sync to resume safely.');
      }
      await new Promise(resolve => window.setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 150));
    }
  }
}
