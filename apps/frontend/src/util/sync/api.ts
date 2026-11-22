import { db } from '../../db/db';
import { SNAPSHOT_LIMITS } from '../../shareable/snapshot';
import { networkOutcome, safely, startAttempt, type ObserveAttempt } from './diagnostics';

export class SyncApiError extends Error {
  status: number;
  imageRejection?: 'container';
  constructor(status: number, imageRejection?: 'container') {
    super(status === 409 ? 'Cloud sync conflict. Latest changed; import the latest collection before retrying.' :
      status === 403 ? 'Sync authorization expired or was rejected. Set the writer pass or open a valid shared link.' :
      `Cloud sync request failed (${status}). Retry sync to resume safely.`);
    this.status = status;
    this.imageRejection = imageRejection;
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
export async function v2Post<T>(path: string, body: object, permission: ReadPermission, retry = true, observe?: ObserveAttempt): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const record = startAttempt(observe);
    let status: number | undefined;
    try {
      const response = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/v2/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          ...('shareToken' in permission ? { Authorization: `Bearer ${permission.shareToken}` } : {}) },
        body: JSON.stringify({ ...body, ...('pass' in permission ? { pass: permission.pass } : {}) }),
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000),
      });
      status = response.status;
      safely(() => record?.('response', status));
      if (!response.ok) {
        if (path === 'images/complete' && response.status === 400) {
          const body = await boundedJson(response, 512).catch(() => undefined);
          const message = workerError(body);
          safely(() => record?.('response', status, message));
          if (message === 'Invalid image container or dimensions') throw new SyncApiError(response.status, 'container');
        } else if (record) {
          // Sync ignores these bodies. Read only a small error body off the critical path.
          void boundedJson(response, 512).then(body => {
            safely(() => record('response', status, workerError(body)));
          }).catch(() => undefined);
        }
        throw new SyncApiError(response.status);
      }
      return await boundedJson(response) as T;
    } catch (error) {
      if (!(error instanceof SyncApiError)) {
        safely(() => record?.(status === undefined ? networkOutcome(error) : 'invalid', status));
      }
      const transient = !(error instanceof SyncApiError) || [408, 429, 500, 502, 503, 504].includes(error.status);
      if (!retry || !transient || attempt >= 2) {
        if (error instanceof SyncApiError) throw error;
        throw new Error('Cloud sync is unavailable. Retry sync to resume safely.');
      }
      await new Promise(resolve => window.setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 150));
    }
  }
}

function workerError(body: unknown) {
  return body && typeof body === 'object' && 'error' in body ? body.error : undefined;
}
