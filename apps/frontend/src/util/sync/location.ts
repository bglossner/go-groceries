import { uuid } from './snapshot-validation';
import type { Sync } from '../../db/db';
import type { ReadPermission } from './api';
import { writerPermission } from './api';

const capabilities = new Map<string, string>();
const legacyTransfers = new Map<string, string>();
const scopeKey = (collectionId: string, snapshotId: string) => `${collectionId}/${snapshotId}`;
export const collectionUrl = (collectionId: string, snapshotId?: string) =>
  `${window.location.origin}/settings#collection=${collectionId}${snapshotId ? `&snapshot=${snapshotId}` : ''}`;
export function parseLocation(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new Error('Invalid sync location'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid sync location');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const collectionId = fragment.get('collection');
  if (collectionId) {
    const snapshotId = fragment.get('snapshot') ?? undefined;
    if (!uuid.safeParse(collectionId).success || snapshotId && !uuid.safeParse(snapshotId).success) throw new Error('Invalid collection or snapshot ID');
    const shareToken = fragment.get('share');
    if (shareToken) {
      if (!snapshotId || shareToken.length > 2048) throw new Error('Invalid shared link');
      capabilities.set(scopeKey(collectionId, snapshotId), shareToken);
    }
    return { format: 'v2' as const, collectionId, snapshotId, access: snapshotId ? 'share' as const : 'writer' as const,
      filename: collectionId, url: collectionUrl(collectionId, snapshotId) };
  }
  const filename = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(filename)) throw new Error('Invalid legacy sync filename');
  const unsigned = `${url.origin}${url.pathname}`;
  // Filename/status parsing must not replace a valid bearer transfer with its unsigned identity.
  if (!legacyTransfers.has(unsigned) || url.search) legacyTransfers.set(unsigned, value);
  return { filename, url: unsigned, format: undefined, collectionId: undefined, snapshotId: undefined, access: undefined };
}
export async function readPermission(sync: Sync): Promise<ReadPermission> {
  const token = sync.collectionId && sync.snapshotId ? capabilities.get(scopeKey(sync.collectionId, sync.snapshotId)) : undefined;
  if (sync.access === 'share' && token) return { shareToken: token };
  if (sync.access === 'share') throw new Error('Reopen the original shared link to authorize this session. The link is read-only.');
  return writerPermission();
}
export const legacyTransfer = (url: string) => legacyTransfers.get(url);
export const rememberLegacyTransfer = (url: string, transfer: string) => legacyTransfers.set(url, transfer);
/** Strip capability fragments before the router, telemetry or referrers can observe them. */
export function consumeIncomingLocation(): string | null {
  if (!new URLSearchParams(window.location.hash.slice(1)).has('collection')) return null;
  const original = window.location.href;
  try {
    parseLocation(original);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return original;
  } catch {
    window.history.replaceState(null, '', window.location.pathname);
    return null;
  }
}
