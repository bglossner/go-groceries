import { beforeEach, afterEach } from 'vitest';
import { db } from '../src/db/db.ts';
export const date = new Date('2020-01-01T00:00:00.000Z');
export const meal = (id = 1, name = 'Soup') => ({id,name,ingredients:[{name:'carrot',quantity:2}],createdAt:date,updatedAt:date});
export const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
export const image = () => new Blob([png], {type:'image/png'});
export function cleanDatabase() {
  beforeEach(async () => { await db.open(); await Promise.all(db.tables.map(table => table.clear())); });
  afterEach(async () => { await Promise.all(db.tables.map(table => table.clear())); db.close(); });
}
