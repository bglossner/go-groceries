import { db, INCLUDE_TABLES } from '../../db/db';
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

export const getExportBlob = async () => {
  return await exportDB(db, {
    filter: (table, _value, _key) => {
      return INCLUDE_TABLES.includes(table);
    }
  });
}
