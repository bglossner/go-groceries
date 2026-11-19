import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db/db';
import { SNAPSHOT_TABLES } from '../shareable/snapshot';
import { useMutationQueueStore, type MutationQueueState } from '../store/mutationQueueStore';
import { useSyncTo } from './useSyncTo';

export const useDebouncedSync = () => {
  const queue = useMutationQueueStore((state: MutationQueueState) => state.mutationQueue);
  const acknowledge = useMutationQueueStore(state => state.acknowledgeMutations);
  const { existingSyncTo, syncToMutation: { mutateAsync } } = useSyncTo();
  const [retry, setRetry] = useState(0);
  const uploading = useRef(false);
  useEffect(() => {
    let previous: string | undefined;
    // Observe bulk/collection writes as well as the existing single-row mutation hooks.
    const subscription = liveQuery(async () => JSON.stringify(await Promise.all(
      SNAPSHOT_TABLES.map(name => db.table(name).toArray())))).subscribe({
      next: value => {
        if (previous !== undefined && value !== previous) {
          useMutationQueueStore.getState().addMutation({ method: 'metadataChanged', table: 'snapshot', args: [], result: undefined });
        }
        previous = value;
      },
    });
    return () => subscription.unsubscribe();
  }, []);
  const lastPublished = existingSyncTo?.lastSyncedAt?.getTime();
  useEffect(() => { setRetry(0); }, [lastPublished, existingSyncTo?.automatic, queue.length]);
  useEffect(() => {
    if (!queue.length || existingSyncTo?.format !== 'v2' || !existingSyncTo.automatic || retry >= 3) return;
    const timer = window.setTimeout(async () => {
      if (uploading.current) { setRetry(value => value + 1); return; }
      uploading.current = true;
      try {
        await mutateAsync({ existingSyncTo, automatic: true });
        acknowledge(queue.length); setRetry(0);
      } catch {
        // Failed publication retains queued changes and its durable pending snapshot.
        setRetry(value => value + 1);
      } finally { uploading.current = false; }
    }, retry ? 30000 : 5000);
    return () => window.clearTimeout(timer);
  }, [queue, existingSyncTo, acknowledge, mutateAsync, retry]);
};
