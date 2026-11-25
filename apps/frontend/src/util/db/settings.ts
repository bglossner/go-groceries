import { db } from '../../db/db';

export const LAST_EDITED_GROCERY_LIST_ID_KEY = 'lastEditedGroceryListId';

export const setLastEditedGroceryListId = async (id: number) => {
  await db.settings.put({ id: LAST_EDITED_GROCERY_LIST_ID_KEY, value: id.toString() });
};

export const getLastEditedGroceryListId = async (): Promise<number | undefined> => {
  const setting = await db.settings.get(LAST_EDITED_GROCERY_LIST_ID_KEY);
  if (setting) {
    return parseInt(setting.value, 10);
  }
  return undefined;
};

export const SHOW_ADVANCED_RESTAURANT_FIELDS_KEY = 'showAdvancedRestaurantFields';

export const PWA_UPDATE_NOTIFICATIONS_ENABLED_KEY = 'pwaUpdateNotificationsEnabled';

export const pwaUpdateNotificationsQuery = {
  queryKey: ['settings', PWA_UPDATE_NOTIFICATIONS_ENABLED_KEY],
  queryFn: async () => {
    const setting = await db.settings.get(PWA_UPDATE_NOTIFICATIONS_ENABLED_KEY);
    return (setting?.value ?? 'true') === 'true';
  },
};
