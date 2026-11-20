import { type Sync } from '../../db/db';
import type { SnapshotShareResponse } from '../../shareable/snapshot';
import { v2Post, writerPermission } from './api';
import { collectionUrl } from './location';

export async function createShareLink(sync: Sync): Promise<string> {
  if (sync.format !== 'v2' || !sync.collectionId || !sync.snapshotId) throw new Error('Publish a v2 snapshot before sharing.');
  const snapshot = await v2Post<{snapshot: import('../../shareable/snapshot').Snapshot}>('snapshots/read',{collectionId:sync.collectionId,snapshotId:sync.snapshotId},await writerPermission());
  if (snapshot.snapshot.data.schemaVersion === 16 && (snapshot.snapshot.data.tables.restaurants.length || snapshot.snapshot.data.tables.people.length)) {
    if (!window.confirm('This link shares the entire household snapshot: people names, ratings, comments, personal notes, location/coordinates, hidden advanced values and menu pictures. Recipients can edit and export their local copy. Expiry cannot erase downloaded copies. Continue?')) throw new Error('Sharing cancelled');
  }
  const response = await v2Post<SnapshotShareResponse>('snapshots/share', { collectionId: sync.collectionId, snapshotId: sync.snapshotId,
    expiresIn: 7 * 24 * 60 * 60 }, await writerPermission());
  if (response.collectionId !== sync.collectionId || response.snapshotId !== sync.snapshotId || typeof response.shareToken !== 'string') {
    throw new Error('Invalid share response');
  }
  return `${collectionUrl(sync.collectionId, sync.snapshotId)}&share=${encodeURIComponent(response.shareToken)}`;
}
