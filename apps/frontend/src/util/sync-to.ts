
import { db } from '../db/db';
import { syncTo } from './sync';

export async function checkAndTriggerAutoSyncTo(): Promise<null | { url?: string; type: 'SUCCESS' | 'ERROR' | 'NO_SYNC' }> {
  const existingSyncTo = await db.syncs.where('type').equals('to').first();

  if (existingSyncTo && existingSyncTo.automatic && existingSyncTo.lastSyncedAt) {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    if (existingSyncTo.lastSyncedAt < oneHourAgo) {
      console.log(`Automatic sync triggered for Sync To. Last sync time ${existingSyncTo.lastSyncedAt?.toISOString()}`);
      try {
        const url = await syncTo({ exisingSync: existingSyncTo, automatic: true });
        // Update last synced at
        await db.syncs.update(existingSyncTo.id!, { lastSyncedAt: new Date() });
        return { url, type: 'SUCCESS' };
      } catch (error) {
        console.error('Automatic sync failed:', error);
        return { type: 'ERROR' };
      }
    } else {
      console.log(`No sync [to] required for at least another: ${Math.floor((existingSyncTo.lastSyncedAt.getTime() + 3600000 - new Date().getTime()) / 60000)} minutes`);
      return { type: 'NO_SYNC' };
    }
  }
  return null;
}
