import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, type Sync } from '../db/db';
import { syncTo } from '../util/sync';
import type { SyncTrigger } from '../util/sync/diagnostics-model';
import { useDiffsModal } from './useDiffsModal';
import { useToast } from './useToast';

interface SyncToOptions { existingSyncTo?: Sync; automatic: boolean; newLocation?: boolean; trigger: SyncTrigger }
export const useSyncTo = () => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState('');
  const { showSuccessToast, showErrorToast } = useDiffsModal();
  const { showActionToast } = useToast();
  const { data: existingSyncTo, ...query } = useQuery<Sync | null>({ queryKey: ['syncTo'],
    queryFn: async () => await db.syncs.where('type').equals('to').first() ?? null });
  const syncToMutation = useMutation({
    mutationFn: async (options: SyncToOptions) => {
      let warned = false;
      const url = await syncTo({ ...options, existingSync: options.existingSyncTo, onProgress: setProgress,
        onWarning: options.trigger === 'debounced' ? message => {
          warned = true;
          showActionToast(message, undefined);
        } : undefined });
      if (!warned) showSuccessToast(options.trigger === 'debounced' ? 'Automatic sync [to] successful!' : 'Manual sync [to] successful!');
      return url;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['syncTo'] }); },
    onError: (error: Error) => {
      setProgress(error.message); showErrorToast(error.message);
      queryClient.invalidateQueries({ queryKey: ['syncTo'] });
    },
  });
  return { existingSyncTo, syncToMutation, progress, ...query };
};
