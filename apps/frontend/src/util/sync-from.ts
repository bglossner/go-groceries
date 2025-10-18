import { db } from '../db/db';
import { getPresignedUrlExpirationInfo } from './file/s3-presigned';
import { type FileRetrievalRequest, type FileRetrievalResponse } from '../shareable/file-retrieval';

export async function saveSuccessfulSync() {
  const existingSyncFrom = await db.syncs.where('type').equals('from').first();
  if (existingSyncFrom && existingSyncFrom.id) {
    return await db.syncs.update(existingSyncFrom.id, { lastSyncedAt: new Date() });
  } else {
    return undefined;
  }
}

export async function saveSyncFromLocation(url: string, alias?: string): Promise<void> {
  const { filename, expiresAt } = getPresignedUrlExpirationInfo(url);

  const existingSyncFrom = await db.syncs.where('type').equals('from').first();

  if (existingSyncFrom) {
    await db.syncs.update(existingSyncFrom.id!, {
      url,
      filename,
      expiresAt,
      lastSyncedAt: new Date(), // Update last synced at when location is saved/updated
      alias,
    });
  } else {
    await db.syncs.add({
      type: 'from',
      url,
      filename,
      expiresAt,
      uploadType: 'manual', // Assuming manual for now
      createdAt: new Date(),
      lastSyncedAt: new Date(),
      alias,
    });
  }
}

import { getDiffsFromNewImport, type DiffsResult } from '../util/db/import'; // Add this import

export async function syncFromDb(): Promise<{ blob: Blob, diffsResult: DiffsResult }> {
  const existingSyncFrom = await db.syncs.where('type').equals('from').first();

  if (!existingSyncFrom || !existingSyncFrom.url || !existingSyncFrom.filename) {
    throw new Error('No sync from location configured.');
  }

  let currentUrl = existingSyncFrom.url;
  const { secondsRemaining } = getPresignedUrlExpirationInfo(currentUrl);

  // If expiration is within 1 minute, get a new presigned URL
  if (secondsRemaining < 60) {
    console.log('Presigned URL expiring soon, getting a new one...');
    const passSetting = await db.settings.get('youtubeApiPass'); // Assuming youtubeApiPass is used for file retrieval
    if (!passSetting || !passSetting.value) {
      throw new Error('API Pass not set for file retrieval');
    }
    const pass = passSetting.value;

    const fileRetrievalRequest: FileRetrievalRequest = {
      pass,
      fileName: existingSyncFrom.filename,
      uploadedType: 'R2', // Assuming R2 as the upload type
    };

    const fileRetrievalResponse = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/file-retrieval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fileRetrievalRequest),
    });

    if (!fileRetrievalResponse.ok) {
      if (fileRetrievalResponse.status === 404) {
        throw new Error(`File not found at sync location: ${existingSyncFrom.filename}`);
      }
      throw new Error('Failed to get new retrieval URL');
    }

    const { url: newRetrievalUrl }: FileRetrievalResponse = await fileRetrievalResponse.json();
    currentUrl = newRetrievalUrl;

    // Update the existing sync entry with the new URL and expiration
    const { expiresAt: newExpiresAt } = getPresignedUrlExpirationInfo(currentUrl);
    await db.syncs.update(existingSyncFrom.id!, { url: newRetrievalUrl, expiresAt: newExpiresAt, lastSyncedAt: new Date() });
  }

  // Retrieve the file contents
  try {
    const response = await fetch(currentUrl);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found at the provided URL: ${currentUrl}`);
      }
      throw new Error(`Failed to retrieve file from ${currentUrl}. ${response.statusText}`);
    }
    // For now, just show a success message.
    const blob = await response.blob();
    const diffsResult = await getDiffsFromNewImport(blob); // Call getDiffsFromNewImport here
    return { blob, diffsResult };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error retrieving file:', error);
    throw new Error(`Failed to retrieve file: ${error.message || 'Unknown error'}`);
  }
}

export async function checkAndTriggerAutoSync(): Promise<{ blob: Blob, diffsResult: DiffsResult, outcome: 'SUCCESS' } | { outcome: 'RECENT_SYNC' | 'ERROR' } | null> {
  const existingSyncFrom = await db.syncs.where('type').equals('from').first();

  if (existingSyncFrom && existingSyncFrom.automatic && existingSyncFrom.lastSyncedAt) {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    if (existingSyncFrom.lastSyncedAt < oneHourAgo) {
      console.log(`Automatic sync triggered for Sync From. Last sync time ${existingSyncFrom.lastSyncedAt?.toISOString()}`);
      try {
        const { blob, diffsResult } = await syncFromDb(); // Call the modified syncFromDb
        return { blob, diffsResult, outcome: 'SUCCESS' };
      } catch (error) {
        console.error('Automatic sync failed:', error);
        return { outcome: 'ERROR' };
      }
    } else {
      console.log(`No sync [from] required for at least another: ${Math.floor((existingSyncFrom.lastSyncedAt.getTime() + 3600000 - new Date().getTime()) / 60000)} minutes`);
      return { outcome: 'RECENT_SYNC' };
    }
  }
  return null;
}
