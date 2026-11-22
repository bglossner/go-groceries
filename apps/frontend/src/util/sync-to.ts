import { db } from '../db/db';
import { syncTo, type SyncProgress } from './sync';

export async function checkAndTriggerAutoSyncTo(onWarning?: SyncProgress): Promise<null | { type: 'SUCCESS' | 'NO_SYNC' } | { type: 'ERROR'; message: string }> {
  const sync = await db.syncs.where('type').equals('to').first();
  if (sync?.format !== 'v2' || !sync.automatic) return null;
  if (!sync.pendingPublication && sync.lastSyncedAt && Date.now() - sync.lastSyncedAt.getTime() < 3600000) return { type: 'NO_SYNC' };
  try { await syncTo({ existingSync: sync, automatic: true, onWarning, trigger: 'scheduled' }); return { type: 'SUCCESS' }; }
  catch (error) { return { type: 'ERROR', message: error instanceof Error ? error.message : 'Automatic sync failed.' }; }
}
