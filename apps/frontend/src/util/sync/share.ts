import type { Sync } from '../../db/db';
import type { SnapshotShareResponse } from '../../shareable/snapshot';
import { v2Post, writerPermission } from './api';
import { collectionUrl } from './location';

export async function createShareLink(sync: Sync): Promise<string> {
  if (sync.format !== 'v2' || !sync.collectionId || !sync.snapshotId) throw new Error('Publish a v2 snapshot before sharing.');
  const response = await v2Post<SnapshotShareResponse>('snapshots/share', { collectionId: sync.collectionId, snapshotId: sync.snapshotId,
    expiresIn: 7 * 24 * 60 * 60 }, await writerPermission());
  if (response.collectionId !== sync.collectionId || response.snapshotId !== sync.snapshotId || typeof response.shareToken !== 'string') {
    throw new Error('Invalid share response');
  }
  return `${collectionUrl(sync.collectionId, sync.snapshotId)}&share=${encodeURIComponent(response.shareToken)}`;
}
