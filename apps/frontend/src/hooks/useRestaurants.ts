import {useEffect} from 'react';
import {liveQuery} from 'dexie';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {db} from '../db/db';
import {readRestaurantData} from '../db/restaurants';
import {SHOW_ADVANCED_RESTAURANT_FIELDS_KEY} from '../util/db/settings';
export function useRestaurants() {
  const client = useQueryClient();
  useEffect(() => {
    const subscription = liveQuery(readRestaurantData).subscribe({next: data => client.setQueryData(['restaurants'],data)});
    return () => subscription.unsubscribe();
  },[client]);
  return useQuery({queryKey:['restaurants'],queryFn:readRestaurantData});
}
export function useAdvancedRestaurantFields() {
  const client = useQueryClient();
  const key = SHOW_ADVANCED_RESTAURANT_FIELDS_KEY;
  useEffect(() => {
    const subscription = liveQuery(() => db.settings.get(key)).subscribe({next: row => client.setQueryData(['settings',key],row ?? null)});
    return () => subscription.unsubscribe();
  },[client,key]);
  const query = useQuery({queryKey:['settings',key],queryFn:async () => (await db.settings.get(key)) ?? null});
  return query.data?.value === 'true';
}
