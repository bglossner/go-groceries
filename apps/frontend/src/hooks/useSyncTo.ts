import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, type Sync } from '../db/db';
import { syncTo } from '../util/sync';
import { useDiffsModal } from './useDiffsModal';

interface SyncToOptions {
  existingSyncTo?: Sync;
  automatic: boolean;
}

export const useSyncTo = () => {
  const queryClient = useQueryClient();
  const { showSuccessToast, showErrorToast } = useDiffsModal();

  const { data: existingSyncTo, ...existingSyncToQuery } = useQuery<Sync | null>({
    queryKey: ['syncTo'],
    queryFn: async () => await db.syncs.where('type').equals('to').first() ?? null,
  });

  const syncToMutation = useMutation({
    mutationFn: async (options: SyncToOptions) => {
      // syncTo sets last synced date
      console.log('existing sync', options.existingSyncTo);
      const url = await syncTo({ ...options, exisingSync: options.existingSyncTo });
      return url;
    },
    onSuccess: (url, options) => {
      queryClient.invalidateQueries({ queryKey: ['syncTo'] });
      if (options.automatic) {
        showSuccessToast('Automatic sync [to] successful!');
        console.log('Automatic sync [to] successful!', url);
      } else {
        showSuccessToast('Manual sync [to] successful!');
      }
    },
    onError: (error: unknown, options) => {
      if (options.automatic) {
        showErrorToast(`Automatic sync [to] failed: ${(error as Error).message}`);
        console.error('Automatic sync [to] failed:', error);
      } else {
        showErrorToast(`Manual sync [to] failed: ${(error as Error).message}`);
      }
    },
  });

  return {
    existingSyncTo,
    syncToMutation,
    ...existingSyncToQuery,
  };
};
