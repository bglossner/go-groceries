
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Sync } from '../db/db';
import { checkAndTriggerAutoSync } from '../util/sync-from';
import { handleFileImport } from '../util/db/import';
import { useDiffsModal } from './useDiffsModal';

export const useSync = () => {
  const queryClient = useQueryClient();
  const { openDiffsModal } = useDiffsModal();

  const { data: existingSyncFrom } = useQuery<Sync | null>({
    queryKey: ['syncFrom'],
    queryFn: async () => await db.syncs.where('type').equals('from').first() ?? null,
  });

  const syncFromDbMutation = useMutation({
    mutationFn: async () => {
      const syncResult = await checkAndTriggerAutoSync();
      if (syncResult) {
        const { outcome } = syncResult;
        if (outcome !== 'SUCCESS') {
          return;
        }
        const { blob, diffsResult } = syncResult;
        if (diffsResult.mealDiffs.toAdd.length > 0 || diffsResult.mealDiffs.toRemove.length > 0) {
          openDiffsModal(diffsResult, blob, () => undefined);
        } else {
          await handleFileImport(blob);
          if (existingSyncFrom && existingSyncFrom.id) {
            await db.syncs.update(existingSyncFrom.id, { lastSyncedAt: new Date() });
          }
          queryClient.invalidateQueries({ queryKey: ['syncFrom'] });
        }
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      alert('Automatic sync failed:' + error);
    },
  });

  useEffect(() => {
    // Initial check
    syncFromDbMutation.mutate();

    // Lets not for now
    // Set up a timer for periodic checks
    // const intervalId = setInterval(() => {
    //   syncFromDbMutation.mutate();
    // }, 60 * 60 * 1000); // every hour

    // return () => clearInterval(intervalId);
  }, [syncFromDbMutation]);

  return null;
};
