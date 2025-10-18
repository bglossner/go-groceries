import { useEffect, useRef } from 'react';
import { useMutationQueueStore, type MutationQueueState } from '../store/mutationQueueStore';
import { useSyncTo } from './useSyncTo';

const SYNC_DEBOUNCE_TIME_MS = 5000;
// const SYNC_DEBOUNCE_TIME_DEBUG = 1000; // 1 seconds

export const useDebouncedSync = () => {
  const mutationQueue = useMutationQueueStore((state: MutationQueueState) => state.mutationQueue);
  const clearQueue = useMutationQueueStore((state: MutationQueueState) => state.clearQueue);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { existingSyncTo, syncToMutation: { mutateAsync: syncToMutateAsync } } = useSyncTo();

  useEffect(() => {
    if (mutationQueue.length > 0 && existingSyncTo?.automatic) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        console.log('Debounced sync triggered!');
        try {
          await syncToMutateAsync({ existingSyncTo, automatic: true });
        } finally {
          clearQueue();
        }
      }, SYNC_DEBOUNCE_TIME_MS);
      // }, SYNC_DEBOUNCE_TIME_DEBUG);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [mutationQueue, existingSyncTo, clearQueue, syncToMutateAsync]);
};
