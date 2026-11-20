import { z } from 'zod';
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const normalizeLocation = (value: string = '') => value.trim().replace(/\s+/g, ' ').toLowerCase();
export const normalizeName = (value: string) => value.trim().toLowerCase();
const name = (max: number) => z.string().min(1).max(max).refine(v => v === v.trim());
const optionalText = (max: number) => z.string().max(max).optional();
const date = z.string().refine(v => { const d = new Date(v); return Number.isFinite(d.getTime()) && d.toISOString() === v; }, 'Expected ISO UTC date');
const dates = { createdAt: date, updatedAt: date };
const image = z.object({ kind: z.literal('asset'), assetId: z.string().regex(/^[a-f0-9]{64}$/), name: optionalText(255), lastModified: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict();
const images = z.array(image).max(10);
export const mapsUrl = z.string().max(2048).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'Enter an HTTPS link without credentials');
export const restaurantSchema = z.object({ id: id.optional(), name: name(200), tags: z.array(id), notes: z.string().max(10000), isPinned: z.boolean(),
  country: optionalText(100), region: optionalText(100), city: optionalText(100), countryKey: z.string(), regionKey: z.string(), cityKey: z.string(),
  address: optionalText(2000), latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional(),
  googleMapsUrl: mapsUrl.optional(), menuImages: images.optional(), ...dates,
}).strict().superRefine((r, c) => {
  for (const field of ['country','region','city'] as const) {
    if (r[field] !== undefined && r[field] !== r[field]?.trim()) c.addIssue({ code: 'custom', path: [field], message: 'Trim location' });
    if (r[`${field}Key`] !== normalizeLocation(r[field])) c.addIssue({ code: 'custom', path: [field], message: 'Location key does not match' });
  }
  if ((r.regionKey || r.cityKey) && !r.countryKey) c.addIssue({ code: 'custom', path: ['country'], message: 'Country required for state or city' });
  if ((r.latitude === undefined) !== (r.longitude === undefined)) c.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both coordinates or clear both' });
  if (new Set(r.tags).size !== r.tags.length) c.addIssue({ code: 'custom', path: ['tags'], message: 'Duplicate tag' });
});
export const restaurantTagSchema = z.object({ id: id.optional(), name: name(80), normalizedName: z.string(), group: z.enum(['cuisine','dietary','price','service','occasion','custom']) }).strict().refine(r => r.normalizedName === normalizeName(r.name), 'Tag name key does not match');
export const personSchema = z.object({ id: id.optional(), name: name(80), normalizedName: z.string(), status: z.enum(['active','archived']), ...dates }).strict().refine(r => r.normalizedName === normalizeName(r.name), 'Person name key does not match');
export const categories = ['starter','main','side','drink','dessert','unknown'] as const;
export const spices = ['unknown','none','mild','medium','hot','extra hot'] as const;
export const dietaryFlags = ['vegetarian','vegan','gluten-free option','dairy-free option'] as const;
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v; }, 'Enter a valid calendar date');
export const itemSchema = z.object({ id: id.optional(), restaurantId: id, name: name(200), description: z.string().max(10000), notes: z.string().max(10000), images,
  coverImageIndex: z.number().int().nonnegative().optional(), priceAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  portion: optionalText(200), spiceLevel: z.enum(spices).optional(), modifiers: optionalText(2000), category: z.enum(categories).optional(), lastOrderedDate: calendarDate.optional(),
  dietaryFlags: z.array(z.enum(dietaryFlags)).max(4), ...dates,
}).strict().superRefine((r,c) => {
  if (r.priceAmount !== undefined && !r.currency) c.addIssue({ code: 'custom', path: ['currency'], message: 'Currency required with price' });
  if (r.coverImageIndex !== undefined && r.coverImageIndex >= r.images.length) c.addIssue({ code: 'custom', path: ['images'], message: 'Cover must reference a photo' });
  if (new Set(r.dietaryFlags).size !== r.dietaryFlags.length) c.addIssue({ code: 'custom', path: ['dietaryFlags'], message: 'Duplicate flag' });
});
export const ratingSchema = z.object({ id: id.optional(), itemId: id, personId: id, score: z.number().finite().min(1).max(10).multipleOf(0.5), comment: optionalText(2000), wouldOrderAgain: z.enum(['yes','no','undecided']).optional(), ...dates }).strict();
export const restaurantRowSchemas = { restaurants: restaurantSchema, restaurantTags: restaurantTagSchema, restaurantItems: itemSchema, people: personSchema, restaurantItemRatings: ratingSchema };
export function validateRestaurantRelations(tables: { restaurants: z.infer<typeof restaurantSchema>[]; restaurantTags: z.infer<typeof restaurantTagSchema>[]; restaurantItems: z.infer<typeof itemSchema>[]; people: z.infer<typeof personSchema>[]; restaurantItemRatings: z.infer<typeof ratingSchema>[] }) {
  const restaurantIds = new Set(tables.restaurants.map(r => r.id));
  const tagMap = new Map(tables.restaurantTags.map(r => [r.id,r]));
  const itemIds = new Set(tables.restaurantItems.map(r => r.id));
  const peopleIds = new Set(tables.people.map(r => r.id));
  const pairs = new Set<string>();
  for (const rows of Object.values(tables)) if (rows.some(r => r.id === undefined) || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Missing or duplicate restaurant row ID');
  for (const rows of [tables.people, tables.restaurantTags]) if (new Set(rows.map(r => r.normalizedName)).size !== rows.length) throw new Error('Duplicate normalized name');
  for (const r of tables.restaurants) {
    if (r.tags.some(t => !tagMap.has(t)) || r.tags.filter(t => tagMap.get(t)?.group === 'price').length > 1) throw new Error('Invalid restaurant tags');
  }
  if (tables.restaurantItems.some(r => !restaurantIds.has(r.restaurantId))) throw new Error('Missing restaurant');
  for (const r of tables.restaurantItemRatings) {
    const pair = `${r.itemId}:${r.personId}`;
    if (!itemIds.has(r.itemId) || !peopleIds.has(r.personId) || pairs.has(pair)) throw new Error('Invalid or duplicate rating relationship');
    pairs.add(pair);
  }
}
