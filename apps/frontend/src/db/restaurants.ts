import Dexie from 'dexie';
import { db } from './db';
import type { Restaurant, RestaurantTag, RestaurantItem, RestaurantItemRating } from '../shareable/restaurants';
import { restaurantSchema, restaurantTagSchema, itemSchema, personSchema, ratingSchema, normalizeLocation, normalizeName } from '../types/restaurants';
import { verifyCachedAsset } from './image-cache';
export const TAG_GROUPS: Record<RestaurantTag['group'], string[]> = {
  cuisine: ['Italian','Indian','Chinese','Thai','Japanese','Korean','Vietnamese','Mexican','Middle Eastern','Mediterranean','American','British','Pizza','Burgers','Cafe/bakery'],
  dietary: ['Vegetarian options','Vegan options','Only vegetarian','Only vegan','Gluten-free options','Dairy-free options','Halal options'],
  price: ['Budget','Mid-range','Treat/splurge'], service: ['Delivery','Takeout','Dine-in','Counter service','Reservations recommended'],
  occasion: ['Kid-friendly','Good for groups','Date night','Quick lunch','Special occasion','Late night','Breakfast/brunch'], custom: [],
};
export async function seedRestaurantTags() {
  await db.transaction('rw', db.restaurantTags, async () => {
    for (const [group,names] of Object.entries(TAG_GROUPS)) for (const name of names) {
      const normalizedName = normalizeName(name);
      if (!await db.restaurantTags.where('normalizedName').equals(normalizedName).first()) await db.restaurantTags.add({name,normalizedName,group: group as RestaurantTag['group']});
    }
  });
}
export const impliedTags = (names: string[]) => {
  const result = new Set(names.map(normalizeName));
  if (result.has('only vegan')) { result.add('only vegetarian'); result.add('vegan options'); }
  if (result.has('only vegetarian') || result.has('vegan options')) result.add('vegetarian options');
  return result;
};
export function dietaryDisplay(flags: RestaurantItem['dietaryFlags']) { return [...new Set(flags.includes('vegan') ? [...flags,'vegetarian'] : flags)]; }
export async function saveRestaurant(draft: Restaurant, tagNames?: string[]) {
  return db.transaction('rw', db.restaurants, db.restaurantTags, db.imageAssets, async () => {
    const previous = draft.id ? await db.restaurants.get(draft.id) : undefined;
    if (draft.id && !previous) throw new Error('Restaurant was deleted');
    const tags = tagNames ? [] as number[] : [...draft.tags];
    if (tagNames) for (const input of tagNames) {
      const name = input.trim(), normalizedName = normalizeName(name);
      const found = await db.restaurantTags.where('normalizedName').equals(normalizedName).first();
      if (found) tags.push(found.id!);
      else tags.push(await db.restaurantTags.add(restaurantTagSchema.parse({name,normalizedName,group:'custom'})));
    }
    const row = {...draft, name: draft.name.trim(), tags: [...new Set(tags)], createdAt: previous?.createdAt ?? draft.createdAt, updatedAt: new Date().toISOString()};
    const saved = await db.restaurants.toArray();
    for (const field of ['country','region','city'] as const) {
      const value = row[field]?.trim() || undefined, key = normalizeLocation(value);
      const matching = saved.filter(r => field === 'country' || r.countryKey === row.countryKey)
        .filter(r => field !== 'city' || r.regionKey === row.regionKey).find(r => r[`${field}Key`] === key);
      row[field] = key ? matching?.[field] ?? value : undefined; row[`${field}Key`] = key;
    }
    restaurantSchema.parse(row);
    const chosen = await db.restaurantTags.bulkGet(row.tags);
    if (chosen.some(t => !t) || chosen.filter(t => t?.group === 'price').length > 1) throw new Error('Choose at most one price tag');
    for (const image of row.menuImages ?? []) if (!await db.imageAssets.get(image.assetId)) throw new Error('Menu photo is missing');
    return db.restaurants.put(row);
  });
}
export async function setPinned(id: number, pinned: boolean) {
  return db.transaction('rw', db.restaurants, async () => {
    if (!await db.restaurants.get(id)) throw new Error('Restaurant was deleted');
    await db.restaurants.update(id,{isPinned:pinned,updatedAt:new Date().toISOString()});
  });
}
export async function saveDish(draft: RestaurantItem, opinions: RestaurantItemRating[]) {
  itemSchema.parse(draft);
  if (draft.lastOrderedDate) {
    // Compare calendar dates in the local timezone, without UTC shifts.
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    if (draft.lastOrderedDate > today) throw new Error('Last ordered cannot be in the future');
  }
  return db.transaction('rw', [db.restaurants, db.restaurantItems, db.people, db.restaurantItemRatings, db.imageAssets], async () => {
    if (!await db.restaurants.get(draft.restaurantId)) throw new Error('Restaurant was deleted');
    const previous = draft.id ? await db.restaurantItems.get(draft.id) : undefined;
    if (draft.id && (!previous || previous.restaurantId !== draft.restaurantId)) throw new Error('Dish was deleted or moved');
    for (const image of draft.images) {
      const asset = await db.imageAssets.get(image.assetId); if (!asset) throw new Error('Photo is missing');
      await Dexie.waitFor(verifyCachedAsset(asset));
    }
    const now = new Date().toISOString();
    const itemId = await db.restaurantItems.put({...draft,name:draft.name.trim(),createdAt:previous?.createdAt ?? draft.createdAt,updatedAt:now});
    const existing = await db.restaurantItemRatings.where('itemId').equals(itemId).toArray();
    const pairs = new Set<number>();
    const rows: RestaurantItemRating[] = [];
    for (const opinion of opinions) {
      const person = await db.people.get(opinion.personId);
      const old = existing.find(r => r.personId === opinion.personId);
      if (!person || (person.status === 'archived' && !old)) throw new Error('Choose an active person');
      if (pairs.has(opinion.personId)) throw new Error('One rating per person'); pairs.add(opinion.personId);
      rows.push(ratingSchema.parse({...opinion,id:old?.id,itemId,createdAt:old?.createdAt ?? now,updatedAt:now}));
    }
    await db.restaurantItemRatings.where('itemId').equals(itemId).delete();
    await db.restaurantItemRatings.bulkAdd(rows);
    return itemId;
  });
}
export async function deleteDish(id: number) {
  await db.transaction('rw', db.restaurantItems, db.restaurantItemRatings, async () => {
    await db.restaurantItemRatings.where('itemId').equals(id).delete(); await db.restaurantItems.delete(id);
  });
}
export async function deleteRestaurant(id: number) {
  await db.transaction('rw', db.restaurants, db.restaurantItems, db.restaurantItemRatings, async () => {
    const items = await db.restaurantItems.where('restaurantId').equals(id).primaryKeys();
    await db.restaurantItemRatings.where('itemId').anyOf(items).delete();
    await db.restaurantItems.bulkDelete(items); await db.restaurants.delete(id);
  });
}
export async function savePerson(nameInput: string, id?: number, restore = false) {
  const name = nameInput.trim(), normalizedName = normalizeName(name);
  return db.transaction('rw', db.people, async () => {
    const previous = id ? await db.people.get(id) : undefined;
    if (id && !previous) throw new Error('Person was erased');
    const found = await db.people.where('normalizedName').equals(normalizedName).first();
    if (found && found.id !== id) {
      if (found.status === 'archived' && restore) { await db.people.update(found.id!,{status:'active',updatedAt:new Date().toISOString()}); return found.id!; }
      throw new Error(found.status === 'archived' ? 'Name is archived; restore in Manage people' : 'Person already exists');
    }
    const now = new Date().toISOString();
    return db.people.put(personSchema.parse({id,name,normalizedName,status:previous?.status ?? 'active',createdAt:previous?.createdAt ?? now,updatedAt:now}));
  });
}
export async function archivePerson(id: number, archived: boolean) {
  await db.people.update(id,{status:archived?'archived':'active',updatedAt:new Date().toISOString()});
}
export async function erasePerson(id: number) {
  await db.transaction('rw',db.people,db.restaurantItemRatings,async () => {
    await db.restaurantItemRatings.where('personId').equals(id).delete(); await db.people.delete(id);
  });
}
export const ratingSummary = (ratings: RestaurantItemRating[]) => ({count:ratings.length, mean:ratings.length ? ratings.reduce((sum,r) => sum+r.score,0)/ratings.length : undefined});
export const dishScore = (ratings: RestaurantItemRating[], personId?: number) => personId ? ratings.find(r => r.personId === personId)?.score : ratingSummary(ratings).mean;
export const compareName = (a: {name:string;id?:number}, b: {name:string;id?:number}) => normalizeName(a.name).localeCompare(normalizeName(b.name)) || (a.id! - b.id!);
export type RestaurantFilters = { search: string; tags: number[]; country?: string; region?: string; city?: string; personId?: number; threshold: boolean; minimum: number; sort: 'name'|'rated' };
export function rankedDishes(items: RestaurantItem[], ratings: RestaurantItemRating[], personId?:number) {
  return [...items].sort((a,b) => (dishScore(ratings.filter(r => r.itemId === b.id),personId) ?? -Infinity) - (dishScore(ratings.filter(r => r.itemId === a.id),personId) ?? -Infinity) || compareName(a,b));
}
export function selectRestaurants(restaurants:Restaurant[],items:RestaurantItem[],ratings:RestaurantItemRating[],tags:RestaurantTag[],filters:RestaurantFilters) {
  const byRestaurant = new Map<number,RestaurantItem[]>(); const byItem = new Map<number,RestaurantItemRating[]>();
  for (const item of items) { const owned = byRestaurant.get(item.restaurantId) ?? []; owned.push(item); byRestaurant.set(item.restaurantId,owned); }
  for (const rating of ratings) { const rows = byItem.get(rating.itemId) ?? [];rows.push(rating);byItem.set(rating.itemId,rows); }
  const tagMap = new Map(tags.map(t => [t.id!,t.name]));
  return restaurants.map(restaurant => {
    const dishes = byRestaurant.get(restaurant.id!) ?? [];
    const best = [...dishes].sort((a,b) => (dishScore(byItem.get(b.id!) ?? [],filters.personId) ?? -Infinity) - (dishScore(byItem.get(a.id!) ?? [],filters.personId) ?? -Infinity) || compareName(a,b))[0];
    const bestRatings = byItem.get(best?.id ?? -1) ?? [];
    return {restaurant,dishes,best,score:dishScore(bestRatings,filters.personId),count:bestRatings.length};
  }).filter(({restaurant:r,dishes}) => {
    const search = filters.search.toLowerCase().trim(); const implied = impliedTags(r.tags.map(t => tagMap.get(t) ?? ''));
    return (!search || [r.name,r.country,r.region,r.city,r.address,...dishes.map(d => d.name)].some(v => v?.toLowerCase().includes(search))) &&
      filters.tags.every(t => implied.has(normalizeName(tagMap.get(t) ?? ''))) &&
      (filters.country === undefined || r.countryKey === filters.country) && (filters.region === undefined || r.regionKey === filters.region) && (filters.city === undefined || r.cityKey === filters.city) &&
      (!filters.personId || !filters.threshold || dishes.some(d => (byItem.get(d.id!) ?? []).some(v => v.personId === filters.personId && v.score >= filters.minimum)));
  }).sort((a,b) => Number(b.restaurant.isPinned)-Number(a.restaurant.isPinned) || (filters.sort === 'rated' ? (b.score ?? -Infinity)-(a.score ?? -Infinity) : 0) || compareName(a.restaurant,b.restaurant));
}
export async function readRestaurantData() {
  const [restaurants,restaurantTags,restaurantItems,people,restaurantItemRatings] = await Promise.all([db.restaurants.toArray(),db.restaurantTags.toArray(),db.restaurantItems.toArray(),db.people.toArray(),db.restaurantItemRatings.toArray()]);
  return {restaurants,restaurantTags,restaurantItems,people,restaurantItemRatings};
}
