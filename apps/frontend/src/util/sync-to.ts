import { db } from '../db/db';
import { syncTo } from './sync';

export async function checkAndTriggerAutoSyncTo(): Promise<null | { type: 'SUCCESS' | 'ERROR' | 'NO_SYNC' }> {
  const sync = await db.syncs.where('type').equals('to').first();
  if (sync?.format !== 'v2' || !sync.automatic) return null;
  if (!sync.pendingPublication && sync.lastSyncedAt && Date.now() - sync.lastSyncedAt.getTime() < 3600000) return { type: 'NO_SYNC' };
  try { await syncTo({ existingSync: sync, automatic: true }); return { type: 'SUCCESS' }; }
  catch { return { type: 'ERROR' }; }
}
