import { db } from '../db/db';
import { syncTo, type SyncProgress } from './sync';

export async function checkAndTriggerAutoSyncTo(onWarning?: SyncProgress): Promise<null | { type: 'SUCCESS' | 'SUCCESS_WITH_WARNING' | 'NO_SYNC' } | { type: 'ERROR'; message: string }> {
  const sync = await db.syncs.where('type').equals('to').first();
  if (sync?.format !== 'v2' || !sync.automatic) return null;
  if (!sync.pendingPublication && sync.lastSyncedAt && Date.now() - sync.lastSyncedAt.getTime() < 3600000) return { type: 'NO_SYNC' };
  try {
    let warned = false;
    await syncTo({ existingSync: sync, automatic: true, trigger: 'scheduled', onWarning: onWarning && (message => {
      warned = true;
      onWarning(message);
    }) });
    return { type: warned ? 'SUCCESS_WITH_WARNING' : 'SUCCESS' };
  }
  catch (error) { return { type: 'ERROR', message: error instanceof Error ? error.message : 'Automatic sync failed.' }; }
}
