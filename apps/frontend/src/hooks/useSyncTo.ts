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
    mutationFn: (options: SyncToOptions) => syncTo({ ...options, existingSync: options.existingSyncTo, onProgress: setProgress,
      onWarning: options.automatic ? message => showActionToast(message, undefined) : undefined }),
    onSuccess: (_url, options) => {
      queryClient.invalidateQueries({ queryKey: ['syncTo'] });
      showSuccessToast(options.automatic ? 'Automatic sync [to] successful!' : 'Manual sync [to] successful!');
    },
    onError: (error: Error) => {
      setProgress(error.message); showErrorToast(error.message);
      queryClient.invalidateQueries({ queryKey: ['syncTo'] });
    },
  });
  return { existingSyncTo, syncToMutation, progress, ...query };
};
