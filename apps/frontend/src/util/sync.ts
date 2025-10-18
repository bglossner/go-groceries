import { db, type Sync } from '../db/db';
import { getExportBlob } from './db/export';
import { type FileUploadRequest, type FileUploadResponse } from '../shareable/file-upload';
import { type FileRetrievalRequest, type FileRetrievalResponse } from '../shareable/file-retrieval';
import { uploadFile } from './file/file-upload';

export async function syncTo(options: { exisingSync?: Sync, automatic: boolean }): Promise<string> {
  const { exisingSync } = options;
  // 1. Get the export blob
  const blob = await getExportBlob();
  const filename = exisingSync ? exisingSync.filename : `groceries_backup_${crypto.randomUUID()}`;
  const file = new File([blob], filename, { type: 'application/json' });

  // 2. Get the youtubeApiPass from settings
  const passSetting = await db.settings.get('youtubeApiPass');
  if (!passSetting || !passSetting.value) {
    throw new Error('YouTube API Pass not set');
  }
  const pass = passSetting.value;

  // 3. API call to /file-upload
  const fileUploadRequest: FileUploadRequest = {
    pass,
    fileUploadType: 'R2',
    fileName: file.name,
    contentType: file.type as 'application/json',
  };

  const fileUploadResponse = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/file-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fileUploadRequest),
  });

  if (!fileUploadResponse.ok) {
    throw new Error('Failed to get upload URL');
  }

  const { url: uploadUrl }: FileUploadResponse = await fileUploadResponse.json();

  // 4. Upload the file
  await uploadFile(file, { location: { url: uploadUrl } });

  // 5. API call to /file-retrieval
  const fileRetrievalRequest: FileRetrievalRequest = {
    pass,
    fileName: file.name,
    uploadedType: 'R2',
  };

  const fileRetrievalResponse = await fetch(`${import.meta.env.VITE_FILE_SYNC_BASE_URL}/file-retrieval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fileRetrievalRequest),
  });

  if (!fileRetrievalResponse.ok) {
    throw new Error('Failed to get retrieval URL');
  }

  const { url: retrievalUrl }: FileRetrievalResponse = await fileRetrievalResponse.json();

  // 6. Save to IndexedDB
  if (exisingSync) {
    await db.syncs.update(exisingSync.id, {
      ...exisingSync,
      filename: file.name,
      uploadType: 'manual',
      url: retrievalUrl,
      lastSyncedAt: new Date(),
    });
  } else {
    await db.syncs.add({
      type: 'to',
      filename: file.name,
      uploadType: 'manual',
      createdAt: new Date(),
      url: retrievalUrl,
      automatic: options.automatic,
      lastSyncedAt: new Date(),
    });
  }

  // 7. Return retrieval URL
  return retrievalUrl;
}
