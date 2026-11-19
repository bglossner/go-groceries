import Dexie from 'dexie';
import { getReferencedAssetIds } from '../../db/image-cache';
import { db, INCLUDE_TABLES } from '../../db/db';
import { validatePortableDatabase } from './import';
import { exportDB } from 'dexie-export-import';

export const exportBlobToFile = (filename: string, blob: Blob | File) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const getExportBlob = async () => db.transaction('r', db.tables, async () => {
  // Freeze rows and cache together; retained historical cache entries stay private/local.
  await Dexie.waitFor(validatePortableDatabase(db));
  const reachable = await getReferencedAssetIds(db);
  return exportDB(db, {
    filter: (table, value) => INCLUDE_TABLES.includes(table) &&
      (table !== 'imageAssets' || reachable.has(value.assetId)),
  });
});
